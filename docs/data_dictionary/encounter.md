# Encounter

## Purpose

Named monster rosters used by the random-encounter sampler and by quest kill-steps. Each encounter ties a difficulty `level`, a sampling `weight`, and an `area` discriminator to a list of monster names. The combat scene loads the full roster from this record on a hit.

Ported from v1's `data/encounters.json` (see `_v1_reference/docs/data_dictionary/encounters.json.md`).

## Location

`data_model/encounters.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "encounters": [ <encounter_record>, ... ]
}
```

v1 nested encounters under three top-level area keys (`dungeon`, `house_basement`, `overworld`). v2 flattens to a single array with an explicit `area` field on each record.

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case. Same-name encounters across areas get area-suffixed ids (e.g. `cellar_rats_dungeon` vs `cellar_rats_house_basement`) | TBD |
| `area` | string | yes | Discriminator: `"dungeon"`, `"house_basement"`, or `"overworld"`. The sampler picks an area, then samples encounters from that bucket. | TBD |
| `name` | string | yes | Display / lookup name; referenced by quest kill-step rows | TBD |
| `level` | int (1–8) | yes | Difficulty band; the sampler filters by `[minLevel..maxLevel]` | TBD |
| `weight` | int (> 0) | yes | Weighted-sample probability inside an eligible band | TBD |
| `monster_party_tile` | string | yes | Lead monster shown on the overworld map sprite (empty string falls back to `monsters[0]`) | TBD |
| `monsters` | string[] | yes | Roster handed to the combat scene; cross-refs Monster `name` | TBD |

## Polymorphic discriminator

`area` is the discriminator. The sampler is called as `sampleEncounter(area, ...)` and filters to records matching the chosen area.

## Cross-references to other models

- `monsters[]` and `monster_party_tile` → [Monster](monster.md) names
- Referenced *by* future [NPC](npc.md) records (v1's town NPCs could trigger named encounters) and [Quest Step](quest_step.md) kill-step rows

## Example record

```json
{
  "id": "cellar_rats",
  "area": "dungeon",
  "name": "Cellar Rats",
  "level": 1,
  "weight": 30,
  "monster_party_tile": "Giant Rat",
  "monsters": ["Giant Rat"]
}
```

## Notes and open questions

- **Dropped from v1 per the not-used rule:** `terrain` (every record set it but no v1 consumer queried; 88 of 91 records were `"land"` anyway). If sea/land filtering becomes a thing, wire it deliberately and re-introduce.
- **House_basement is capped at levels 1–2.** Intentional per v1's narrative scope (only one tier of basements).
- **Two v1 overworld records had empty `monster_party_tile`** (Lich with Minions, Mind Flayer). v2 carries them forward as-is; the runtime falls back to `monsters[0]` for display.
- **Same-name encounters across areas** were silently disambiguated by v2's id assignment — the area is appended (`cellar_rats` → `cellar_rats_dungeon`, `cellar_rats_house_basement`). 11 such collisions in the v1 data.
- **No id-based reference to Monster yet.** `monsters[]` carries Monster `name` strings — same convention as elsewhere in v2.
