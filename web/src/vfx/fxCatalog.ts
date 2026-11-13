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
 * `setFxOverrides`) ⊕ any per-call knobs from the caller. The editor
 * preview calls `def.play` with the unsaved form values directly, so
 * edits show up immediately.
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
  projectileLine,
  radialBurst,
  voidOrb,
  VFX_COLOURS,
} from "./Vfx";

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
    description: "A jagged bolt drawn instantly from caster to target, then fading.",
    kind: "projectile",
    colorKey: "color",
    durationKey: "fade_ms",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.lightning) },
      { key: "width", label: "Thickness", type: "number", default: 3, min: 1, max: 10, step: 1, unit: "px" },
      { key: "segments", label: "Kinks", type: "number", default: 6, min: 2, max: 20, step: 1 },
      { key: "jitter", label: "Jaggedness", type: "number", default: 14, min: 0, max: 48, step: 1, unit: "px" },
      dur("fade_ms", 280),
    ],
    play: (s, f, t, p) =>
      lightningZigzag(s, f, t, Math.round(num(p, "segments", 6)), {
        color: col(p, "color", VFX_COLOURS.lightning),
        width: num(p, "width", 3),
        jitter: num(p, "jitter", 14),
        fadeMs: num(p, "fade_ms", 280),
      }),
  },
  {
    id: "meteor_strike",
    name: "Meteor Strike",
    description: "A blazing meteor falls from the sky onto the target with a fiery impact.",
    kind: "burst",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.fire) },
      dur("duration_ms", 360),
    ],
    play: (s, f, t, p) =>
      meteorStrike(s, f, t, col(p, "color", VFX_COLOURS.fire), num(p, "duration_ms", 360)),
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
    description: "A glowing shaft with a bright tip, sparkle trail and a fragmenting impact.",
    kind: "projectile",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.lightning) },
      dur("duration_ms", 280),
    ],
    play: (s, f, t, p) =>
      magicArrow(s, f, t, col(p, "color", VFX_COLOURS.lightning), num(p, "duration_ms", 280)),
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
    id: "curse_aura",
    name: "Curse Aura",
    description: "The aura ring in curse purple. Hexes, curses and other debuffs.",
    kind: "burst",
    colorKey: "color",
    durationKey: "duration_ms",
    params: [
      { key: "color", label: "Colour", type: "color", default: hex(VFX_COLOURS.curse) },
      { key: "radius", label: "Size", type: "number", default: 28, min: 8, max: 96, step: 1, unit: "px" },
      { key: "width", label: "Ring thickness", type: "number", default: 2, min: 1, max: 8, step: 1, unit: "px" },
      dur("duration_ms", 520),
    ],
    play: (s, _f, t, p) =>
      glowAura(s, t, col(p, "color", VFX_COLOURS.curse), {
        radius: num(p, "radius", 28),
        width: num(p, "width", 2),
        durationMs: num(p, "duration_ms", 520),
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

// ── Module overrides (fx.json) ───────────────────────────────────────

const OVERRIDES = new Map<string, FxParams>();

/** Install a module's fx.json records (`[{ id, params }]`). Unknown
 *  ids and bad values are dropped. Replaces any previous overrides. */
export function setFxOverrides(records: unknown): void {
  OVERRIDES.clear();
  const list = Array.isArray(records)
    ? records
    : records && typeof records === "object" && Array.isArray((records as { fx?: unknown }).fx)
      ? ((records as { fx: unknown[] }).fx)
      : [];
  for (const rec of list) {
    if (!rec || typeof rec !== "object") continue;
    const id = (rec as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const def = getFxDef(id);
    if (!def) continue;
    OVERRIDES.set(id, cleanFxParams(def, (rec as { params?: unknown }).params));
  }
}

/** Defaults ⊕ module overrides for one FX. */
export function fxParams(id: string): FxParams {
  const def = getFxDef(id);
  if (!def) return {};
  return { ...fxDefaults(def), ...(OVERRIDES.get(id) ?? {}) };
}

/** Play an FX with the module's tuning, plus any per-call knobs. */
export function playFx(
  id: string,
  scene: Phaser.Scene,
  from: Pt,
  to: Pt,
  call: FxCallConfig = {},
): Promise<void> {
  const def = getFxDef(id);
  if (!def) return Promise.resolve();
  const p = fxParams(id);
  if (call.color !== undefined && def.colorKey) p[def.colorKey] = numToHex(call.color);
  if (call.durationMs !== undefined && def.durationKey) p[def.durationKey] = call.durationMs;
  if (call.segments !== undefined && def.params.some((x) => x.key === "segments")) {
    p.segments = call.segments;
  }
  return def.play(scene, from, to, p);
}
