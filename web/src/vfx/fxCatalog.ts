/**
 * FX catalog — every built-in visual effect, described as data so the
 * editor's FX page can list it, preview it, and tune it.
 *
 * Each FX declares its tunable parameters (colours, sizes, durations,
 * particle counts — only what that effect actually supports) with
 * defaults. A module's `fx.json` stores overrides by FX id:
 *
 *   { "fx": [ { "id": "hellfire", "params": { "core": "#ffffff", "size": 1.4 } } ] }
 *
 * At runtime `effectRegistry` plays every FX through `playFx`, which
 * merges defaults ⊕ the module overrides (seeded by
 * `setFxOverrides`) ⊕ any per-call knobs from the caller. A record can
 * also carry an `impact` visual and a `shake`, played when the main
 * visual lands. The game and the editor preview both play through
 * `playFxParts`, the preview with the unsaved form values, so what the
 * editor shows is what the game shows.
 *
 * Colours are stored as "#rrggbb" strings (what a colour input gives
 * back); numbers are plain numbers.
 */

import type Phaser from "phaser";
import {
  breathOfFire,
  glowAura,
  healingSparkles,
  hellfire,
  lightningZigzag,
  magicArrow,
  magicDart,
  meteorStrike,
  holySmite,
  curseHex,
  shieldDome,
  groundRift,
  enchantSpiral,
  teleportBlink,
  projectileLine,
  radialBurst,
  screenShake,
  voidOrb,
  VFX_COLOURS,
} from "./Vfx";
import { spriteUrl } from "@/data_model/spriteUrl";

export interface Pt {
  x: number;
  y: number;
}

export type FxParamDef =
  | { key: string; label: string; type: "color"; default: string; help?: string }
  | {
      key: string;
      label: string;
      type: "number";
      default: number;
      min: number;
      max: number;
      step: number;
      /** Unit shown after the value ("ms", "px", "×"). */
      unit?: string;
      help?: string;
    };

export type FxParams = Record<string, string | number>;

/** Per-call knobs a caller may pass (legacy ProjectileEffectConfig). */
export interface FxCallConfig {
  color?: number;
  durationMs?: number;
  segments?: number;
}

export interface FxDef {
  id: string;
  name: string;
  description: string;
  /** "projectile" travels caster → target; "burst" plays on the target. */
  kind: "projectile" | "burst";
  params: FxParamDef[];
  /** Param key a caller's `color` override maps onto. */
  colorKey?: string;
  /** Param key a caller's `durationMs` override maps onto. */
  durationKey?: string;
  play: (scene: Phaser.Scene, from: Pt, to: Pt, p: FxParams) => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────

export function hexToNum(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.trim().match(/^#?([0-9a-f]{6})$/i);
    if (m) return parseInt(m[1], 16);
  }
  return fallback;
}

export function numToHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;
}

const hex = numToHex;
const num = (p: FxParams, k: string, d: number): number => {
  const v = p[k];
  return typeof v === "number" && Number.isFinite(v) ? v : d;
};
const col = (p: FxParams, k: string, d: number): number => hexToNum(p[k], d);

const dur = (key = "duration_ms", d = 300, min = 60, max = 2000): FxParamDef => ({
  key, label: "Duration", type: "number", default: d, min, max, step: 10, unit: "ms",
});

// ── The catalog ──────────────────────────────────────────────────────

export const FX_DEFS: ReadonlyArray<FxDef> = [
  {
    id: "projectile_line",
    name: "Arcane Streak",
    description: "A small bolt flying on a gentle arc. The default for projectile spells with no other visual.",
    kind: "projectile",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.arcane) },
      dur("duration_ms", 220),
    ],
    play: (s, f, t, p) =>
      projectileLine(s, f, t, col(p, "color", VFX_COLOURS.arcane), num(p, "duration_ms", 220)),
  },
  {
    id: "fire_projectile",
    name: "Fire Streak",
    description: "The arcane streak in burning orange — simple fire projectiles.",
    kind: "projectile",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.fire) },
      dur("duration_ms", 280),
    ],
    play: (s, f, t, p) =>
      projectileLine(s, f, t, col(p, "color", VFX_COLOURS.fire), num(p, "duration_ms", 280)),
  },
  {
    id: "lightning_bolt",
    name: "Lightning Bolt",
    description: "A plasma ball charges at the caster, races to the target and erupts into a forked, flickering arc of plasma that re-strikes a few times, ending in a crackling plasma burst with sparks.",
    kind: "projectile",
    colorKey: "color",
    durationKey: "fade_ms",
    params: [
      { key: "color", label: "Bolt", type: "color", default: hex(VFX_COLOURS.lightning) },
      { key: "glow", label: "Plasma glow", type: "color", default: "#7b6cff" },
      { key: "core", label: "Hot core", type: "color", default: "#ffffff" },
      { key: "width", label: "Thickness", type: "number", default: 3, min: 1, max: 10, step: 1, unit: "px" },
      { key: "segments", label: "Kinks", type: "number", default: 8, min: 2, max: 20, step: 1 },
      { key: "jitter", label: "Jaggedness", type: "number", default: 18, min: 0, max: 48, step: 1, unit: "px" },
      { key: "branches", label: "Forks", type: "number", default: 3, min: 0, max: 8, step: 1 },
      { key: "strikes", label: "Flickers", type: "number", default: 3, min: 1, max: 6, step: 1, help: "How many times the bolt re-strikes." },
      { key: "charge_ms", label: "Charge-up", type: "number", default: 120, min: 0, max: 600, step: 10, unit: "ms", help: "0 = fire instantly." },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.4, max: 2.5, step: 0.05, unit: "×", help: "Charge ball and impact burst." },
      dur("fade_ms", 280),
    ],
    play: (s, f, t, p) =>
      lightningZigzag(s, f, t, Math.round(num(p, "segments", 8)), {
        color: col(p, "color", VFX_COLOURS.lightning),
        glow: col(p, "glow", 0x7b6cff),
        core: col(p, "core", 0xffffff),
        width: num(p, "width", 3),
        jitter: num(p, "jitter", 18),
        branches: num(p, "branches", 3),
        strikes: num(p, "strikes", 3),
        chargeMs: num(p, "charge_ms", 120),
        size: num(p, "size", 1),
        fadeMs: num(p, "fade_ms", 280),
      }),
  },
  {
    id: "meteor_strike",
    name: "Meteor Strike",
    description: "Flaming rocks fall from the sky onto the target: a big spinning meteor with fire and smoke trails plus smaller chunks, then a flash, ground shock ring, crater, billowing dust and flying rock chips.",
    kind: "burst",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Fire", type: "color", default: hex(VFX_COLOURS.fire) },
      { key: "ember", label: "Molten rim", type: "color", default: hex(VFX_COLOURS.ember) },
      { key: "rock", label: "Rock", type: "color", default: "#4a3a30" },
      { key: "dust", label: "Dust", type: "color", default: "#8a7560" },
      { key: "smoke", label: "Smoke", type: "color", default: "#2b2124" },
      { key: "rocks", label: "Extra rocks", type: "number", default: 3, min: 0, max: 8, step: 1 },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.4, max: 2.5, step: 0.05, unit: "×" },
      { ...dur("duration_ms", 420), label: "Fall time" },
    ],
    play: (s, f, t, p) =>
      meteorStrike(s, f, t, col(p, "color", VFX_COLOURS.fire), num(p, "duration_ms", 420), {
        ember: col(p, "ember", VFX_COLOURS.ember),
        rock: col(p, "rock", 0x4a3a30),
        dust: col(p, "dust", 0x8a7560),
        smoke: col(p, "smoke", 0x2b2124),
        rocks: num(p, "rocks", 3),
        size: num(p, "size", 1),
      }),
  },
  {
    id: "magic_dart",
    name: "Magic Dart",
    description: "A fast orb with a sparkle trail and a bright impact ring.",
    kind: "projectile",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.arcane) },
      dur("duration_ms", 240),
    ],
    play: (s, f, t, p) =>
      magicDart(s, f, t, col(p, "color", VFX_COLOURS.arcane), num(p, "duration_ms", 240)),
  },
  {
    id: "magic_arrow",
    name: "Magic Arrow",
    description: "The arrow sprite conjured from light and shot dead-straight at the target, wrapped in a flickering glow with afterimages and twinkling sparkles, bursting into a ring, cross glint and glowing shards on impact.",
    kind: "projectile",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Glow", type: "color", default: hex(VFX_COLOURS.arcane) },
      { key: "core", label: "Arrow tint", type: "color", default: "#f3e9ff" },
      { key: "sparkle", label: "Sparkles", type: "color", default: "#ff9ad5" },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.5, max: 2.5, step: 0.05, unit: "×" },
      { ...dur("duration_ms", 280), label: "Flight time" },
    ],
    play: (s, f, t, p) =>
      magicArrow(s, f, t, col(p, "color", VFX_COLOURS.arcane), num(p, "duration_ms", 280), {
        texture: spriteUrl("item/arrows.png"),
        core: col(p, "core", 0xf3e9ff),
        sparkle: col(p, "sparkle", 0xff9ad5),
        size: num(p, "size", 1),
      }),
  },
  {
    id: "void_orb",
    name: "Void Orb",
    description: "A large churning multi-coloured sphere that implodes into a shockwave. Its palette is fixed.",
    kind: "projectile",
    durationKey: "duration_ms",
    params: [dur("duration_ms", 520, 120, 2400)],
    play: (s, f, t, p) => voidOrb(s, f, t, VFX_COLOURS.curse, num(p, "duration_ms", 520)),
  },
  {
    id: "hellfire",
    name: "Hellfire",
    description: "A roiling ball of flame hurled at the target, erupting in fire, flame tongues, sparks and smoke. The Demon's Hellfire and the Lich's Fireball.",
    kind: "projectile",
    colorKey: "body",
    durationKey: "flight_ms",
    params: [
      { key: "outer", label: "Outer flame", type: "color", default: "#c0260f" },
      { key: "body", label: "Flame", type: "color", default: hex(VFX_COLOURS.fire) },
      { key: "ember", label: "Embers", type: "color", default: hex(VFX_COLOURS.ember) },
      { key: "core", label: "Hot core", type: "color", default: "#fff1c2" },
      { key: "smoke", label: "Smoke", type: "color", default: "#2b2124" },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.4, max: 2.5, step: 0.05, unit: "×" },
      {
        key: "flight_ms", label: "Flight time", type: "number", default: 0, min: 0, max: 2000, step: 10, unit: "ms",
        help: "0 = scale with distance (340–640 ms).",
      },
    ],
    play: (s, f, t, p) =>
      hellfire(s, f, t, {
        outer: col(p, "outer", 0xc0260f),
        body: col(p, "body", VFX_COLOURS.fire),
        ember: col(p, "ember", VFX_COLOURS.ember),
        core: col(p, "core", 0xfff1c2),
        smoke: col(p, "smoke", 0x2b2124),
        size: num(p, "size", 1),
        flightMs: num(p, "flight_ms", 0) > 0 ? num(p, "flight_ms", 0) : undefined,
      }),
  },
  {
    id: "breath_of_fire",
    name: "Dragon Breath",
    description: "A widening cone of flame from the caster's mouth with an ember stream and an impact burst. The Dragon's Fire Breath.",
    kind: "projectile",
    colorKey: "fire",
    durationKey: "duration_ms",
    params: [
      { key: "fire", label: "Flame", type: "color", default: hex(VFX_COLOURS.fire) },
      { key: "ember", label: "Embers", type: "color", default: hex(VFX_COLOURS.ember) },
      { key: "width", label: "Cone width", type: "number", default: 45, min: 10, max: 120, step: 1, unit: "px" },
      dur("duration_ms", 520, 150, 2000),
    ],
    play: (s, f, t, p) =>
      breathOfFire(s, f, t, {
        fire: col(p, "fire", VFX_COLOURS.fire),
        ember: col(p, "ember", VFX_COLOURS.ember),
        width: num(p, "width", 45),
        durationMs: num(p, "duration_ms", 520),
      }),
  },
  {
    id: "heal_sparkles",
    name: "Healing Sparkles",
    description: "Sparkles rising from the target's feet. Heals and restorations.",
    kind: "burst",
    colorKey: "color",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.heal) },
      { key: "accent", label: "Accent", type: "color", default: "#b4f5be" },
      { key: "count", label: "Sparkles", type: "number", default: 8, min: 1, max: 40, step: 1 },
    ],
    play: (s, _f, t, p) =>
      healingSparkles(s, t, Math.round(num(p, "count", 8)), {
        color: col(p, "color", VFX_COLOURS.heal),
        accent: col(p, "accent", 0xb4f5be),
      }),
  },
  {
    id: "buff_aura",
    name: "Buff Aura",
    description: "A soft expanding ring around the target. Positive buffs: Bless, Shield, Long Shanks, Light.",
    kind: "burst",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.buff) },
      { key: "radius", label: "Size", type: "number", default: 28, min: 8, max: 96, step: 1, unit: "px" },
      { key: "width", label: "Ring thickness", type: "number", default: 2, min: 1, max: 8, step: 1, unit: "px" },
      dur("duration_ms", 520),
    ],
    play: (s, _f, t, p) =>
      glowAura(s, t, col(p, "color", VFX_COLOURS.buff), {
        radius: num(p, "radius", 28),
        width: num(p, "width", 2),
        durationMs: num(p, "duration_ms", 520),
      }),
  },
  {
    id: "shield_dome",
    name: "Shield Dome",
    description: "A golden ward opens under the target and a honeycombed barrier dome rises around it, a band of light sweeping over it, then locks in with a flash, a ground ring and sparkles. Shield, Bless, Long Shanks, Invisibility.",
    kind: "burst",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Barrier", type: "color", default: hex(VFX_COLOURS.buff) },
      { key: "core", label: "Highlight", type: "color", default: "#fff8dc" },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.4, max: 2.5, step: 0.05, unit: "×" },
      { ...dur("duration_ms", 550, 200, 2000), label: "Build-up" },
    ],
    play: (s, _f, t, p) =>
      shieldDome(s, t, {
        color: col(p, "color", VFX_COLOURS.buff),
        core: col(p, "core", 0xfff8dc),
        size: num(p, "size", 1),
        durationMs: num(p, "duration_ms", 550),
      }),
  },
  {
    id: "ground_rift",
    name: "Ground Rift",
    description: "Glowing cracks race across the ground, the earth tears open into a dark pit with an eerie light, then ghostly light, wisps, dirt and bone chips burst out before the pit closes. Summons / Animate Dead (the creature rises out of the pit).",
    kind: "burst",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Rift glow", type: "color", default: "#6dffb0" },
      { key: "accent", label: "Wisps", type: "color", default: "#b48cff" },
      { key: "soil", label: "Soil", type: "color", default: "#3a2a1e" },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.4, max: 2.5, step: 0.05, unit: "×" },
      { ...dur("duration_ms", 600, 200, 2400), label: "Opening time" },
      { key: "hold_ms", label: "Stays open", type: "number", default: 900, min: 0, max: 4000, step: 50, unit: "ms" },
    ],
    play: (s, _f, t, p) =>
      groundRift(s, t, {
        color: col(p, "color", 0x6dffb0),
        accent: col(p, "accent", 0xb48cff),
        soil: col(p, "soil", 0x3a2a1e),
        size: num(p, "size", 1),
        durationMs: num(p, "duration_ms", 600),
        holdMs: num(p, "hold_ms", 900),
      }),
  },
  {
    id: "enchant_spiral",
    name: "Enchantment Spiral",
    description: "Three tilted rings of light with comet heads orbit the target, spiralling in and speeding up, then bloom in a flash with ground and upright rings, a star glint and sparkles. Sleep, Charm, Light, Push, Daylight.",
    kind: "burst",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Main", type: "color", default: hex(VFX_COLOURS.buff) },
      { key: "accent", label: "Accent", type: "color", default: "#b9a4ff" },
      { key: "core", label: "Core", type: "color", default: "#ffffff" },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.4, max: 2.5, step: 0.05, unit: "×" },
      { ...dur("duration_ms", 700, 250, 2400), label: "Build-up" },
    ],
    play: (s, _f, t, p) =>
      enchantSpiral(s, t, {
        color: col(p, "color", VFX_COLOURS.buff),
        accent: col(p, "accent", 0xb9a4ff),
        core: col(p, "core", 0xffffff),
        size: num(p, "size", 1),
        durationMs: num(p, "duration_ms", 700),
      }),
  },
  {
    id: "teleport_blink",
    name: "Teleport Blink",
    description: "A portal rips open at the caster and swallows them, a streak of light arcs to the destination, and a second portal bursts open there with a flash, rings and sparkles. Misty Step / teleports (the caster is pulled in and stepped out by the scene).",
    kind: "projectile",
    colorKey: "color",
    durationKey: "streak_ms",
    params: [
      { key: "color", label: "Portal", type: "color", default: hex(VFX_COLOURS.arcane) },
      { key: "accent", label: "Rim & sparks", type: "color", default: "#7fe8ff" },
      { key: "core", label: "Core", type: "color", default: "#ffffff" },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.4, max: 2.5, step: 0.05, unit: "×" },
      { key: "implode_ms", label: "Departure", type: "number", default: 220, min: 80, max: 1200, step: 10, unit: "ms" },
      { key: "streak_ms", label: "Streak time", type: "number", default: 220, min: 60, max: 1200, step: 10, unit: "ms" },
    ],
    play: (s, f, t, p) =>
      teleportBlink(s, f, t, {
        color: col(p, "color", VFX_COLOURS.arcane),
        accent: col(p, "accent", 0x7fe8ff),
        core: col(p, "core", 0xffffff),
        size: num(p, "size", 1),
        implodeMs: num(p, "implode_ms", 220),
        streakMs: num(p, "streak_ms", 220),
      }),
  },
  {
    id: "curse_aura",
    name: "Curse Aura",
    description: "A purple summoning sigil opens under the target, shadow tendrils claw up, dark smoke swirls in and sickly eyes open above; then the curse takes with a collapsing ring, a shadow pulse and sickly motes drifting down. Hexes, curses and other debuffs.",
    kind: "burst",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Sigil glow", type: "color", default: hex(VFX_COLOURS.curse) },
      { key: "shadow", label: "Shadow", type: "color", default: "#14081f" },
      { key: "accent", label: "Eyes & motes", type: "color", default: "#8cff5a" },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.4, max: 2.5, step: 0.05, unit: "×" },
      { ...dur("duration_ms", 800, 300, 2400), label: "Build-up" },
    ],
    play: (s, _f, t, p) =>
      curseHex(s, t, {
        color: col(p, "color", VFX_COLOURS.curse),
        shadow: col(p, "shadow", 0x14081f),
        accent: col(p, "accent", 0x8cff5a),
        size: num(p, "size", 1),
        durationMs: num(p, "duration_ms", 800),
      }),
  },
  {
    id: "holy_smite",
    name: "Holy Smite",
    description: "A pillar of light crashes down from the sky onto the target: white flash, cross-shaped glint, halo rings rolling along the ground, rising motes of light and dark ash burning off. Turn Undead (with the scene's own caster channel before it).",
    kind: "burst",
    colorKey: "color",
    durationKey: "drop_ms",
    params: [
      { key: "color", label: "Light", type: "color", default: hex(VFX_COLOURS.buff) },
      { key: "core", label: "Core", type: "color", default: "#ffffff" },
      { key: "ash", label: "Ash", type: "color", default: "#3b3640" },
      { key: "size", label: "Size", type: "number", default: 1, min: 0.4, max: 2.5, step: 0.05, unit: "×" },
      { ...dur("drop_ms", 160, 40, 800), label: "Drop time" },
    ],
    play: (s, f, t, p) =>
      holySmite(s, f, t, {
        color: col(p, "color", VFX_COLOURS.buff),
        core: col(p, "core", 0xffffff),
        ash: col(p, "ash", 0x3b3640),
        size: num(p, "size", 1),
        dropMs: num(p, "drop_ms", 160),
      }),
  },
  {
    id: "radial_burst",
    name: "Radial Burst",
    description: "An expanding orb, ring and scatter of sparks. Status applies, teleports, summons, Turn Undead.",
    kind: "burst",
    colorKey: "color",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.arcane) },
      { key: "ember", label: "Sparks", type: "color", default: hex(VFX_COLOURS.white) },
      { key: "radius", label: "Size", type: "number", default: 30, min: 8, max: 120, step: 1, unit: "px" },
    ],
    play: (s, _f, t, p) =>
      radialBurst(
        s,
        t,
        col(p, "color", VFX_COLOURS.arcane),
        col(p, "ember", VFX_COLOURS.white),
        num(p, "radius", 30),
      ),
  },
  {
    id: "explosion_burst",
    name: "Explosion",
    description: "A big fire-coloured radial burst — fireball-style impacts.",
    kind: "burst",
    colorKey: "color",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.fire) },
      { key: "ember", label: "Sparks", type: "color", default: hex(VFX_COLOURS.ember) },
      { key: "radius", label: "Size", type: "number", default: 64, min: 8, max: 160, step: 1, unit: "px" },
    ],
    play: (s, _f, t, p) =>
      radialBurst(
        s,
        t,
        col(p, "color", VFX_COLOURS.fire),
        col(p, "ember", VFX_COLOURS.ember),
        num(p, "radius", 64),
      ),
  },
];

const BY_ID = new Map(FX_DEFS.map((d) => [d.id, d]));

export function getFxDef(id: string): FxDef | undefined {
  return BY_ID.get(id);
}

/** Every parameter's default for one FX. */
export function fxDefaults(def: FxDef): FxParams {
  const out: FxParams = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

/** Keep only known keys with values of the right type (and numbers
 *  clamped to range) — a hand-edited fx.json can't break an effect. */
export function cleanFxParams(def: FxDef, raw: unknown): FxParams {
  const out: FxParams = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const p of def.params) {
    const v = r[p.key];
    if (p.type === "color") {
      if (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v.trim())) {
        out[p.key] = v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`;
      }
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[p.key] = Math.min(p.max, Math.max(p.min, v));
    }
  }
  return out;
}

// ── FX records (fx.json) ─────────────────────────────────────────────
//
// An FX record is what the rest of the game references by `fx_id`: one
// named effect = a built-in visual (above) + its tuning + the sounds
// that go with it. Several records can share a visual ("Lightning
// Strike" and "Lich Bolt" both draw `lightning_bolt`, tuned
// differently).
//
//   { "id": "lightning_strike", "name": "Lightning Strike",
//     "visual": "lightning_bolt", "params": { "width": 5 },
//     "cast_sfx": "fireball", "hit_sfx": "explosion" }
//
// `visual` defaults to the record's own id, so an old tuning-only
// record (`{ id: "hellfire", params }`) still works. `visual: "none"`
// is a sound-only FX. A built-in visual id with no record of its own
// still resolves (to its defaults, silent), so code that names a
// visual directly keeps working.

export interface FxRecord {
  id: string;
  name?: string;
  description?: string;
  /** Built-in visual id (FX_DEFS) or "none". Defaults to `id`. */
  visual?: string;
  params?: Record<string, unknown>;
  /** Sfx name played when the effect starts. "" = silent. */
  cast_sfx?: string;
  /** Sfx name played on impact. "" = silent. */
  hit_sfx?: string;
  /** Optional second visual played ON the target when the main visual
   *  lands (e.g. Fireball's explosion) — a burst-kind visual id plus
   *  its own tuning. Absent / visual "none" = no impact visual. */
  impact?: FxImpact | null;
  /** Optional camera shake when the main visual lands. Absent or
   *  intensity 0 = no shake. */
  shake?: FxShake | null;
}

export interface FxImpact {
  visual?: string;
  params?: Record<string, unknown>;
}

export interface FxShake {
  intensity?: number;
  duration_ms?: number;
}

/** Editable shake settings (same shape as a visual's params so the
 *  editor can reuse its param rows). */
export const SHAKE_PARAMS: ReadonlyArray<FxParamDef> = [
  { key: "intensity", label: "Shake strength", type: "number", default: 0, min: 0, max: 0.03, step: 0.001 },
  { key: "duration_ms", label: "Shake length", type: "number", default: 240, min: 40, max: 1500, step: 10, unit: "ms" },
];

const RECORDS = new Map<string, FxRecord>();
let _seeded = false;
let _inflight: Promise<void> | null = null;

function recordsFrom(raw: unknown): FxRecord[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { fx?: unknown }).fx)
      ? (raw as { fx: unknown[] }).fx
      : [];
  return list.filter(
    (r): r is FxRecord => !!r && typeof r === "object" && typeof (r as FxRecord).id === "string",
  );
}

/** Install a module's merged fx.json (`{ fx: [...] }` or the bare
 *  array). Replaces whatever was installed before. */
export function setFxRecords(raw: unknown): void {
  RECORDS.clear();
  for (const r of recordsFrom(raw)) RECORDS.set(r.id, r);
  _seeded = true;
}

/** @deprecated old name — fx.json used to hold tuning only. */
export const setFxOverrides = setFxRecords;

/** Make sure some FX records are installed. Play mode seeds them from
 *  the module chain (seedBattleCaches); anything that skips that (the
 *  editor's battle simulator) falls back to the default module's
 *  fx.json. Never throws. */
export async function ensureFxRecords(
  url = "/modules/default/fx.json",
): Promise<void> {
  if (_seeded) return;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const { withBasePath } = await import("@/util/basePath");
      const res = await fetch(withBasePath(url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!_seeded) setFxRecords(await res.json());
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[fxCatalog] failed to load ${url}`);
      _seeded = true;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Look up an FX by id. Falls back to a bare record for a built-in
 *  visual id that has no record of its own. Null for empty / unknown. */
export function getFxRecord(id: string | null | undefined): FxRecord | null {
  if (!id) return null;
  const rec = RECORDS.get(id);
  if (rec) return rec;
  const def = getFxDef(id);
  if (def) return { id, name: def.name, visual: id, cast_sfx: "", hit_sfx: "" };
  return null;
}

/** Every installed FX record. */
export function listFxRecords(): FxRecord[] {
  return Array.from(RECORDS.values());
}

/** The built-in visual a record draws (null = sound-only / unknown). */
export function fxVisualDef(rec: FxRecord | null | undefined): FxDef | null {
  if (!rec) return null;
  const v = (rec.visual ?? rec.id ?? "").trim();
  if (!v || v === "none") return null;
  return getFxDef(v) ?? null;
}

/** Key to hand the projectile registry for a record: its id when it
 *  has a visual, "" when it is sound-only or missing. */
export function fxVisualKey(rec: FxRecord | null | undefined): string {
  return rec && fxPartsVisible(fxRecordParts(rec)) ? rec.id : "";
}

/** Defaults ⊕ record params for a record, against its visual. */
export function fxRecordParams(rec: FxRecord): FxParams {
  const def = fxVisualDef(rec);
  if (!def) return {};
  return { ...fxDefaults(def), ...cleanFxParams(def, rec.params) };
}

/** Defaults ⊕ the installed record's params for one FX id. */
export function fxParams(id: string): FxParams {
  const rec = getFxRecord(id);
  return rec ? fxRecordParams(rec) : {};
}

/** The impact visual a record plays on the target (null = none). */
export function fxImpactDef(rec: FxRecord | null | undefined): FxDef | null {
  const v = (rec?.impact?.visual ?? "").trim();
  if (!v || v === "none") return null;
  return getFxDef(v) ?? null;
}

/** Defaults ⊕ the record's impact params, against its impact visual. */
export function fxImpactParams(rec: FxRecord): FxParams {
  const def = fxImpactDef(rec);
  if (!def) return {};
  return { ...fxDefaults(def), ...cleanFxParams(def, rec.impact?.params) };
}

/** The record's shake, or null when it has none. */
export function fxShake(
  rec: FxRecord | null | undefined,
): { intensity: number; durationMs: number } | null {
  const i = Number(rec?.shake?.intensity);
  if (!(i > 0)) return null;
  const d = Number(rec?.shake?.duration_ms);
  return { intensity: Math.min(i, 0.03), durationMs: d > 0 ? d : 240 };
}

/** Everything one FX draws, resolved: main visual, impact visual,
 *  shake. The game (playFx) and the editor preview both play an FX
 *  through these parts, so the preview matches play exactly. */
export interface FxParts {
  def: FxDef | null;
  params: FxParams;
  impactDef: FxDef | null;
  impactParams: FxParams;
  shake: { intensity: number; durationMs: number } | null;
}

export function fxRecordParts(rec: FxRecord): FxParts {
  return {
    def: fxVisualDef(rec),
    params: fxRecordParams(rec),
    impactDef: fxImpactDef(rec),
    impactParams: fxImpactParams(rec),
    shake: fxShake(rec),
  };
}

/** True when the parts draw anything at all. */
export function fxPartsVisible(parts: FxParts): boolean {
  return !!(parts.def || parts.impactDef || parts.shake);
}

/** Play resolved FX parts: the main visual (awaited), then — the
 *  moment it lands — the shake and the impact visual on the target.
 *  Resolves at the moment of impact (the impact visual keeps playing),
 *  so the caller's hit sound / damage numbers land in sync with it. */
export async function playFxParts(
  scene: Phaser.Scene,
  from: Pt,
  to: Pt,
  parts: FxParts,
): Promise<void> {
  if (parts.def) await parts.def.play(scene, from, to, parts.params);
  if (parts.shake) screenShake(scene, parts.shake.intensity, parts.shake.durationMs);
  if (parts.impactDef) {
    void parts.impactDef.play(scene, to, to, parts.impactParams).catch(() => undefined);
  }
}

/** Play an FX (by record id or built-in visual id) with its tuning,
 *  plus any per-call knobs. Visual only — sounds are the caller's.
 *  Resolves at the moment of impact (see playFxParts). */
export function playFx(
  id: string,
  scene: Phaser.Scene,
  from: Pt,
  to: Pt,
  call: FxCallConfig = {},
): Promise<void> {
  const rec = getFxRecord(id);
  if (!rec) return Promise.resolve();
  const parts = fxRecordParts(rec);
  if (!fxPartsVisible(parts)) return Promise.resolve();
  const def = parts.def;
  const p = parts.params;
  if (def) {
    if (call.color !== undefined && def.colorKey) p[def.colorKey] = numToHex(call.color);
    if (call.durationMs !== undefined && def.durationKey) p[def.durationKey] = call.durationMs;
    if (call.segments !== undefined && def.params.some((x) => x.key === "segments")) {
      p.segments = call.segments;
    }
  }
  return playFxParts(scene, from, to, parts);
}

/** Test-only — forget installed records. */
export function __resetFxRecordsForTests(): void {
  RECORDS.clear();
  _seeded = false;
  _inflight = null;
}
