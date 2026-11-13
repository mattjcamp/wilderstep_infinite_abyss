# Effect

## Purpose

A named runtime gameplay condition. **Effect is the unified model for things that sit on a character, monster, or party as a discrete piece of mutable state.** Three conceptual kinds fit under one schema:

1. **Applied status** — a transient condition imposed by a spell or other trigger. Examples: Asleep, Cursed, Blessed, Light.
2. **Passive trait** — an always-on capability on a character or monster. Examples: Regenerating, Fire Resistance, Poison Immunity.
3. **Trigger** — an effect that fires on an event (a successful hit, a step taken) rather than ticking over time. Examples: Drain (HP transferred on hit), Consumed (engulf on hit).

Character-sheet capabilities (racial perks like Infravision, class features like Pick Locks and Turn Undead) used to be modelled as Effects too. They moved to the dedicated [Ability](ability.md) catalog in the relationship refactor so the character-sheet surface is independent of the runtime-state surface. Some Abilities still *produce* an Effect when invoked (Galadriel's Light → `magic_light`); the Effect record in this file is the runtime status, the Ability record is the character-sheet entry.

**Effects are pure state records.** They describe *what* the condition does and its default parameters. They do not describe *who* can have it or *how it was applied*. That mapping lives on the applier:

- [Item](item.md) records use `grants_effect` to apply an effect while equipped (e.g., Sun Sword grants `sun_sword_aura`).
- [Spell](spell.md) records use `effect_type` (or equivalent) to specify the status they apply on cast.
- [Monster](monster.md) records list `passives[]` and `on_hit_effects[]` referencing effects by id, with per-monster parameter overrides.
- [Ability](ability.md) records that produce a transient status reference its Effect id in `params` (e.g. Galadriel's Light → `params.applied_effect: "magic_light"`).

## Location

Effect catalog: `web/public/modules/default/effects.json` — currently the canonical source. When effects ship inside a real module, this file (or a per-module variant) will live at `modules/<module_id>/effects.json` per `docs/dev_guides/game_architecture_plan.md`.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

The collection file is a flat array under an `effects` key (matching v1), optionally with a top-level `_comment` for authoring notes that the runtime ignores:

```
{
  "_comment": "optional authoring notes",
  "effects": [ <effect_record>, ... ]
}
```

Each record:

```json
{
  "id": "",
  "name": "",
  "description": "",
  "duration": "permanent",
  "params": null
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier referenced by classes, races, spells, items, monsters, and party effect slots | TBD |
| `name` | string | yes | Display label | TBD |
| `description` | string | yes | Tooltip / UI text | TBD |
| `duration` | string \| number | yes | Default lifetime if the applier doesn't override. Numbers are step counts (overworld effects) or turns (combat effects). Strings: `"permanent"`, `"instant"`, `"until_save"`, or other context-specific values. | TBD |
| `params` | object \| null | no | Bag of effect-specific default parameters whose shape depends on the runtime handler for this `id`. Appliers (spells, items, monsters) may override individual keys at apply time. | TBD |

## `params` shape by effect

`params` is a free-form object whose keys depend on the effect's runtime handler. See `web/public/modules/default/effects.json` for concrete shapes. Common parameter idioms across the ported v1 catalog:

| Parameter | Type | Used by (examples) |
|---|---|---|
| `amount` | int | regen (HP per round), drain (HP transferred) |
| `damage_per_turn` | int | poisoned, consumed |
| `save_dc` / `save_dc_base` | int | sleep, charm, poison resistance rolls |
| `save_dc_stat` / `save_stat` | string | sleep, charm — which stat keys the save |
| `ac_bonus` / `ac_penalty` | int | shielded, cursed |
| `attack_bonus` / `attack_penalty` | int | blessed, cursed |
| `range_bonus` | int | long shanks |
| `max_target_hp` | int | sleep (refuses targets above this HP) |
| `aura_color` | `[int, int, int]` | sun_sword_aura |
| `aura_pulse_hz` / `aura_radius` | number | sun_sword_aura |
| `radius` / `push_distance` | int | repel_monsters |

This is a snapshot, not a closed list. New effects can define new param keys; runtime handlers read what they expect.

## In battle: what each effect does, looks like and logs

Every change is written to the battle log (applied, each tick, wearing off) and floats a short label over the character. While an effect is active the character shows its look on the arena (drawn by `web/src/battle/scenes/statusAuras.ts`). `duration` / `params` here are the defaults; a spell, monster spell or item can override them.

| Effect | In battle | Look | Applied by |
|---|---|---|---|
| `poisoned` | Loses `damage_per_turn` HP at the end of every round for `duration` rounds. Blocked by `poison_immunity`. **Carries out of battle** (see below). | Green haze + rising bubbles | Monster spells Spore Cloud / Venom Bite (CON save vs `save_dc`), Poison Vial / Lingering Venom (`applies_effect` on the item) |
| `sleep` (Asleep) | Skips the bearer's turns for `duration` of their own turns; any damage wakes them at their next turn. | Blue "Z"s drifting up | Sleep spell (INT save, `max_target_hp`), monster Web / Dark Slumber / Hypnotic Gaze (WIS save) |
| `charm` (Charmed) | Fights for the caster's side (AI-controlled) for `duration` rounds, then returns to its own side. | Pink hearts circling | Charm Person (INT save) |
| `slowed` | Movement halved (min 1) for `duration` rounds. | Grey ring + drag marks at the feet | Paralytic Poison |
| `ac_buff` (Shielded) | +AC | Pale-blue bubble | Shield, Elixir of Warding |
| `bless` (Blessed) | +attack | Golden halo | Bless |
| `curse` (Cursed) | −attack / −AC | Violet wisps | Curse, monster Haunting Wail / Hex, Weakening Poison |
| `range_buff` (Long Shanks) | +movement | Green chevrons under the feet | Long Shanks |
| `invisibility` | +AC (hard to hit) | Sprite turns see-through + shimmer | Invisibility |
| `regen` | Heals `amount` each round | Green "+" motes; "+N regen" label | Monster trait |
| `fire_resistance` | Halves fire damage | "RESISTS FIRE" label when it triggers | Monster trait, Sun Sword |
| `poison_immunity` | Blocks Poisoned | "IMMUNE" label when it triggers | Monster trait |
| `drain` | Attacker heals on a hit | "+N drained" label on the attacker | Monster on-hit |
| `consumed` | Swallowed whole (existing) | Hidden inside the swallower | Man Eater on-hit |

Cures: **Cure Poison** (spell), **Restore** (`cure_effects`), **Antidote** (in battle or from the Party screen), and the temple's Cure Poisons.

`magic_light`, `repel_monsters` and `sun_sword_aura` are exploration (map) effects and don't appear in battle.

### Poison on the map

A poisoned character keeps the poison after the fight. On the map its remaining duration counts in **steps** — one battle round = 10 steps (`MAP_STEPS_PER_ROUND`). Every 10 steps it bites for `damage_per_turn` HP with an exploration-log line ("Pip suffers from poison (-2 HP)."), but on the map it never drops anyone below 1 HP. "Pip is no longer poisoned." when it runs out. Walking into a fight while poisoned carries the remaining poison back into battle.

### Items that inflict a status: `applies_effect`

A throwable item can carry `"applies_effect": { "effect_id": "poisoned", "duration": 3, "damage_per_turn": 2 }`. On a hit to a living target the effect is applied; every key besides `effect_id` overrides the effect's defaults. `effect_id: "curse"` applies the curse debuff (`ac_penalty`, `attack_penalty`, `duration`).

## Cross-references to other models

- [Spell](spell.md) — `effect_type` (or equivalent) reference Effect `id`s for spell-applied statuses
- [Item](item.md) — `grants_effect` references Effect `id`s for effects conferred by equipping the item
- [Monster](monster.md) — `passives[]` and `on_hit_effects[]` reference Effect `id`s with per-monster parameter overrides (e.g. per-monster `chance`, scaled `amount`)
- [Ability](ability.md) — Ability records whose invocation produces a transient status reference its Effect id in `params.applied_effect` (e.g. Galadriel's Light → `magic_light`)
- [Party](party.md) — `party_effects.effect_1..4` save-game slots reference Effect `id`s

## Example records

**Status applied by a spell** (state-only — the application-time params live on the Sleep spell):

```json
{
  "id": "sleep",
  "name": "Asleep",
  "description": "Lulled into a magical slumber; cannot act until shaken loose or the spell fades.",
  "duration": 2,
  "params": null
}
```

The Sleep spell carries the application params (`max_target_hp`, `save_dc_stat`, `save_dc_base`) on its own record — see [Spell](spell.md).

**Always-on monster passive:**

```json
{
  "id": "regen",
  "name": "Regenerating",
  "description": "Restores hit points each round.",
  "duration": "permanent",
  "params": { "amount": 2 }
}
```

**On-hit trigger (instant):**

```json
{
  "id": "drain",
  "name": "Drained",
  "description": "Life force is transferred from the target to the attacker on a successful hit.",
  "duration": "instant",
  "params": { "amount": 2 }
}
```

## Notes and open questions

- **Decoupling decision.** The schema deliberately dropped v1's `requirements` (class/race eligibility predicate) and `item_granted` (party-slot-bypass flag). Both belonged to the *applier*, not the effect. The mapping from "who has access to this effect" now lives on Item / Spell records (for effects applied at runtime) or on [Ability](ability.md) records (for character-sheet capabilities). The Ability/Effect split was the second pass of this decoupling: it pulled the character-sheet half of "abilities" out of this catalog entirely.

- **State-side vs. application-time split.** Effect `params` hold *state-side* values — what does being in this state mean. Examples: `regen.amount` (HP per round), `bless.attack_bonus`, `poisoned.damage_per_turn`, `repel_monsters.radius`. Application-time params — what governs whether the effect gets applied at all — live on the applier (Spell, Item, Monster). Examples: a Sleep spell's `save_dc_base` and `max_target_hp` live on the Sleep spell, not on the Sleep effect; a monster's per-hit `chance` to apply Poison lives on the monster's `on_hit_effects[]` entry, not on the Poisoned effect. This split was applied during the spells port; effect records now reflect it.

- **`params` overrides at application time.** Appliers may override individual keys in the Effect's `params` (e.g. the Push spell applies the Repelled effect with `radius: 5, push_distance: 3` instead of the effect's defaults `radius: 3, push_distance: 1`). The override merge is shallow per key. Once the Monster model is filled in, monster on-hit applications will follow the same pattern (per-monster `amount` for Drain, per-monster `chance`, etc.).

- **`duration` units are context-dependent.** Numbers mean step counts for overworld effects (Galadriel's Light = 200 steps) and turns for combat effects (Sleep = 2 turns). Same field, different unit depending on where the effect is active. Disambiguate via a `duration_unit` field, document a per-id convention, or accept that the applier's context determines the meaning.

- **No top-level `kind` discriminator.** Effects do not declare which of the four kinds they are; the runtime infers from `id` and from where the effect is referenced. Fine for now; revisit if editor filtering or validation needs kind to be authoritative.

- **Per-id handlers expected.** Like v1, v2's runtime is likely to dispatch effect behavior per-`id` — adding a new effect to JSON alone does nothing until a handler exists. A more declarative model where `params` fully describes behavior is a bigger redesign.

- **Instant effects feel like a category mismatch.** `drain` doesn't really "last" — it's a one-shot HP transfer that happens on hit. Modeling it as an Effect with `duration: "instant"` works, but conceptually it's closer to "thing a Monster does to the target" than "status the target carries." If the model strains, splitting triggers back out into Monster fields is a reasonable retreat.

- **Effect ids inherited v1's internal names.** `ac_buff`, `range_buff`, `repel_monsters`, `magic_light` are clearly authoring-side names. A normalization pass to player-facing ids (`shielded`, `long_shanks`, `repelled`, `lit`) is reasonable future cleanup.
