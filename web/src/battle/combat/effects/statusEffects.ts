/**
 * Status effects that change what a combatant does or suffers each
 * turn — the ones effects.json names but the engine didn't model
 * before:
 *
 *   - `poisoned` — `damage_per_turn` HP lost at the end of every round
 *                  for `duration` rounds. Blocked by `poison_immunity`.
 *   - `sleep`    — "Asleep": the bearer's turns are skipped for
 *                  `duration` of their own turns. Any damage wakes them
 *                  (checked at the start of their next turn).
 *   - `charm`    — "Charmed": the bearer fights for the side of whoever
 *                  charmed them (AI-controlled) for `duration` rounds,
 *                  then reverts.
 *   - `slowed`   — movement points halved (min 1) for `duration` rounds.
 *
 * Every change reports to the battle log (applied / each tick /
 * wearing off) and emits a `status` event so the scene floats a label
 * over the bearer. Durations / magnitudes come from the applier's
 * params, falling back to effects.json (seeded via
 * `setEffectCatalogDefaults`) and then to the defaults below.
 *
 * Re-applying an effect the bearer already has refreshes its duration
 * instead of stacking (returns `false` so no second copy attaches).
 */

import type { Combatant } from "../../types";
import {
  registerEffectHandler,
  findEffect,
  numParam,
  type EffectContext,
} from "./EffectRuntime";

/** A battle round ≈ this many steps on the map. Converts a poison's
 *  remaining duration when it carries between battle and exploration
 *  (5 rounds of poison left = 50 steps of walking it off). */
export const MAP_STEPS_PER_ROUND = 10;

/** Statuses that outlast a battle (written back onto the save). */
export const CARRIED_STATUSES: ReadonlySet<string> = new Set(["poisoned"]);

/** Floating-label colours (CSS hex) per status. */
export const STATUS_COLORS = {
  poisoned: "#7be36a",
  sleep: "#9ec5ff",
  charm: "#ff8fd0",
  slowed: "#b8c4d6",
} as const;

function turnsFrom(ctx: EffectContext, fallback: number): number {
  return Math.max(1, Math.round(numParam(ctx.effect.params, "duration", fallback)));
}

/** Shared re-apply rule: refresh the existing instance's duration (to
 *  the longer of the two) and refuse a second copy. Returns true when
 *  the bearer already had it. */
function refreshExisting(ctx: EffectContext, fallback: number, label: string): boolean {
  const existing = findEffect(ctx.bearer, ctx.effect.effectId);
  if (!existing) return false;
  const turns = turnsFrom(ctx, fallback);
  existing.state.turnsLeft = Math.max(numParam(existing.state, "turnsLeft", 0), turns);
  ctx.host.log(`${ctx.bearer.name} is ${label} for longer.`);
  return true;
}

// ── Poisoned ──────────────────────────────────────────────────────

registerEffectHandler({
  id: "poisoned",
  onApply(ctx) {
    if (refreshExisting(ctx, 5, "poisoned")) return false;
    ctx.effect.state.turnsLeft = turnsFrom(ctx, 5);
    // `carried` = poison the character walked into battle with.
    ctx.host.log(
      ctx.effect.params.carried
        ? `${ctx.bearer.name} is still poisoned.`
        : `${ctx.bearer.name} is poisoned!`,
    );
    ctx.host.emitEvent({ targetId: ctx.bearer.id, kind: "status", text: "POISONED", color: STATUS_COLORS.poisoned });
  },
  onRoundTick({ host, bearer, effect }) {
    if (bearer.hp <= 0) return;
    const dmg = Math.max(1, Math.round(numParam(effect.params, "damage_per_turn", 2)));
    bearer.hp = Math.max(0, bearer.hp - dmg);
    host.emitEvent({ targetId: bearer.id, kind: "status", text: `-${dmg} poison`, color: STATUS_COLORS.poisoned });
    if (bearer.hp === 0) {
      host.log(`${bearer.name} takes ${dmg} poison damage and succumbs to the poison!`);
      host.removeEffect(bearer, effect);
      return;
    }
    host.log(`${bearer.name} takes ${dmg} poison damage.`);
    const left = numParam(effect.state, "turnsLeft", 1) - 1;
    effect.state.turnsLeft = left;
    if (left <= 0) {
      host.removeEffect(bearer, effect);
      host.log(`${bearer.name} is no longer poisoned.`);
      host.emitEvent({ targetId: bearer.id, kind: "status", text: "CURED", color: STATUS_COLORS.poisoned });
    }
  },
});

// ── Asleep ────────────────────────────────────────────────────────

registerEffectHandler({
  id: "sleep",
  onApply(ctx) {
    if (refreshExisting(ctx, 2, "asleep")) return false;
    ctx.effect.state.turnsLeft = turnsFrom(ctx, 2);
    // HP at the moment they nodded off — any loss before their next
    // turn means something hit them, which wakes them.
    ctx.effect.state.hpAtSleep = ctx.bearer.hp;
    ctx.host.log(`${ctx.bearer.name} falls into a magical sleep.`);
    ctx.host.emitEvent({ targetId: ctx.bearer.id, kind: "status", text: "ASLEEP", color: STATUS_COLORS.sleep });
  },
  controlsTurn({ host, bearer, effect }) {
    if (bearer.hp <= 0) return false;
    if (bearer.hp < numParam(effect.state, "hpAtSleep", bearer.hp)) {
      host.removeEffect(bearer, effect);
      host.log(`${bearer.name} is jolted awake by the pain!`);
      host.emitEvent({ targetId: bearer.id, kind: "status", text: "AWAKE!", color: STATUS_COLORS.sleep });
      return false;
    }
    return true;
  },
  runTurn({ host, bearer, effect }) {
    const left = numParam(effect.state, "turnsLeft", 1) - 1;
    effect.state.turnsLeft = left;
    if (left <= 0) {
      host.removeEffect(bearer, effect);
      host.log(`${bearer.name} sleeps through the turn, then wakes up.`);
      host.emitEvent({ targetId: bearer.id, kind: "status", text: "AWAKE", color: STATUS_COLORS.sleep });
    } else {
      host.log(`${bearer.name} is fast asleep and loses the turn.`);
      host.emitEvent({ targetId: bearer.id, kind: "status", text: "Zzz", color: STATUS_COLORS.sleep });
    }
  },
});

// ── Charmed ───────────────────────────────────────────────────────

function endCharm(ctx: EffectContext): void {
  const { bearer, effect } = ctx;
  const origSide = effect.state.origSide;
  if (origSide === "party" || origSide === "enemies") bearer.side = origSide;
  const origAi = effect.state.origAi;
  if (typeof origAi === "boolean") bearer.aiControlled = origAi;
  else delete bearer.aiControlled;
}

registerEffectHandler({
  id: "charm",
  onApply(ctx) {
    const { host, bearer, effect } = ctx;
    const source = effect.sourceId ? host.combatantById(effect.sourceId) : null;
    // Charm with no caster has no side to turn to.
    if (!source || source.side === bearer.side) return false;
    if (refreshExisting(ctx, 3, "charmed")) return false;
    effect.state.turnsLeft = turnsFrom(ctx, 3);
    effect.state.origSide = bearer.side;
    effect.state.origAi = typeof bearer.aiControlled === "boolean" ? bearer.aiControlled : null;
    bearer.side = source.side;
    // The charmed creature acts on its own (AI), now for the caster.
    bearer.aiControlled = true;
    host.log(`${bearer.name} is charmed and now fights for ${source.name}'s side!`);
    host.emitEvent({ targetId: bearer.id, kind: "status", text: "CHARMED", color: STATUS_COLORS.charm });
  },
  onRoundTick(ctx) {
    const { host, bearer, effect } = ctx;
    if (bearer.hp <= 0) {
      host.removeEffect(bearer, effect);
      endCharm(ctx);
      return;
    }
    const left = numParam(effect.state, "turnsLeft", 1) - 1;
    effect.state.turnsLeft = left;
    if (left <= 0) {
      host.removeEffect(bearer, effect);
      endCharm(ctx);
      host.log(`${bearer.name} shakes off the charm and returns to its own side.`);
      host.emitEvent({ targetId: bearer.id, kind: "status", text: "CHARM BROKEN", color: STATUS_COLORS.charm });
    }
  },
  onRemove: endCharm,
});

// ── Slowed ────────────────────────────────────────────────────────

registerEffectHandler({
  id: "slowed",
  onApply(ctx) {
    if (refreshExisting(ctx, 2, "slowed")) return false;
    ctx.effect.state.turnsLeft = turnsFrom(ctx, 2);
    ctx.host.log(`${ctx.bearer.name} is slowed — movement halved.`);
    ctx.host.emitEvent({ targetId: ctx.bearer.id, kind: "status", text: "SLOWED", color: STATUS_COLORS.slowed });
  },
  onRoundTick({ host, bearer, effect }) {
    const left = numParam(effect.state, "turnsLeft", 1) - 1;
    effect.state.turnsLeft = left;
    if (left <= 0) {
      host.removeEffect(bearer, effect);
      if (bearer.hp > 0) {
        host.log(`${bearer.name} is no longer slowed.`);
        host.emitEvent({ targetId: bearer.id, kind: "status", text: "SPEED BACK", color: STATUS_COLORS.slowed });
      }
    }
  },
});

/** Movement budget after `slowed` (halved, min 1). */
export function slowedMovePoints(bearer: Combatant, points: number): number {
  if (!findEffect(bearer, "slowed")) return points;
  return Math.max(1, Math.floor(points / 2));
}

/** Remove a curable status (poison, sleep, …) from a combatant, with
 *  the log line. Returns true when something was removed. Used by Cure
 *  Poison / Restore / Antidote. */
export function cureStatus(
  log: (line: string) => void,
  bearer: Combatant,
  effectId: string,
): boolean {
  const before = bearer.effects?.length ?? 0;
  bearer.effects = (bearer.effects ?? []).filter((e) => e.effectId !== effectId);
  const removed = (bearer.effects.length ?? 0) < before;
  if (removed && effectId === "poisoned") log(`${bearer.name} is cured of poison.`);
  return removed;
}
