/**
 * Numeric buffs / debuffs (Bless, Curse, Shield, Long Shanks, Elixir
 * bonuses, …) on the effect runtime. Previously these lived in a
 * parallel `Map<id, Buff[]>` on the engine with their own sum / tick /
 * expire helpers (`Buffs.ts`); now they're `ActiveEffect`s in the
 * unified `Combatant.effects` list, ticked by the same round mechanism
 * as everything else.
 *
 * They're modelled as a single generic `stat_modifier` effect: the
 * `params` carry the buff `kind` (`attack_bonus`, `ac_penalty`, …) and
 * its `value`; the `state` carries the remaining `turnsLeft` and the
 * `source` label used for the expiry flavour line. The handler's
 * round-tick decrements the duration and removes the effect (with a
 * "X's blessing fades." style log) when it runs out.
 *
 * The engine's public buff API (`addBuff` / `sumBuff` / `buffsFor` /
 * `effectiveAttackBonus` …) is preserved and reimplemented on top of
 * these helpers, so the ~10 callers (spell casting, class abilities,
 * elixirs) and the inspector are untouched.
 */

import { registerEffectHandler, numParam, type ActiveEffect } from "./EffectRuntime";
import { describeExpire, type Buff, type BuffKind } from "../Buffs";
import type { Combatant } from "../../types";

/** The single effect id every numeric buff/debuff is stored under. */
export const STAT_MODIFIER = "stat_modifier";

/** Wrap a `Buff` as an `ActiveEffect` for the unified effects list. */
export function makeBuffEffect(buff: Buff): ActiveEffect {
  return {
    effectId: STAT_MODIFIER,
    params: { kind: buff.kind, value: buff.value },
    state: { turnsLeft: buff.turnsLeft, source: buff.source },
  };
}

/** Sum the value of every active buff of `kind` on a combatant. */
export function sumBuffKind(bearer: Combatant, kind: BuffKind): number {
  let total = 0;
  for (const e of bearer.effects ?? []) {
    if (e.effectId === STAT_MODIFIER && e.params.kind === kind) {
      total += numParam(e.params, "value", 0);
    }
  }
  return total;
}

/** Reconstruct the `Buff[]` view (apply order preserved) — powers
 *  `buffsFor` / `hasBuffFromSource` and the inspector's Effects line. */
export function buffsOf(bearer: Combatant): Buff[] {
  const out: Buff[] = [];
  for (const e of bearer.effects ?? []) {
    if (e.effectId !== STAT_MODIFIER) continue;
    out.push({
      kind: e.params.kind as BuffKind,
      value: numParam(e.params, "value", 0),
      turnsLeft: numParam(e.state, "turnsLeft", 0),
      source: String(e.state.source ?? ""),
    });
  }
  return out;
}

registerEffectHandler({
  id: STAT_MODIFIER,
  // End-of-round: decrement the buff's remaining duration and expire it
  // (with the source-flavoured log line) when it hits zero. Mirrors the
  // old `tickBuffs` + `describeExpire` round-end pass.
  onRoundTick({ host, bearer, effect }) {
    const left = numParam(effect.state, "turnsLeft", Infinity) - 1;
    effect.state.turnsLeft = left;
    if (left <= 0) {
      host.removeEffect(bearer, effect);
      // Suppress the flavour line for downed combatants (the old
      // tickAllBuffs skipped expiry logs when hp <= 0).
      if (bearer.hp > 0) {
        host.log(describeExpire(bearer.name, String(effect.state.source ?? "")));
      }
    }
  },
});
