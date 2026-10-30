/**
 * NPC behavior — how an NPC acts on the map while the party explores.
 * Authored per NPC record as `behavior` in npcs.json:
 *
 *   - "wander" (default) — each party step, rolls NPC_WANDER_CHANCE
 *     to drift one cardinal tile (see npcWander.ts).
 *   - "dance"            — never leaves its cell; the sprite sways
 *     side to side in place (musicians, revellers, a happy dog).
 *   - "still"            — never leaves its cell and doesn't animate
 *     (guards, shopkeepers behind a counter, statues-that-talk).
 *
 * A missing / unknown value reads as "wander" so every NPC authored
 * before this field existed keeps its old behaviour.
 */

export type NpcBehavior = "wander" | "dance" | "still";

export const NPC_BEHAVIORS: ReadonlyArray<{ value: NpcBehavior; label: string }> = [
  { value: "wander", label: "Wander" },
  { value: "dance", label: "Dance (sway in place)" },
  { value: "still", label: "Stay still" },
];

export const DEFAULT_NPC_BEHAVIOR: NpcBehavior = "wander";

export function normalizeNpcBehavior(v: unknown): NpcBehavior {
  return v === "dance" || v === "still" ? v : DEFAULT_NPC_BEHAVIOR;
}

/** Only wandering NPCs take part in the per-step wander roll. */
export function npcBehaviorWanders(v: unknown): boolean {
  return normalizeNpcBehavior(v) === "wander";
}

/** Dance sway tuning, shared by the play scene and the editor preview.
 *  The sprite tilts ±`angle` degrees about its centre, one half-sway
 *  every `durationMs`, easing in and out like a slow rock to music. */
export const NPC_DANCE_SWAY = {
  angle: 8,
  durationMs: 450,
} as const;

/** Minimal tween surface (Phaser's `scene.tweens`), typed loosely so
 *  this module needs no Phaser import at runtime. */
interface TweenHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  add(config: any): unknown;
}

/** Start the dance sway on an NPC overlay image. A random start delay
 *  keeps a band of musicians from swaying in perfect lockstep. */
export function startNpcDance(tweens: TweenHost, target: object): void {
  tweens.add({
    targets: target,
    angle: { from: -NPC_DANCE_SWAY.angle, to: NPC_DANCE_SWAY.angle },
    duration: NPC_DANCE_SWAY.durationMs,
    ease: "Sine.easeInOut",
    yoyo: true,
    repeat: -1,
    delay: Math.floor(Math.random() * NPC_DANCE_SWAY.durationMs),
  });
}
