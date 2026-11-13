/**
 * Passive trait handlers — the always-on monster/item traits
 * (`regen`, `fire_resistance`, `poison_immunity`), ported onto the same
 * effect registry as `consumed`. Their mechanics now live here, keyed
 * by `effect_id`, instead of being hardcoded in the combat engine.
 *
 * Storage note: passive traits still live in `Combatant.passives` (so
 * monster spawn, the equipment refresh in `CombatBridge`, and the
 * inspector keep working unchanged). The runtime adapts each passive to
 * an `ActiveEffect` view and dispatches it through the registry — see
 * `activeEffectViews` in `EffectRuntime.ts`. Folding the storage itself
 * into `Combatant.effects` is a later increment; centralising the
 * *behaviour* is this one.
 *
 *   - `regen`           — heals `amount` HP at end of round (capped).
 *   - `fire_resistance` — halves incoming "fire"-kind damage.
 *   - `poison_immunity` — blocks the (future) "poisoned" effect.
 */

import { registerEffectHandler, numParam } from "./EffectRuntime";

// Regenerating — restore HP each round, capped at maxHp. Mirrors the
// engine's old `tickPassives` regen branch (log only when HP actually
// moved).
registerEffectHandler({
  id: "regen",
  onRoundTick({ host, bearer, effect }) {
    // A downed combatant doesn't regenerate — guard here so the
    // round-tick can safely run over every combatant (buffs tick on the
    // dead too; regen must not revive them).
    if (bearer.hp <= 0 || bearer.hp >= bearer.maxHp) return;
    const amount = numParam(effect.params, "amount", 1);
    const before = bearer.hp;
    bearer.hp = Math.min(bearer.maxHp, bearer.hp + amount);
    const healed = bearer.hp - before;
    if (healed > 0) {
      host.log(`${bearer.name} regenerates ${healed} HP.`);
      host.emitEvent({ targetId: bearer.id, kind: "status", text: `+${healed} regen`, color: "#7be2a8" });
    }
  },
});

// Fire Resistance — halve fire-typed damage (floor, min 1). Mirrors the
// engine's old `hasPassive(target, "fire_resistance")` branch, including
// the log line.
registerEffectHandler({
  id: "fire_resistance",
  modifyIncomingDamage({ host, bearer }, amount, kind) {
    if (kind !== "fire") return amount;
    const halved = Math.max(1, Math.floor(amount / 2));
    host.log(`${bearer.name}'s fire resistance halves ${amount} → ${halved}.`);
    host.emitEvent({ targetId: bearer.id, kind: "status", text: "RESISTS FIRE", color: "#ffb35c" });
    return halved;
  },
});

// Poison Immunity — declarative trait that refuses the Poisoned status.
// `applyEffect` honours `blocks`, so poison spells, venom on-hits and
// poison throwables all bounce off.
registerEffectHandler({
  id: "poison_immunity",
  blocks: ["poisoned"],
});
