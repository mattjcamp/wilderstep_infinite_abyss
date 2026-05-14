# Effect

## Purpose

A named, persistent or transient gameplay condition. **Effect is the unified, decoupled model** for everything that lives on a character, monster, or party as a discrete piece of state. Four conceptual kinds fit under one schema:

1. **Ability** — a passive capability granted to its bearer. Examples: Detect Traps, Infravision.
2. **Applied status** — a transient condition imposed by a spell or other trigger. Examples: Asleep, Cursed, Blessed.
3. **Passive trait** — an always-on capability on a character or monster. Examples: Regenerating, Fire Resistance, Poison Immunity.
4. **Trigger** — an effect that fires on an event (a successful hit, a step taken) rather than ticking over time. Examples: Drain (HP transferred on hit), Consumed (engulf on hit).

**Effects are pure capability records.** They describe *what* an effect does and its default parameters. They do not describe *who* can have it or *how it was applied*. That mapping lives on the granter:

- [Character Class](character_class.md) records list abilities that members of the class get (e.g., Thieves get `detect_traps`).
- [Race](race.md) records list racial abilities (e.g., Dwarves get `infravision`).
- [Item](item.md) records use `grants_effect` to apply an effect while equipped (e.g., Sun Sword grants `sun_sword_aura`).
- [Spell](spell.md) records use `effect_type` (or equivalent) to specify the status they apply on cast.
- [Monster](monster.md) records list `passives[]` and `on_hit_effects[]` referencing effects by id, with per-monster parameter overrides.

This decoupling means a single `detect_traps` Effect can be granted by a class ability, an item, a spell, or any future mechanism without the Effect record itself needing to know which.

## Location

Effect catalog: `data_model/effects.json` — currently the canonical source. When effects ship inside a real module, this file (or a per-module variant) will live at `modules/<module_id>/effects.json` per `docs/dev_guides/game_architecture_plan.md`.

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

`params` is a free-form object whose keys depend on the effect's runtime handler. See `data_model/effects.json` for concrete shapes. Common parameter idioms across the ported v1 catalog:

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

## Cross-references to other models

- [Character Class](character_class.md) — class abilities reference Effect `id`s
- [Race](race.md) — racial abilities reference Effect `id`s
- [Spell](spell.md) — `effect_type` (or equivalent) reference Effect `id`s for spell-applied statuses
- [Item](item.md) — `grants_effect` references Effect `id`s for effects conferred by equipping the item
- [Monster](monster.md) — `passives[]` and `on_hit_effects[]` reference Effect `id`s with per-monster parameter overrides (e.g. per-monster `chance`, scaled `amount`)
- [Party](party.md) — `party_effects.effect_1..4` save-game slots reference Effect `id`s

## Example records

**Ability (class- or race-granted, but the Effect doesn't say which):**

```json
{
  "id": "detect_traps",
  "name": "Detect Traps",
  "description": "Traps are revealed before the party steps on them.",
  "duration": "permanent",
  "params": null
}
```

The Thief class (and the Ranger class at level 3) will list `detect_traps` as a granted ability in their own records — see [Character Class](character_class.md).

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

- **Decoupling decision.** The schema deliberately dropped v1's `requirements` (class/race eligibility predicate) and `item_granted` (party-slot-bypass flag). Both belonged to the *applier*, not the effect. The mapping from "who has access to this effect" now lives on Character Class / Race / Item / Spell records.

- **State-side vs. application-time split.** Effect `params` hold *state-side* values — what does being in this state mean. Examples: `regen.amount` (HP per round), `bless.attack_bonus`, `poisoned.damage_per_turn`, `repel_monsters.radius`. Application-time params — what governs whether the effect gets applied at all — live on the applier (Spell, Item, Monster). Examples: a Sleep spell's `save_dc_base` and `max_target_hp` live on the Sleep spell, not on the Sleep effect; a monster's per-hit `chance` to apply Poison lives on the monster's `on_hit_effects[]` entry, not on the Poisoned effect. This split was applied during the spells port; effect records now reflect it.

- **`params` overrides at application time.** Appliers may override individual keys in the Effect's `params` (e.g. the Push spell applies the Repelled effect with `radius: 5, push_distance: 3` instead of the effect's defaults `radius: 3, push_distance: 1`). The override merge is shallow per key. Once the Monster model is filled in, monster on-hit applications will follow the same pattern (per-monster `amount` for Drain, per-monster `chance`, etc.).

- **`duration` units are context-dependent.** Numbers mean step counts for overworld effects (Galadriel's Light = 200 steps) and turns for combat effects (Sleep = 2 turns). Same field, different unit depending on where the effect is active. Disambiguate via a `duration_unit` field, document a per-id convention, or accept that the applier's context determines the meaning.

- **No top-level `kind` discriminator.** Effects do not declare which of the four kinds they are; the runtime infers from `id` and from where the effect is referenced. Fine for now; revisit if editor filtering or validation needs kind to be authoritative.

- **Per-id handlers expected.** Like v1, v2's runtime is likely to dispatch effect behavior per-`id` — adding a new effect to JSON alone does nothing until a handler exists. A more declarative model where `params` fully describes behavior is a bigger redesign.

- **Instant effects feel like a category mismatch.** `drain` doesn't really "last" — it's a one-shot HP transfer that happens on hit. Modeling it as an Effect with `duration: "instant"` works, but conceptually it's closer to "thing a Monster does to the target" than "status the target carries." If the model strains, splitting triggers back out into Monster fields is a reasonable retreat.

- **Effect ids inherited v1's internal names.** `ac_buff`, `range_buff`, `repel_monsters`, `magic_light` are clearly authoring-side names. A normalization pass to player-facing ids (`shielded`, `long_shanks`, `repelled`, `lit`) is reasonable future cleanup.
