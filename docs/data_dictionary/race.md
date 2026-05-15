# Race

## Purpose

Playable races. Each race carries stat modifiers applied at character creation, an optional XP curve override (Human gets a leveling bonus in v1), and an optional list of innate ability Effect ids granted to members. Ported from v1's `data/races.json` (see `_v1_reference/docs/data_dictionary/races.json.md`).

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
| `effects` | string[] | yes | Innate ability Effect ids granted to members of this race | TBD |

## Cross-references to other models

- `effects[]` → [Effect](effect.md) — Effect ids granted automatically to members. Currently only `"infravision"` resolves to an Effect record in v2's effects.json. The other three ids carried over from v1 (`pickpocket`, `galadriel_light`, `tinker`) point at racial abilities that v1 hardcoded in TS and never added to the Effects catalog — they remain as design-intent here pending a decision to either define them as Effects or move them to another model.
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
  "effects": ["infravision"]
}
```

## Notes and open questions

- **Effect refs `pickpocket`, `galadriel_light`, `tinker` are dangling.** v1's TS hardcoded the racial-ability behaviors and didn't put them in `effects.json`. v2 carried the references forward so the design intent is preserved. Either add Effect records for them (matching the v1 hardcoded behavior) or drop the refs.
- **`exp_per_level` is the XP curve, not an override.** In v2 the leveling speed lives entirely on Race — Character Class no longer carries this field. Human sets 1125 (faster); other races in default/ are absent and need either an engine default or an explicit value before the level-up loop is wired up. v1 had it on both Race and Class with the Class value (1500) acting as a fallback, but that arrangement was never honored by the v2 rules.
- **`stat_modifiers` was duplicated as a TS constant in v1** (`RACE_MODS` in `app/party/new/page.tsx`). v2 should drive from JSON; the constant should disappear once the loader is in.
- **No `allowed_classes` field, and no equivalent on Class either.** The v1 race-class gate table is no longer in the data — v1's TS hardcoded it in `app/party/new/page.tsx` and the JSON copies were never read. If v2 wants to gate class selection by race, this is where that field would live (or it could go back on Class as `allowed_races`); the decision is pending until the character creator is wired up.
