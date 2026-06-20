/**
 * Effect runtime — the generic layer that lets ANY applier (a monster
 * on-hit, a monster passive, a spell, an item, an ability) put a named
 * effect on a combatant, with the effect's mechanics defined ONCE in a
 * handler keyed by `effect_id` (the same ids the data catalog uses in
 * effects.json).
 *
 * This is the decoupling described in
 * `docs/dev_guides/effect_decoupling_proposal.md`. Before it, each
 * applier hardcoded the mechanics for the specific ids it knew about,
 * and "consumed" (the Man Eater's swallow) was a bespoke field on the
 * combatant reachable only through the monster on-hit path. Now any
 * caller funnels through `applyEffect(host, bearer, id, opts)` and the
 * registered handler owns the behaviour.
 *
 * Scope note: the FIRST effect ported onto this layer is `consumed`
 * (see `consumedEffect.ts`). Monster passives and the spell/buff system
 * still run on their older tracks and will migrate in later increments.
 *
 * Decoupling from the engine: handlers never touch `Combat` internals
 * directly. They receive an `EffectHost` — a narrow capability surface
 * (rng, log, lookups, tile search, event emission, removal) that
 * `Combat` implements. That keeps handlers unit-testable and keeps the
 * engine free to change its internals.
 */

import type { Combatant } from "../../types";

/** A board cell. Local alias so this module doesn't depend on Arena. */
export interface Cell {
  col: number;
  row: number;
}

/**
 * Scene-facing events a handler emits as an effect plays out. The
 * CombatScene drains these (via `Combat.popConsumeEvents`) to float
 * damage numbers and show swallow / escape flashes. The shape is the
 * historical "consume" contract; generalising the visual channel is a
 * later increment, so the name and kinds are preserved for now.
 */
export type ConsumeEvent =
  | { targetId: string; kind: "applied"; consumerId: string }
  | { targetId: string; kind: "tick"; damage: number }
  | { targetId: string; kind: "saved" }
  | { targetId: string; kind: "released" };

/** Per-effect parameter bag — `effects.json` defaults overlaid with the
 *  applier's overrides (save_dc, damage_per_turn, …). Free-form: each
 *  handler reads the keys it understands. */
export type EffectParams = Record<string, unknown>;

/** A live instance of an effect sitting on one combatant. */
export interface ActiveEffect {
  /** Catalog id (matches effects.json), e.g. "consumed". */
  effectId: string;
  /** Merged params the handler reads (save_dc, damage_per_turn, …). */
  params: EffectParams;
  /** Whoever applied it — the consumer, the caster, the item. */
  sourceId?: string;
  /** Mutable per-effect state the handler owns (e.g. the bearer's
   *  pre-swallow cell, stashed so they can be spat back out near it). */
  state: Record<string, unknown>;
}

/**
 * The capability surface a handler needs from the combat engine.
 * `Combat` implements this; handlers depend only on the interface.
 */
export interface EffectHost {
  /** Shared encounter RNG — returns [0, 1). */
  rng(): number;
  /** Append a combat-log line. */
  log(line: string): void;
  /** Look up a combatant by id (alive or dead), or null. */
  combatantById(id: string): Combatant | null;
  /** First free, walkable, unoccupied tile near `pos` (or null). */
  findFreeTileNear(pos: Cell): Cell | null;
  /** Emit a scene-facing event for this effect. */
  emitEvent(ev: ConsumeEvent): void;
  /** Detach an effect instance from its bearer. */
  removeEffect(bearer: Combatant, effect: ActiveEffect): void;
}

/** Everything a handler hook receives. */
export interface EffectContext {
  host: EffectHost;
  bearer: Combatant;
  effect: ActiveEffect;
}

/**
 * The behaviour for one effect id. Every hook is optional — a simple
 * stat buff might only need `onApply` / `onRemove`, while a turn-
 * controlling effect like `consumed` also implements `controlsTurn` +
 * `runTurn`.
 */
export interface EffectHandler {
  /** Catalog id this handler implements. */
  id: string;
  /**
   * Run when the effect is applied. Set up state, reposition, emit the
   * "applied" event, etc. Returning `false` aborts application (e.g.
   * the bearer made a resist save, or already carries the effect) —
   * the effect is NOT attached to the bearer.
   */
  onApply?(ctx: EffectContext): boolean | void;
  /** True when the bearer's turn auto-resolves under this effect (their
   *  initiative slot runs `runTurn` instead of a player / AI turn). */
  controlsTurn?(ctx: EffectContext): boolean;
  /** Auto-resolve the bearer's turn while this effect controls it. */
  runTurn?(ctx: EffectContext): void;
  /** Cleanup hook when the effect is removed by the engine. */
  onRemove?(ctx: EffectContext): void;
  /** End-of-round tick — regen heals, a poison status would damage,
   *  etc. Runs once per round for every effect on the bearer. */
  onRoundTick?(ctx: EffectContext): void;
  /** Reduce/alter incoming damage of `kind` (e.g. `fire_resistance`
   *  halves "fire"). Return the (possibly modified) amount. */
  modifyIncomingDamage?(ctx: EffectContext, amount: number, kind: string): number;
  /** Effect ids this trait makes the bearer immune to — `applyEffect`
   *  refuses to attach any of them (e.g. `poison_immunity` blocks
   *  "poisoned"). */
  blocks?: string[];
}

const REGISTRY = new Map<string, EffectHandler>();

/** Register a handler for its `id`. Handlers self-register at import
 *  time; `Combat` imports the handler modules so registration runs. */
export function registerEffectHandler(handler: EffectHandler): void {
  REGISTRY.set(handler.id, handler);
}

export function getEffectHandler(id: string): EffectHandler | undefined {
  return REGISTRY.get(id);
}

/** Read a numeric param with a fallback — the standard way handlers
 *  pull tunables (save_dc, amount, …) off their merged params. */
export function numParam(params: EffectParams, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
}

/**
 * Every effect acting on a combatant, as a uniform list the dispatch
 * helpers iterate: the transient applied effects in `bearer.effects`
 * PLUS the always-on trait sources in `bearer.passives` (regen,
 * fire_resistance, …), adapted to the same `ActiveEffect` shape so a
 * single handler can serve both an applied status and an intrinsic
 * trait. Passive views are throwaway (no persistent `state`).
 */
function activeEffectViews(bearer: Combatant): ActiveEffect[] {
  const views: ActiveEffect[] = [...(bearer.effects ?? [])];
  for (const p of bearer.passives ?? []) {
    views.push({ effectId: p.type, params: p as unknown as EffectParams, state: {} });
  }
  return views;
}

/** Run every effect's end-of-round tick on `bearer` (regen heals, …). */
export function tickRoundEffects(host: EffectHost, bearer: Combatant): void {
  for (const effect of activeEffectViews(bearer)) {
    getEffectHandler(effect.effectId)?.onRoundTick?.({ host, bearer, effect });
  }
}

/** Fold `amount` through every effect's incoming-damage modifier (e.g.
 *  fire_resistance halving fire damage). */
export function applyIncomingDamageMods(
  host: EffectHost,
  bearer: Combatant,
  amount: number,
  kind: string,
): number {
  let result = amount;
  for (const effect of activeEffectViews(bearer)) {
    const handler = getEffectHandler(effect.effectId);
    if (handler?.modifyIncomingDamage) {
      result = handler.modifyIncomingDamage({ host, bearer, effect }, result, kind);
    }
  }
  return result;
}

/** Whether any effect on `bearer` makes them immune to `effectId`. */
export function isImmuneTo(bearer: Combatant, effectId: string): boolean {
  for (const effect of activeEffectViews(bearer)) {
    if (getEffectHandler(effect.effectId)?.blocks?.includes(effectId)) return true;
  }
  return false;
}

export interface ApplyEffectOptions {
  /** Id of whoever applied it (consumer, caster). */
  sourceId?: string;
  /** Applier overrides merged over the handler's own defaults. */
  params?: EffectParams;
}

/**
 * Apply effect `effectId` to `bearer`. The single door every applier
 * goes through. Returns the live `ActiveEffect`, or `null` when the
 * effect didn't take hold (unknown id, resisted, or already present).
 */
export function applyEffect(
  host: EffectHost,
  bearer: Combatant,
  effectId: string,
  opts: ApplyEffectOptions = {},
): ActiveEffect | null {
  const handler = getEffectHandler(effectId);
  if (!handler) {
    host.log(`(no runtime handler for effect "${effectId}" — skipped)`);
    return null;
  }
  // An immunity trait (e.g. poison_immunity blocks "poisoned") refuses
  // the effect outright.
  if (isImmuneTo(bearer, effectId)) {
    host.log(`${bearer.name} is immune to ${effectId}.`);
    return null;
  }
  const effect: ActiveEffect = {
    effectId,
    params: opts.params ?? {},
    sourceId: opts.sourceId,
    state: {},
  };
  // onApply runs BEFORE the effect is attached so a resist save (return
  // false) leaves the bearer untouched — no add-then-remove churn.
  if (handler.onApply && handler.onApply({ host, bearer, effect }) === false) {
    return null;
  }
  (bearer.effects ??= []).push(effect);
  return effect;
}

/** The first effect (if any) currently taking over the bearer's turn.
 *  Their slot auto-resolves via the handler's `runTurn`. */
export function turnControllingEffect(
  host: EffectHost,
  bearer: Combatant,
): ActiveEffect | null {
  for (const effect of bearer.effects ?? []) {
    const handler = getEffectHandler(effect.effectId);
    if (handler?.controlsTurn?.({ host, bearer, effect })) return effect;
  }
  return null;
}

/** Run the bearer's auto-resolved turn for whichever effect controls
 *  it (no-op when nothing does). */
export function runControlledTurn(host: EffectHost, bearer: Combatant): void {
  const effect = turnControllingEffect(host, bearer);
  if (!effect) return;
  getEffectHandler(effect.effectId)?.runTurn?.({ host, bearer, effect });
}

/** The bearer's instance of `effectId`, if present. */
export function findEffect(
  bearer: Combatant,
  effectId: string,
): ActiveEffect | undefined {
  return (bearer.effects ?? []).find((e) => e.effectId === effectId);
}

export function hasEffect(bearer: Combatant, effectId: string): boolean {
  return findEffect(bearer, effectId) !== undefined;
}
