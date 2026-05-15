# Character Class

## Purpose

Playable character classes — Fighter, Thief, Cleric, Wizard, Druid, Paladin, Ranger, Alchemist. Each class carries movement range, a casting_type list, and a list of non-spell class abilities.

Ported from v1's `data/classes/*.json` (8 files, one per class). Consolidated into a single collection here.

Spell access is purely casting_type-based: a class can cast every spell whose `casting_type` is in this class's `casting_type[]`. The Spell model has no per-spell allow-list. Per-class level overrides for individual spells live on [Spell](spell.md)'s `class_min_levels` (e.g. Turn Undead at level 5 for Paladin instead of the spell's base level 2). Item access lives on [Item](item.md)'s `party_can_equip` / `character_can_equip`. The XP curve lives on [Race](race.md)'s `exp_per_level` (in our rules, leveling speed is race-determined). The class record itself is intentionally thin.

## Location

`web/public/modules/default/character_classes.json` — real data drives the schema.

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
| `range` | number | yes | Tiles of movement per combat turn | TBD |
| `casting_type` | string[] | yes | Which spell catalog(s) this class can cast from. Values: `"none"`, `"sorcerer"`, `"priest"`. `["none"]` for non-casters; one entry for single-catalog casters; both `"sorcerer"` and `"priest"` for hybrid casters like Druid. | TBD |
| `class_abilities` | object[] | no | Non-spell class features (e.g. Herbalism, Pick Locks, Detect Traps). See *class_abilities* below. | TBD |

### `casting_type` values

| Value | Meaning |
|---|---|
| `"none"` | No spells. The class doesn't appear in any spellcaster gating. |
| `"sorcerer"` | Arcane / INT-flavored catalog (Wizard, Alchemist). |
| `"priest"` | Divine / WIS-flavored catalog (Cleric, Paladin, Ranger). |

A class with `["sorcerer", "priest"]` (currently just Druid) can cast from both catalogs. The list is the set of catalogs the class participates in — it is not ordered, and `"none"` should never appear alongside another value.

## `class_abilities[]` entry

Non-spell class features. Spells are handled separately — see [Spell](spell.md)'s `casting_type` (the catalog) and `class_min_levels` (per-class level overrides).

| Field | Type | Description |
|---|---|---|
| `name` | string | Ability label (e.g. `"Detect Traps"`, `"Pick Locks"`, `"Herbalism"`) |
| `min_level` | int | Level at which the ability unlocks (defaults to 1 when omitted) |
| `description` | string | UI / tooltip text |

## Cross-references to other models

- `casting_type[]` ↔ [Spell](spell.md) `casting_type` — class eligibility gate. Every class with a matching catalog can cast every spell in that catalog.
- Referenced *by* [Spell](spell.md) `class_min_levels` keys — per-class level overrides for specific spells (e.g. Paladin gets Turn Undead at 5 instead of 2)
- Referenced *by* [Item](item.md) `party_can_equip` / `character_can_equip` — which classes can use a given item
- Referenced *by* [Party](party.md) `roster[].class` (matched case-insensitively against `name`)
- `class_abilities[].name` values that match an [Effect](effect.md) id (e.g. Ranger's `"Detect Traps"` maps to effect `detect_traps`) are how class abilities bridge to the unified Effect model — though the link is by-convention, not enforced by the data shape

## Example record

```json
{
  "id": "ranger",
  "name": "Ranger",
  "range": 6,
  "casting_type": ["priest"],
  "class_abilities": [
    { "name": "Herbalism", "min_level": 1, "description": "..." },
    { "name": "Pick Locks", "min_level": 3, "description": "..." },
    { "name": "Detect Traps", "min_level": 3, "description": "..." }
  ]
}
```

## Notes and open questions

- **Pruned v1 relics** (parsed but unused by v2's engine, removed for cleanliness):
  - `hp_per_level`, `mp_per_level` — HP/MP growth is now expected to come from a level-up progression elsewhere (TBD); the per-class scalar wasn't being consumed.
  - `allowed_races` — v1's TS hardcoded the race-gate table in `app/party/new/page.tsx` as `CLASS_RACES`; the JSON copy was never read. Race-class gating will be re-introduced on the Race model when needed.
  - `mp_source` — MP scaling source (single-stat ability or dual-stat average). Unused by v2; if/when MP scaling is wired up it should live on the casting mechanic, not the class.
  - `exp_per_level` — XP curve. In v2 the leveling speed is determined by race, not class, so this field moved entirely to [Race](race.md). v1 set 1500 on every class and only Human overrode it on the race side.
  - **Also dropped earlier:** `_comment`, `allowed_weapons`, `allowed_armor`, `spell_type`, `mp_source.percentage`, `mp_regen_multiplier`.
- **`class_abilities` is currently sparse.** v1 enumerated abilities only for Paladin, Ranger, Alchemist. Thief should plausibly gain Pick Locks and Detect Traps here at level 1 (v1 surfaced these via the now-removed `requirements` predicate on the Effect model). Add when the gating semantics are settled.
- **Paladin's `Turn Undead` is both a class ability and a spell.** v1 carried it in both `class_abilities` (for char-sheet display) and `spells.json` (with `class_min_levels: { Paladin: 5 }`). The Spell is the mechanic; the class_ability entry is descriptive. Either dedupe (derive char-sheet info from Spell) or accept the duplication for now.
- **`class_abilities[].name` → Effect id is a soft convention.** Some abilities match Effect ids (Detect Traps → `detect_traps`); others don't have Effect representations (Pick Locks, Herbalism). A future refactor could split into `granted_effects` / `granted_spells` / `class_skills` for cleaner cross-references.
