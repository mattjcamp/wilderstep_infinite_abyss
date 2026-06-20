/**
 * Data-driven dispatch for projectile-style spell VFX.
 *
 * The combat scene was previously full of `if (spell.effect_type === ...)`
 * branches that hard-coded which Vfx helper drew each spell. That meant
 * adding a new spell required editing combat code in two places: one to
 * register the dispatch branch, another in the data file to declare the
 * spell. This registry pulls the dispatch out of combat code and into
 * a single lookup keyed by `effect_type`:
 *
 *     const effect = resolveProjectileEffect(spell);
 *     await effect(scene, from, to);
 *
 * To add a new projectile-style spell visual, call `registerProjectileEffect`
 * at module load (or import this file and register from the new effect's
 * own module). No CombatScene changes required.
 *
 * Scope note: this registry covers *projectile* effects — the caster →
 * target line a spell draws while in flight. Burst, halo, screen-shake,
 * floating-text, and on-impact effects are still triggered directly by
 * CombatScene's animation code; they're event-driven rather than
 * spell-driven and a registry buys nothing there. If/when the new
 * Phaser sim grows its own spell casts, it imports `resolveProjectileEffect`
 * and gets the same visuals "for free".
 */

import type Phaser from "phaser";
import {
  lightningZigzag,
  meteorStrike,
  magicDart,
  magicArrow,
  voidOrb,
  projectileLine,
  healingSparkles,
  glowAura,
  radialBurst,
  VFX_COLOURS,
} from "./Vfx";

/** Screen-space pixel coordinate. */
export interface Pt {
  x: number;
  y: number;
}

/** Optional knobs every projectile effect understands. Effects are free
 *  to ignore values that don't apply to them — `segments` is a noop
 *  for a smooth orb, `color` is a noop for a fixed-palette zigzag, etc. */
export interface ProjectileEffectConfig {
  /** Tint as 0xRRGGBB. Effect-specific defaults apply when omitted. */
  color?: number;
  /** Total flight time in milliseconds. Effects pick a sensible default. */
  durationMs?: number;
  /** For jagged effects (lightning), the number of kink segments. */
  segments?: number;
}

/** Signature every projectile effect implements. Returns a Promise that
 *  resolves when the visual finishes, so combat code can `await` it
 *  before resolving damage and queueing the next animation. */
export type ProjectileEffectFn = (
  scene: Phaser.Scene,
  from: Pt,
  to: Pt,
  config?: ProjectileEffectConfig,
) => Promise<void>;

/** Minimal subset of the spell record the resolver reads. Kept narrow
 *  so this module doesn't pull in the full Spell type — callers can
 *  pass either the live Spell or a lightweight `{ id, effect_type }`. */
export interface SpellLike {
  id?: string;
  effect_type?: string;
}

/** The default projectile when no `effect_type` match is found — a
 *  gentle bowed arcane line. Matches the pre-registry fallback in
 *  CombatScene so unmigrated spells render identically. */
const DEFAULT_PROJECTILE: ProjectileEffectFn = (scene, from, to, cfg) =>
  projectileLine(
    scene,
    from,
    to,
    cfg?.color ?? VFX_COLOURS.arcane,
    cfg?.durationMs ?? 220,
  );

/** The registry itself. Mutable so feature code can `registerProjectileEffect`
 *  new entries at module load without editing this file. */
const PROJECTILE_REGISTRY = new Map<string, ProjectileEffectFn>();

/** Register (or override) the projectile effect for a given `effect_type`.
 *  Calling with an existing key replaces the previous entry — useful
 *  for tests or for a downstream module that wants to swap a default
 *  effect for a fancier one. */
export function registerProjectileEffect(
  effectType: string,
  fn: ProjectileEffectFn,
): void {
  PROJECTILE_REGISTRY.set(effectType, fn);
}

/** Look up the effect for a spell-like input. Returns the registered
 *  renderer if one exists, otherwise the default bowed projectile.
 *
 *  Callers in v1 combat now pass `{ effect_type: animation.visual }`
 *  exclusively — the resolver looks up the visual key registered
 *  under that name. The shape stays SpellLike (rather than just
 *  taking a string) so the API can grow extra fields without
 *  changing every call site. */
export function resolveProjectileEffect(spell: SpellLike): ProjectileEffectFn {
  if (spell.effect_type) {
    const entry = PROJECTILE_REGISTRY.get(spell.effect_type);
    if (entry) return entry;
  }
  return DEFAULT_PROJECTILE;
}

/** Exposed for tests that want to introspect the live key set. Returns
 *  a fresh array each call so callers can't mutate the registry by
 *  accident. */
export function listRegisteredProjectileEffects(): string[] {
  return Array.from(PROJECTILE_REGISTRY.keys());
}

/** Test-only — wipe the registry back to its seeded defaults. Useful
 *  when a test wants to register a stub effect, run, and roll back. */
export function __resetProjectileRegistryForTests(): void {
  PROJECTILE_REGISTRY.clear();
  seedDefaults();
}

// ── Built-in effects ────────────────────────────────────────────────
// Seeded at module load so any importer sees the standard library.
function seedDefaults(): void {
  // Jagged poly-line drawn instantly, then alpha-faded. The lightning
  // bolt v1 already had — same visual, now data-driven.
  registerProjectileEffect("lightning_bolt", (scene, from, to, cfg) =>
    lightningZigzag(scene, from, to, cfg?.segments ?? 6),
  );

  // Falling star — descends from above the target into a fiery burst.
  // Used by `damage_type: "meteor"` ranged weapons (Starfall Sling).
  registerProjectileEffect("meteor_strike", (scene, from, to, cfg) =>
    meteorStrike(
      scene,
      from,
      to,
      cfg?.color ?? VFX_COLOURS.fire,
      cfg?.durationMs ?? 360,
    ),
  );

  // Fast arcane orb with sparkle trail + bright impact pop. Pre-rename
  // "Magic Dart" — the `id: "fireball"` legacy alias also maps here
  // via resolveProjectileEffect.
  registerProjectileEffect("magic_dart", (scene, from, to, cfg) =>
    magicDart(
      scene,
      from,
      to,
      cfg?.color ?? VFX_COLOURS.arcane,
      cfg?.durationMs ?? 240,
    ),
  );

  // Glowing multi-coloured sphere that churns through a void palette
  // in flight, then implodes + erupts on impact. Used by Void Orb.
  registerProjectileEffect("void_orb", (scene, from, to, cfg) =>
    voidOrb(
      scene,
      from,
      to,
      cfg?.color ?? VFX_COLOURS.curse,
      cfg?.durationMs ?? 520,
    ),
  );

  // Glowing shaft + sparkle trail + fragmented impact. Used by Magic
  // Arrow / similar aimed-magic spells.
  registerProjectileEffect("magic_arrow", (scene, from, to, cfg) =>
    magicArrow(
      scene,
      from,
      to,
      cfg?.color ?? VFX_COLOURS.lightning,
      cfg?.durationMs ?? 280,
    ),
  );

  // Generic bowed line — registered explicitly so an animation can
  // ask for it by name instead of relying on the unknown-key
  // fallback. Behavior is identical to the default fallback.
  registerProjectileEffect("projectile_line", (scene, from, to, cfg) =>
    projectileLine(
      scene,
      from,
      to,
      cfg?.color ?? VFX_COLOURS.arcane,
      cfg?.durationMs ?? 220,
    ),
  );

  // Fire-tinted bowed line — same shape as projectile_line but
  // burning orange. Pairs with fire-themed cast/hit SFX for spells
  // like fireball.
  registerProjectileEffect("fire_projectile", (scene, from, to, cfg) =>
    projectileLine(
      scene,
      from,
      to,
      cfg?.color ?? VFX_COLOURS.fire,
      cfg?.durationMs ?? 280,
    ),
  );

  // ── Point-effects (caster→target line ignored) ──────────────────
  // These visuals only need a target location. We accept the
  // projectile signature for uniformity — `from` is unused. Cast
  // paths that don't naturally have a "from" pass `to` for both.

  // Rising green sparkles below the target — heals.
  registerProjectileEffect("heal_sparkles", (scene, _from, to) =>
    healingSparkles(scene, to),
  );

  // Soft expanding gold ring — generic positive buff aura. Used for
  // bless, shield, long_shanks, invisibility, light.
  registerProjectileEffect("buff_aura", (scene, _from, to, cfg) =>
    glowAura(scene, to, cfg?.color ?? VFX_COLOURS.buff),
  );

  // Soft expanding purple ring — negative effect aura. Used for
  // curse and similar debuffs.
  registerProjectileEffect("curse_aura", (scene, _from, to) =>
    glowAura(scene, to, VFX_COLOURS.curse),
  );

  // Expanding orb + ring + scatter dots — generic arcane burst.
  // Used for status applies on enemies (sleep, charm), teleport
  // arrival, summons.
  registerProjectileEffect("radial_burst", (scene, _from, to, cfg) =>
    radialBurst(
      scene,
      to,
      cfg?.color ?? VFX_COLOURS.arcane,
      VFX_COLOURS.white,
      30,
    ),
  );

  // Fire-tinted radial — used as the AOE on-impact for fireball-
  // style spells (the projectile is separate).
  registerProjectileEffect("explosion_burst", (scene, _from, to) =>
    radialBurst(scene, to, VFX_COLOURS.fire, VFX_COLOURS.ember, 64),
  );
}

seedDefaults();
