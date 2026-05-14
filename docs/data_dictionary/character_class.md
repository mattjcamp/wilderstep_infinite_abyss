# Character Class

## Purpose

Playable character classes — Fighter, Thief, Cleric, Wizard, Druid, Paladin, Ranger, Alchemist. Each class carries HP/MP growth per level, movement range in combat, XP curve, allowed races, optional MP source rules (single-stat or dual-stat casting), and a list of non-spell class abilities.

Ported from v1's `data/classes/*.json` (8 files, one per class). Consolidated into a single collection here.

## Location

`data_model/character_classes.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "character_classes": [ <class_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"fighter"`, `"wizard"`) | TBD |
| `name` | string | yes | Display label (PascalCase: `"Fighter"`, `"Wizard"`) | TBD |
| `hp_per_level` | number | yes | HP added per level-up | TBD |
| `mp_per_level` | number | yes | MP added per level-up; `0` for non-casters | TBD |
| `range` | number | yes | Tiles of movement per combat turn | TBD |
| `exp_per_level` | number | yes | XP per level threshold | TBD |
| `allowed_races` | string[] | yes | Race ids allowed to take this class | TBD |
| `mp_source` | object \| null | yes | MP scaling source. `null` for non-casters. See *mp_source* below. | TBD |
| `class_abilities` | object[] | no | Non-spell class features (e.g. Herbalism, Pick Locks, Detect Traps). See *class_abilities* below. | TBD |

## `mp_source` sub-object

Determines which stat drives a class's maximum MP. `null` on non-casters (Fighter, Thief).

| Field | Type | Description |
|---|---|---|
| `ability` | string | Single-stat caster: the stat name (e.g. `"intelligence"`, `"wisdom"`) |
| `abilities` | string[] | Dual-stat caster: list of stat names (only Druid in current data) |
| `mode` | `"higher" \| "average"` | Combine rule when `abilities` has multiple stats |

A record sets either `ability` *or* `abilities`+`mode`, not both. The presence of `abilities` is the discriminator for dual-stat scaling.

## `class_abilities[]` entry

Non-spell class features. Spells are handled separately — see [Spell](spell.md)'s `allowable_classes` and `class_min_levels` fields.

| Field | Type | Description |
|---|---|---|
| `name` | string | Ability label (e.g. `"Detect Traps"`, `"Pick Locks"`, `"Herbalism"`) |
| `min_level` | int | Level at which the ability unlocks (defaults to 1 when omitted) |
| `description` | string | UI / tooltip text |

## Cross-references to other models

- `allowed_races[]` → [Race](race.md) ids
- Referenced *by* [Spell](spell.md) `allowable_classes` — which classes can cast a given spell
- Referenced *by* [Party](party.md) `roster[].class` (matched case-insensitively against `name`)
- `class_abilities[].name` values that match an [Effect](effect.md) id (e.g. Ranger's `"Detect Traps"` maps to effect `detect_traps`) are how class abilities bridge to the unified Effect model — though the link is by-convention, not enforced by the data shape

## Example record

```json
{
  "id": "ranger",
  "name": "Ranger",
  "hp_per_level": 10,
  "mp_per_level": 3,
  "range": 6,
  "exp_per_level": 1500,
  "allowed_races": ["human", "dwarf", "halfling", "elf", "gnome"],
  "mp_source": { "ability": "wisdom" },
  "class_abilities": [
    { "name": "Herbalism", "min_level": 1, "description": "..." },
    { "name": "Pick Locks", "min_level": 3, "description": "..." },
    { "name": "Detect Traps", "min_level": 3, "description": "..." }
  ]
}
```

## Notes and open questions

- **Dropped from v1 per the not-used rule:** `_comment`, `allowed_weapons` (parsed but never queried), `allowed_armor` (same), `spell_type` (looks like a discriminator but isn't — spell access flows through `spells.json`'s `allowable_classes`), `mp_source.percentage` (parsed but unread), `mp_regen_multiplier` (Druid-only design intent, no v1 consumer).
- **`allowed_races` was unread in v1.** v1's TS hardcoded the race-gate table in `app/party/new/page.tsx` as `CLASS_RACES`. Kept here because the data should drive the gate when v2 wires the loader.
- **`class_abilities` is currently sparse.** v1 enumerated abilities only for Paladin, Ranger, Alchemist. Thief should plausibly gain Pick Locks and Detect Traps here at level 1 (v1 surfaced these via the now-removed `requirements` predicate on the Effect model). Add when the gating semantics are settled.
- **Paladin's `Turn Undead` is both a class ability and a spell.** v1 carried it in both `class_abilities` (for char-sheet display) and `spells.json` (with `class_min_levels: { Paladin: 5 }`). The Spell is the mechanic; the class_ability entry is descriptive. Either dedupe (derive char-sheet info from Spell) or accept the duplication for now.
- **`class_abilities[].name` → Effect id is a soft convention.** Some abilities match Effect ids (Detect Traps → `detect_traps`); others don't have Effect representations (Pick Locks, Herbalism). A future refactor could split into `granted_effects` / `granted_spells` / `class_skills` for cleaner cross-references.
