/**
 * Per-tile Phaser particle-emitter configs used by all on-map
 * scenes (overworld map editor, dungeon simulator, and any future
 * /play renderer).
 *
 * Keys are the values a cell's `animation` field can hold (other
 * than `"none"`, which means "no emitter"). Each entry is a
 * Phaser `ParticleEmitterConfig` minus the texture key — callers
 * pass `"__particle"` as the texture and rely on the scene's
 * pre-generated white-circle source for ADD-blended ember effects.
 *
 * Why a shared module: the editor's overworld scene had its own
 * inline copy and the dungeon scene had a partial copy (just
 * `torch`). They drifted; this file is the single source of
 * truth. Add new entries here so every scene that consults the
 * `animation` field picks them up uniformly.
 */

/** Closed set of supported per-tile animations. Mirrors the
 *  editor's `TileType.animation` discriminator. */
export type AnimationKind = "torch" | "fire" | "fairy" | "smoke" | "daylight";

export const ANIMATION_CONFIGS = {
  torch: {
    speedX: { min: -10, max: 10 },
    speedY: { min: -40, max: -20 },
    lifespan: { min: 400, max: 700 },
    scale: { start: 0.35, end: 0 },
    alpha: { start: 1, end: 0 },
    frequency: 80,
    tint: [0xffaa44, 0xff6622, 0xffdd66],
    blendMode: "ADD" as const,
  },
  fire: {
    speedX: { min: -20, max: 20 },
    speedY: { min: -60, max: -30 },
    lifespan: { min: 500, max: 900 },
    scale: { start: 0.55, end: 0 },
    alpha: { start: 1, end: 0 },
    frequency: 40,
    tint: [0xff3322, 0xff8844, 0xffdd66],
    blendMode: "ADD" as const,
  },
  fairy: {
    speedX: { min: -25, max: 25 },
    speedY: { min: -25, max: 5 },
    lifespan: { min: 1500, max: 2500 },
    scale: { start: 0.25, end: 0 },
    alpha: { start: 1, end: 0 },
    frequency: 220,
    tint: [0xaaeeff, 0xeeaaff, 0xffffff, 0x88ffcc],
    blendMode: "ADD" as const,
  },
  smoke: {
    speedX: { min: -10, max: 10 },
    speedY: { min: -25, max: -12 },
    lifespan: { min: 1000, max: 1800 },
    scale: { start: 0.4, end: 0.9 },
    alpha: { start: 0.55, end: 0 },
    frequency: 130,
    tint: [0x555555, 0x777777, 0x444444],
  },
  // Daylight spilling through an opening (the dungeon's way out): a few
  // slow, warm dust motes drifting out into the room. The breathing
  // glow behind them is an extra layer — see ANIMATION_EXTRA_LAYERS.
  daylight: {
    speedX: { min: -7, max: 7 },
    speedY: { min: 4, max: 14 },
    lifespan: { min: 1800, max: 2800 },
    scale: { start: 0.2, end: 0.05 },
    alpha: { start: 0.75, end: 0 },
    frequency: 260,
    tint: [0xfff4d0, 0xffe9a8, 0xffffff],
    blendMode: "ADD" as const,
  },
} as const;

/** Extra emitters some animations stack under their main one. The map
 *  renderer adds these; anywhere that only reads ANIMATION_CONFIGS (the
 *  combat arena) just gets the main layer. */
export const ANIMATION_EXTRA_LAYERS: Partial<
  Record<AnimationKind, ReadonlyArray<Record<string, unknown>>>
> = {
  // A soft, slowly pulsing halo of daylight: big faint particles that
  // swell and fade, overlapping so the glow breathes rather than blinks.
  daylight: [
    {
      speedX: 0,
      speedY: 0,
      lifespan: 2600,
      scale: { start: 1.3, end: 2.1 },
      alpha: { start: 0.24, end: 0 },
      frequency: 1300,
      tint: 0xfff0c4,
      blendMode: "ADD",
    },
  ],
};
