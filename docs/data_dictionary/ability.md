# Ability

## Purpose

A named capability that a Character can have. **Ability is the catalog of "things a character knows how to do"** — racial perks, class features, and other miscellaneous capabilities — in one id-keyed surface. The `type` field discriminates where the ability originates:

| `type` | Meaning | Examples |
|---|---|---|
| `"race"` | Granted by a [Race](race.md) | Infravision, Galadriel's Light, Pickpocket, Fast Learner, Tinker |
| `"class"` | Granted by a [Character Class](character_class.md) | Pick Locks, Detect Traps, Backstab, Shadow Step, Turn Undead, Herbalism, Dual Casting |
| `"other"` | Anything else — quest reward, item-granted, scripted unlock | (none in seed data yet) |

This model is **new in v2** and is the result of refactoring the relationship between Character, Character Class, Race, and Effect — those models previously surfaced ability-like concepts in a handful of slightly different shapes (`race.effects`, `character_class.class_abilities`, Effects with `requirements`, …). Ability collapses the "capability catalog" half of that mess into one place; granters now reference Ability records by id: [Race](race.md) `abilities[]` (string ids) and [Character Class](character_class.md) `abilities[]` (`{ ability_id, min_level }` entries with the per-class level gate).

## Relationship to Effect

Ability and Effect are different concerns:

- **Ability** describes a named capability that a Character has (and surfaces in the character sheet). It's authored content — "Thieves can Pick Locks at level 1."
- **Effect** describes a runtime gameplay condition that can sit on a character, monster, or party (a passive bonus, a status, a trigger). It's mechanical — "while in the Blessed state, +2 attack."

Some Abilities will *also* be Effects (Infravision, Detect Traps): the Ability is the character-sheet entry, the Effect is the lit-tiles-around-the-party mechanic. The migration step will decide per-id whether the Effect record stays, gets replaced by the Ability's `params`, or both.

## Location

`web/public/modules/default/abilities.json` — real data drives the schema. Currently seeded with 12 records migrated from the previous `race.effects` and `character_class.class_abilities` fields (5 race abilities, 7 class abilities).

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "abilities": [ <ability_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"pick_locks"`, `"infravision"`, `"turn_undead"`). Granters (Race, Character Class, others) will reference Abilities by this id. | TBD |
| `name` | string | yes | Display label (e.g. `"Pick Locks"`, `"Infravision"`, `"Turn Undead"`). | TBD |
| `type` | string | yes | Origin discriminator. One of `"race"`, `"class"`, `"other"`. | TBD |
| `description` | string | yes | UI / tooltip text — flavor + mechanics summary as shown on the character sheet. | TBD |
| `duration` | string \| number | yes | Default lifetime. Numbers are step counts (overworld abilities like Galadriel's Light) or turns (combat). Strings: `"permanent"`, `"instant"`, `"until_save"`, or other context-specific values. Same conventions as Effect `duration`. | TBD |
| `party_effect` | bool | no | When `true`, this Ability is a togglable **party-wide** effect: its id can appear in `Party.party_effects[]` and is rendered in the EFFECTS list on the in-game Party screen. Set this only for capabilities that act on the whole party at the world-map layer (trap detection, dark-vision, aura lighting). Leave `false`/absent for character-only passives (Fast Learner, Dual Casting, Nimble) and combat-only actions (Turn Undead, Backstab) — those surface on the character sheet, not the Party slots. Defaults to `false`. | TBD |
| `usable_in` | string[] | no | Where this Ability can be *actively triggered* by the player. Mirrors `Spell.usable_in`: `"battle"` (in-combat action button) or `"party"` (out-of-combat — surfaces as a Use button on the character sheet). Both values may appear together. **Absent / empty array = passive** (no button anywhere — the ability either runs automatically or expresses itself through `party_effect`). Defaults to passive. | TBD |
| `params` | object \| null | no | Bag of ability-specific default parameters whose shape depends on the runtime handler for this `id`. Granters may override individual keys at apply time. | TBD |

## `type` values

| Value | Granter |
|---|---|
| `"race"` | Granted by a [Race](race.md). The Race record lists ability ids in its `abilities[]` array. |
| `"class"` | Granted by a [Character Class](character_class.md). The Character Class record lists `{ ability_id, min_level }` entries in its `abilities[]` array. |
| `"other"` | Any other source: item-granted (today via `Item.grants_effect`), quest reward, scripted unlock. Lets the catalog hold capabilities that aren't simply tied to "I picked this race / class." |

## Cross-references to other models

These are the **planned** cross-references — the migration that wires them up is the next refactor step:

- Referenced *by* [Race](race.md) — racial abilities (ids of Ability records where `type === "race"`)
- Referenced *by* [Character Class](character_class.md) — class abilities (ids of Ability records where `type === "class"`)
- Optionally referenced *by* [Item](item.md) `grants_effect`, quest records, etc. for `type === "other"` cases
- An Ability with mechanical impact may also have a runtime [Effect](effect.md) entry — see *Relationship to Effect* above

## Example records

**Race ability:**

```json
{
  "id": "infravision",
  "name": "Infravision",
  "type": "race",
  "description": "Dwarven eyes pierce the darkness, revealing the world in shades of red.",
  "duration": "permanent",
  "params": null
}
```

**Activatable class ability (referenced from Cleric `abilities[]` @ min_level 2 and Paladin `abilities[]` @ min_level 5):**

```json
{
  "id": "turn_undead",
  "name": "Turn Undead",
  "type": "class",
  "description": "Channel holy energy at every undead on the battlefield. Each one must make a Wisdom save (d20 + WIS mod vs DC 10 + caster's WIS mod) or be destroyed outright; those that succeed are still seared for 50% of their HP in radiant damage.",
  "duration": "instant",
  "params": {
    "action": "turn_undead",
    "mp_cost": 0,
    "range": 99,
    "targeting": "auto_monster",
    "usable_in": ["battle"],
    "save_stat": "wisdom",
    "save_dc_base": 10,
    "fail_hp_percent": 50,
    "sfx": "turn_undead"
  }
}
```

The class-side record specifies `min_level` per granter — Cleric @ 2, Paladin @ 5. The cast mechanic itself (mp_cost, range, targeting, save_dc_base, sfx) lives here in `params` — Turn Undead used to be a Spell too, but its Spell record was merged into this Ability so there's one source of truth.

**Other (placeholder for a future item-granted capability):**

```json
{
  "id": "sun_sword_aura",
  "name": "Sun Sword Aura",
  "type": "other",
  "description": "The Sun Sword sheds a warm golden light, illuminating the area around its wielder.",
  "duration": "permanent",
  "params": { "aura_color": [255, 215, 80], "aura_pulse_hz": 1.2, "aura_radius": 18 }
}
```

## Notes and open questions

- **Migrated from Effect + class_abilities + Spell.** The seed records came from three places: race perks (formerly `race.effects[]` Effect ids — `infravision`, `pickpocket`, `galadriels_light`, `tinker`, plus the newly-explicit `fast_learner`), class features (formerly inline records in `character_class.class_abilities[]` — `pick_locks`, `detect_traps`, `backstab`, `shadow_step`, `turn_undead`, `dual_casting`, `herbalism`), and one Spell that doubled as a class feature (`turn_undead` carried both representations in v1; the Spell record was merged into the Ability's `params` and removed from `spells.json`). The migrated Effect ids were also pruned from `effects.json` so the runtime-state and character-sheet surfaces don't carry parallel definitions for the same concept. The one exception is `magic_light` — that stayed in `effects.json` because it's the transient lit-aura status applied when Galadriel's Light is invoked, distinct from the Ability "Galadriel's Light" itself.
- **`type` enum is open-ended on purpose.** Three values today (`race`, `class`, `other`); we'd rather add a fourth later (e.g. `quest`) than over-commit to a closed list before the relationship refactor settles.
- **Per-granter level gates stay on the granter, not the Ability.** Cleric gets Turn Undead at level 2, Paladin at level 5. That's *the granter's call*, not a property of the Ability. The Ability record carries the description + params (and, for activatable abilities, the cast mechanic itself — mp_cost, range, targeting, save_dc_base, etc.); the Character Class record carries the `{ ability_id, min_level }` link.
- **Per-granter param overrides will follow the Effect convention.** Granters may override individual keys in the Ability's default `params` at link time (the same shallow-merge pattern Effect appliers use today). Useful when one class wants a stronger / cheaper variant of the same capability.
- **`duration` units are context-dependent.** Same situation as Effect — numbers mean step counts overworld vs. turns in combat. Disambiguation strategy will follow whatever Effect lands on.
- **No top-level `kind` like "passive" vs. "active".** The catalog doesn't distinguish always-on (Infravision) from triggered (Turn Undead). The runtime infers from `duration` (`"permanent"` = passive, anything else = activatable / event-driven). Revisit if validation needs this to be explicit.
- **`party_effect` is the narrow filter, on purpose.** The flag answers exactly one question — "does this Ability go in one of the four `party_effects` slots on the Party screen?" — so the in-game Effects list stays focused on togglable world-map auras. Anything that's purely character-passive (Fast Learner) or purely combat (Turn Undead) is intentionally excluded. If a richer scope axis is ever needed (e.g. `scopes: ["character", "combat"]` to drive the future character-sheet sections), it can be added alongside `party_effect` without breaking it.
