# Effect Decoupling — Analysis & Proposal

**Status:** Analysis only (no code changes). Captures the current state of
effect handling and a proposed runtime-decoupling plan, prompted by the
observation that the `consumed` ("swallowed") effect appears to be a
monster-specific mechanic with no general, reusable home.

## TL;DR

The **data model is already decoupled** the way we want; the **runtime is
not**. `effects.json` is a clean, standalone catalog and the data
dictionary (`docs/data_dictionary/effect.md`) explicitly says effects are
pure state records that any applier (spell, item, monster, ability) should
reference by id. But at runtime there is no generic "apply effect X to a
combatant" path. Each applier hardcodes the mechanics for the specific ids
it knows about, in separate places, and `consumed` in particular is stored
as a bespoke field reachable only through the monster on-hit path. So a
character/spell/ability cannot inflict "swallowed" today without new
bespoke wiring.

## Current state

### The data layer is decoupled (good)

- `web/public/modules/default/effects.json` — flat catalog keyed by `id`.
  `consumed` lives here as a first-class record
  (`duration: "until_save"`, `params.damage_per_turn: 1`), alongside
  `drain`, `poisoned`, `slowed`, `regen`, `fire_resistance`,
  `poison_immunity`, and the spell statuses (`bless`, `curse`, `sleep`, …).
- `web/src/battle/world/Effects.ts` — loads the catalog into an `Effect`
  model (`id`, `name`, `description`, `duration`, `params`).
- `docs/data_dictionary/effect.md` — documents the intended design:
  > Effects are pure state records. They describe *what* the condition does…
  > They do not describe *who* can have it or *how it was applied*. That
  > mapping lives on the applier — Item.grants_effect, Spell.effect_type,
  > Monster.passives/on_hit_effects, Ability.

So on paper `consumed` is not monster-specific.

### The runtime is not decoupled (the "parallel track")

There is no generic effect-application entry point. Instead, each applier
re-declares effect shapes and hardcodes mechanics:

| Applier | Where it's handled | Notes |
|---|---|---|
| Monster on-hit (`on_hit_effects[]`) | `Combat.applyOnHitEffects` | Hand-written branches for exactly `drain` and `consume`. Re-declares shapes via `MonsterOnHit` union in `battle/data/monsters.ts`. |
| Monster passives (`passives[]`) | `Combat.applyPassives` (and gates) | Hardcoded `regen` / `fire_resistance` / `poison_immunity`. Separate `MonsterPassive` union. |
| Spells (`effect_type`) | Big `if/else` in `CombatScene` | Applied through a *third* representation — the `Buff` / `BuffKind` union in `battle/combat/Buffs.ts`. |
| Items (`grants_effect`) | Equipment layer (`PartyActions`) | e.g. Sun Sword → `sun_sword_aura`. |

Consequences:

1. **`effects.json` params/duration are ignored by combat.** The catalog is
   used only for display names and cache seeding. The swallow does not read
   the `consumed` record's `damage_per_turn` / `until_save`; it reads the
   per-monster override baked into the Man Eater's `on_hit_effects` entry.
   The data dictionary's "Used?" column is accordingly all `TBD`.

2. **`consumed` is the most coupled of all.** It is stored as a bespoke
   `Combatant.consumed` field with dedicated engine methods
   (`runConsumedAutoTurn`, `releaseConsumed`, `releaseAllConsumedBy`), and is
   reachable only through the `consume` branch of `applyOnHitEffects`. There
   is no path for a spell/ability/another monster to inflict it.

3. **Three representations of "a status on a combatant"** coexist: the
   bespoke `consumed` field, the `Buff[]` list, and the implicit
   monster-passive flags. Adding a new reusable status means touching
   whichever track happens to apply, and often more than one.

## Proposed direction

Introduce a **runtime effect layer** so the runtime matches the already-
decoupled data model. Core pieces:

1. **A generic applied-status list on `Combatant`** — e.g.
   `statuses: AppliedEffect[]`, where `AppliedEffect = { effectId, params,
   turnsLeft | "until_save" | "permanent", source, ... }`. Over time this
   subsumes the bespoke `consumed` field and the `Buff[]` list.

2. **An effect-handler registry keyed by `effect_id`.** Each handler
   declares the hooks it needs:
   - `onApply(target, params)` / `onExpire(target)`
   - `onTurnTick(target)` (poisoned, consumed, regen)
   - passive modifiers (AC/attack/damage math, damage resistance)
   - turn-control hooks (skip turn for sleep, auto-resolve for consumed)

3. **A single `applyEffect(targetId, effectId, overrides)` entry point** the
   engine calls. It merges `effects.json` defaults (`Effect.params`,
   `Effect.duration`) with the applier's overrides, then registers the
   `AppliedEffect` and runs `onApply`.

4. **Funnel every applier through that door** — monster `on_hit_effects`,
   monster `passives`, spell `effect_type`, item `grants_effect`, and
   ability-produced statuses all call `applyEffect` instead of their own
   bespoke branches.

Result: `consumed` (and every other effect) becomes inflictable by any
applier, parameterized from the catalog, with one place to define its
mechanics.

### Suggested increments (lowest-risk first)

1. **Decouple `consumed` as a vertical slice.** Add `applyEffect` + a
   `consumed` handler that owns the swallow/escape/tick logic currently
   split across `Combat`. Route the Man Eater's on-hit through it. Expose it
   so a spell/ability can also inflict "swallowed." Leaves the spell/buff
   system untouched. This directly serves the original scenario ("other
   monsters or characters may be able to use this effect").

2. **Migrate monster passives** (`regen` / resistances / immunities) onto
   the registry — they're simple and self-contained.

3. **Unify spells + the `Buff` system** onto the registry last — highest
   churn, since it touches the `CombatScene` `effect_type` `if/else` and the
   numeric buff math.

### Risks / things to watch

- **Save/serialization.** `consumed` and effect durations already appear in
  `play/saveTypes.ts` and `sim/types.ts`; a new `AppliedEffect` shape needs a
  migration path or back-compat read.
- **Turn-control effects** (sleep skip-turn, consumed auto-resolve) need
  engine hooks, not just stat math — the registry must support that, which is
  why they're sequenced after the simpler stat/tick effects.
- **Scope creep.** The full unification is large; the `consumed` slice is the
  contained step that proves the pattern and de-risks the rest.

## Pointers (for whoever implements)

- Catalog + model: `web/public/modules/default/effects.json`,
  `web/src/battle/world/Effects.ts`
- Monster effect parse: `web/src/battle/data/monsters.ts`
  (`onHitFromRaw`, `passiveFromRaw`, `MonsterOnHit`, `MonsterPassive`)
- Engine application: `web/src/battle/combat/Combat.ts`
  (`applyOnHitEffects`, `applyPassives`, `runConsumedAutoTurn`,
  `releaseConsumed`); `Combatant.consumed` in `web/src/battle/types.ts`
- Spell/buff path: `web/src/battle/combat/Buffs.ts` and the `effect_type`
  branches in `web/src/battle/scenes/CombatScene.ts`
- Intended design of record: `docs/data_dictionary/effect.md`
