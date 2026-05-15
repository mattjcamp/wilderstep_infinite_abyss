# Race

## Purpose

Playable races. Each race carries stat modifiers applied at character creation, an optional XP curve override (Human gets a leveling bonus), and an optional list of innate [Ability](ability.md) ids granted to every member of the race. Ported from v1's `data/races.json` (see `_v1_reference/docs/data_dictionary/races.json.md`); the v1 field name `effects[]` was renamed to `abilities[]` in v2 once the Ability catalog landed.

## Location

`web/public/data/races.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "races": [ <race_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"human"`, `"dwarf"`) | TBD |
| `name` | string | yes | Display label (e.g. `"Human"`) | TBD |
| `description` | string | no | Flavor text shown in the character creator | TBD |
| `stat_modifiers` | object | yes | Per-stat deltas applied at creation: `{ strength, dexterity, constitution, intelligence, wisdom }` | TBD |
| `exp_per_level` | number | no | XP required per level for this race. The XP curve is race-determined in our rules — there is no class-side override. Absent values fall back to an engine default (TBD). | TBD |
| `abilities` | string[] | yes | Innate [Ability](ability.md) ids granted to every member of this race. Currently: Human → `["fast_learner"]`, Dwarf → `["infravision"]`, Halfling → `["pickpocket"]`, Elf → `["galadriels_light"]`, Gnome → `["tinker"]`. | TBD |

## Cross-references to other models

- `abilities[]` → [Ability](ability.md) — Ability ids granted automatically to every member. All five entries (`fast_learner`, `infravision`, `pickpocket`, `galadriels_light`, `tinker`) resolve to records in `abilities.json`.
- Referenced *by* [Party](party.md) `roster[].race`

## Example record

```json
{
  "id": "dwarf",
  "name": "Dwarf",
  "description": "Stout and hardy, dwarves are natural miners and warriors with keen underground senses.",
  "stat_modifiers": {
    "strength": 2,
    "dexterity": -1,
    "constitution": 2,
    "intelligence": 0,
    "wisdom": 1
  },
  "abilities": ["infravision"]
}
```

## Notes and open questions

- **Migrated from Effect to Ability.** v1 (and the first v2 pass) listed racial perks as Effect ids in an `effects[]` field; three of those ids (`pickpocket`, `galadriel_light`, `tinker`) didn't have matching Effect records because v1's TS hardcoded the behavior. The v2 refactor renamed the field to `abilities[]`, fixed the `galadriel_light` → `galadriels_light` typo, and migrated all five entries (plus Human's previously-implicit `fast_learner`) into the [Ability](ability.md) catalog so the character-sheet surface is uniform with class abilities.
- **`exp_per_level` is the XP curve, not an override.** In v2 the leveling speed lives entirely on Race — Character Class no longer carries this field. Human sets 1125 (faster); other races in default/ are absent and need either an engine default or an explicit value before the level-up loop is wired up. v1 had it on both Race and Class with the Class value (1500) acting as a fallback, but that arrangement was never honored by the v2 rules.
- **`stat_modifiers` was duplicated as a TS constant in v1** (`RACE_MODS` in `app/party/new/page.tsx`). v2 should drive from JSON; the constant should disappear once the loader is in.
- **No `allowed_classes` field, and no equivalent on Class either.** The v1 race-class gate table is no longer in the data — v1's TS hardcoded it in `app/party/new/page.tsx` and the JSON copies were never read. If v2 wants to gate class selection by race, this is where that field would live (or it could go back on Class as `allowed_races`); the decision is pending until the character creator is wired up.
