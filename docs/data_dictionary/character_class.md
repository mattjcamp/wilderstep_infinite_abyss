# Character Class

## Purpose

Playable character classes — Fighter, Thief, Cleric, Wizard, Druid, Paladin, Ranger, Alchemist. Each class carries movement range, a casting_type list, and a list of [Ability](ability.md) references (granted to members of the class at a per-class level threshold).

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
| `abilities` | object[] | no | Non-spell class features (e.g. Herbalism, Pick Locks, Detect Traps). Each entry references an [Ability](ability.md) by id with a per-class level gate. See *abilities entry* below. | TBD |
| `allowable_item_types` | string[] | no | Item.item_type values this class is allowed to equip (weapon + armor). `["fists", "dagger", "cloth"]` etc. | TBD |

### `casting_type` values

| Value | Meaning |
|---|---|
| `"none"` | No spells. The class doesn't appear in any spellcaster gating. |
| `"sorcerer"` | Arcane / INT-flavored catalog (Wizard, Alchemist). |
| `"priest"` | Divine / WIS-flavored catalog (Cleric, Paladin, Ranger). |

A class with `["sorcerer", "priest"]` (currently just Druid) can cast from both catalogs. The list is the set of catalogs the class participates in — it is not ordered, and `"none"` should never appear alongside another value.

## `abilities[]` entry

Non-spell class features. Spells are handled separately — see [Spell](spell.md)'s `casting_type` (the catalog) and `class_min_levels` (per-class level overrides). The entry is a thin reference into the [Ability](ability.md) catalog (where the name, description, and default params live); only the per-class level gate is duplicated here.

| Field | Type | Description |
|---|---|---|
| `ability_id` | string | Id of an [Ability](ability.md) record (e.g. `"pick_locks"`, `"detect_traps"`, `"herbalism"`) |
| `min_level` | int | Level at which a member of this class unlocks the ability (defaults to 1 when omitted) |

## Cross-references to other models

- `casting_type[]` ↔ [Spell](spell.md) `casting_type` — class eligibility gate. Every class with a matching catalog can cast every spell in that catalog.
- `abilities[].ability_id` → [Ability](ability.md) `id` — the catalog records (name, description, default params) live in `abilities.json`; this record only adds the per-class `min_level` gate.
- `allowable_item_types[]` → [Item](item.md) `item_type` — gates which weapons/armor a class may equip.
- Referenced *by* [Spell](spell.md) `class_min_levels` keys — per-class level overrides for specific spells (currently unused; reserved for cases where a class learns a spell at a different level than the spell's base `min_level`)
- Referenced *by* [Party](party.md) `roster[].class` (matched case-insensitively against `name`)

## Example record

```json
{
  "id": "ranger",
  "name": "Ranger",
  "range": 6,
  "casting_type": ["priest"],
  "allowable_item_types": ["fists", "dagger", "club", "sword", "sling", "short_bow", "long_bow", "crossbow", "cloth", "leather", "chain"],
  "abilities": [
    { "ability_id": "pick_locks",   "min_level": 3 },
    { "ability_id": "detect_traps", "min_level": 3 }
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
- **`abilities[]` are id references, not inline records.** Migrated from the original `class_abilities[]` shape (which carried `{ name, min_level, description }` inline). The catalog records now live in `abilities.json` so the same Ability can be granted from multiple sources (Cleric + Paladin both get `turn_undead`; Thief + Ranger both get `pick_locks` and `detect_traps`) without duplicating the description.
- **Turn Undead is an Ability, not a Spell.** v1 carried it in both `class_abilities` (for char-sheet display) and `spells.json` (with `class_min_levels: { Paladin: 5 }`). v2 collapsed those into a single [Ability](ability.md) record (`turn_undead`) that carries both the character-sheet description and the cast mechanic (mp_cost, range, targeting, save_dc_base, sfx, etc.) in its `params`. Cleric @ 2 and Paladin @ 5 are encoded as the per-class `min_level` on each class's `abilities[]` entry.
- **Per-class param overrides are not modelled yet.** Alchemist's Herbalism doubles the find rate compared to Druid's, but the class record only carries `{ ability_id, min_level }`. If/when the Ability model gains per-granter overrides (parallel to Spell `class_min_levels`), Alchemist's link would carry e.g. `params: { chance_multiplier: 2 }`.
