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
export type AnimationKind = "torch" | "fire" | "fairy" | "smoke";

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
} as const;
