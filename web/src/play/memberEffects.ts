/**
 * Lingering member statuses on the map (exploration) — today: Poisoned.
 *
 * A poisoned member's saved effect carries its remaining duration in
 * MAP STEPS. Each step the party takes counts it down; every
 * `MAP_STEPS_PER_ROUND` steps the poison bites for `damage_per_turn`
 * HP (effects.json). On the map poison never drops anyone below 1 HP —
 * walking can't kill — but it stays until it runs out or is cured
 * (Antidote, Cure Poison, Restore, the temple's Cure Poisons).
 *
 * Pure: returns new members + the log lines to show. `changed` is false
 * when nobody is poisoned, so the caller can skip the save write.
 */

import type { SavedCharacterState } from "./saveTypes";
import { MAP_STEPS_PER_ROUND } from "@/battle/combat/effects/statusEffects";

export interface PoisonStepResult {
  members: SavedCharacterState[];
  lines: string[];
  changed: boolean;
}

export function tickPoisonOnStep(
  members: ReadonlyArray<SavedCharacterState>,
  opts: {
    /** HP lost per bite (effects.json `poisoned.params.damage_per_turn`). */
    damagePerTick: number;
    nameOf: (m: SavedCharacterState) => string;
  },
): PoisonStepResult {
  const lines: string[] = [];
  let changed = false;
  const next = members.map((m) => {
    const poison = (m.effects ?? []).find(
      (e) => e.id === "poisoned" && typeof e.duration === "number",
    );
    if (!poison || m.hp <= 0) return m;
    changed = true;
    const left = (poison.duration as number) - 1;
    let hp = m.hp;
    // A bite every MAP_STEPS_PER_ROUND steps (counted down from the
    // full duration, so the first lands a "round" after being poisoned).
    if (left % MAP_STEPS_PER_ROUND === 0) {
      const dmg = Math.max(1, Math.round(opts.damagePerTick));
      const after = Math.max(1, hp - dmg);
      if (after < hp) {
        lines.push(`${opts.nameOf(m)} suffers from poison (-${hp - after} HP).`);
        hp = after;
      }
    }
    const others = (m.effects ?? []).filter((e) => e !== poison);
    if (left <= 0) {
      lines.push(`${opts.nameOf(m)} is no longer poisoned.`);
      return { ...m, hp, effects: others };
    }
    return { ...m, hp, effects: [...others, { id: "poisoned", duration: left }] };
  });
  return { members: next, lines, changed };
}

/** Cure poison on one member (Antidote / Cure Poison out of battle).
 *  Returns null when they weren't poisoned. */
export function curePoison(m: SavedCharacterState): SavedCharacterState | null {
  if (!(m.effects ?? []).some((e) => e.id === "poisoned")) return null;
  return { ...m, effects: m.effects.filter((e) => e.id !== "poisoned") };
}
