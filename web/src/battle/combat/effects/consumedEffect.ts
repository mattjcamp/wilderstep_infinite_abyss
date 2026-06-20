/**
 * `consumed` — the "swallowed whole" effect (the Man Eater's signature,
 * but now applier-agnostic). Ported off the bespoke `Combatant.consumed`
 * field onto the generic effect runtime so ANY applier can inflict it:
 * a monster on-hit, a spell, a creature ability.
 *
 * Lifecycle:
 *   - onApply: roll the bearer's STR save vs the effect's `save_dc`.
 *       Pass → the effect doesn't take hold (they twist free).
 *       Fail → stash their cell, move them off-board, emit "applied".
 *   - controlsTurn: a swallowed bearer takes no player/AI turn.
 *   - runTurn: re-roll the STR save each of their slots. Pass → spat
 *       out near the consumer (emit "saved"). Fail → take
 *       `damage_per_turn`; if that kills them, the body tumbles out.
 *       Consumer already dead → tumble free without rolling.
 *
 * Params (merged effects.json defaults + applier overrides):
 *   - `save_dc`         (default 12) — DC for the STR escape/resist roll
 *   - `damage_per_turn` (default 1)  — HP lost each failed escape
 */

import type { Combatant } from "../../types";
import {
  registerEffectHandler,
  findEffect,
  numParam,
  type ActiveEffect,
  type Cell,
  type EffectContext,
  type EffectHost,
} from "./EffectRuntime";

const OFF_BOARD: Cell = { col: -1, row: -1 };

/** D&D-style ability modifier — floor((stat - 10) / 2). */
function abilityMod(stat: unknown): number {
  const n = typeof stat === "number" ? stat : 10;
  return Math.floor((n - 10) / 2);
}

// ── Public accessors (used by the engine + the scene) ──────────────

/** The `consumed` effect on a combatant, if they're swallowed. */
export function consumedEffect(c: Combatant): ActiveEffect | undefined {
  return findEffect(c, "consumed");
}

/** Whether a combatant is currently swallowed. */
export function isConsumed(c: Combatant): boolean {
  return consumedEffect(c) !== undefined;
}

// ── Release helpers (shared by escape, death-inside, consumer-killed) ─

/**
 * Spit a swallowed combatant back onto the board near their consumer
 * (or their original cell if the consumer's gone), drop the effect, and
 * emit a `saved` event for the scene to re-show + reposition the sprite.
 */
export function releaseConsumed(host: EffectHost, bearer: Combatant): void {
  const eff = consumedEffect(bearer);
  if (!eff) return;
  const consumer = eff.sourceId ? host.combatantById(eff.sourceId) : null;
  const original = (eff.state.originalPosition as Cell | undefined) ?? bearer.position;
  const anchor = consumer && consumer.hp > 0 ? consumer.position : original;
  const newPos = host.findFreeTileNear(anchor) ?? anchor;
  bearer.position = { ...newPos };
  host.removeEffect(bearer, eff);
  host.emitEvent({ targetId: bearer.id, kind: "saved" });
}

/** Release everyone swallowed by `consumerId` — called when a consumer
 *  dies so its belly empties out. */
export function releaseConsumedBy(
  host: EffectHost,
  combatants: readonly Combatant[],
  consumerId: string,
): void {
  for (const c of combatants) {
    if (consumedEffect(c)?.sourceId === consumerId) {
      releaseConsumed(host, c);
      host.log(`${c.name} tumbles free as the beast falls!`);
    }
  }
}

// ── Handler ─────────────────────────────────────────────────────────

function onApply(ctx: EffectContext): boolean {
  const { host, bearer, effect } = ctx;
  // Already inside something — don't double-swallow.
  if (isConsumed(bearer)) return false;

  const saveDc = numParam(effect.params, "save_dc", 12);
  const strMod = abilityMod(bearer.strength);
  const roll = 1 + Math.floor(host.rng() * 20);
  const total = roll + strMod;
  const consumer = effect.sourceId ? host.combatantById(effect.sourceId) : null;
  const consumerName = consumer?.name ?? "the beast";

  if (total >= saveDc) {
    host.log(
      `${bearer.name} twists free of ${consumerName}'s jaws! ` +
      `(STR ${roll}+${strMod}=${total} vs DC ${saveDc})`,
    );
    return false; // resisted — effect doesn't take hold
  }

  // Swallowed whole. Stash the cell so we can spit them back out near
  // it, then move them off-board so targeting / collision ignore them.
  effect.state.originalPosition = { ...bearer.position };
  bearer.position = { ...OFF_BOARD };
  host.log(
    `${consumerName} swallows ${bearer.name} whole! ` +
    `(STR ${roll}+${strMod}=${total} vs DC ${saveDc} — Failed!)`,
  );
  host.emitEvent({
    targetId: bearer.id,
    kind: "applied",
    consumerId: effect.sourceId ?? "",
  });
  return true;
}

function runTurn(ctx: EffectContext): void {
  const { host, bearer, effect } = ctx;
  const consumer = effect.sourceId ? host.combatantById(effect.sourceId) : null;

  // Consumer dead / gone → tumble free without rolling.
  if (!consumer || consumer.hp <= 0) {
    releaseConsumed(host, bearer);
    host.log(`${bearer.name} tumbles free as the beast falls!`);
    return;
  }

  const saveDc = numParam(effect.params, "save_dc", 12);
  const strMod = abilityMod(bearer.strength);
  const roll = 1 + Math.floor(host.rng() * 20);
  const total = roll + strMod;

  if (total >= saveDc) {
    // Escape — log first; releaseConsumed emits the `saved` event.
    host.log(
      `${bearer.name} fights free of ${consumer.name}! ` +
      `(STR ${roll}+${strMod}=${total} vs DC ${saveDc})`,
    );
    releaseConsumed(host, bearer);
    return;
  }

  // Save failed — take the per-turn crush damage.
  const dmg = numParam(effect.params, "damage_per_turn", 1);
  bearer.hp = Math.max(0, bearer.hp - dmg);
  host.log(
    `${bearer.name} is crushed inside ${consumer.name}! (-${dmg} HP) ` +
    `(STR ${roll}+${strMod}=${total} vs DC ${saveDc} — Failed!)`,
  );
  host.emitEvent({ targetId: bearer.id, kind: "tick", damage: dmg });
  if (bearer.hp === 0) {
    // Died inside — drop the body out so it can be revived later.
    releaseConsumed(host, bearer);
    host.log(`${bearer.name}'s body tumbles out, lifeless.`);
  }
}

registerEffectHandler({
  id: "consumed",
  onApply,
  controlsTurn: () => true,
  runTurn,
});
