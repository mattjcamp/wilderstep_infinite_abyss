# Encounter

## Purpose

Named monster rosters used by the random-encounter sampler and by quest kill-steps. Each encounter ties a difficulty `level`, a sampling `weight`, and an `area` discriminator to a list of [Monster](monster.md) ids. The combat scene loads the full roster from this record on a hit.

Ported from v1's `data/encounters.json` (see `_v1_reference/docs/data_dictionary/encounters.json.md`).

## Location

`web/public/modules/default/encounters.json` — real data drives the schema.

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
| `monster_party_tile` | string | yes | Sprite path shown for the lead monster on the overworld (e.g. `"monster/goblin.png"`). Empty string falls back to `monsters[0]`'s default sprite. | TBD |
| `monsters` | string[] | yes | Roster handed to the combat scene. Each entry is a [Monster](monster.md) `id` (snake_case). Duplicates spawn multiple instances. | TBD |
| `custom_map` | string \| null | no | Optional [Map](map.md) `id`. When set, the encounter's battle loads this authored map as the arena; `null` falls back to the default arena. The editor renders a Map picker for this field. | TBD |
| `arena_id` | string | no | Optional arena-map id the battle launcher pre-selects when this encounter is picked (overridable in the launcher). Unknown ids are ignored. JSON key: `arena_id`. | TBD |
| `darkness` | boolean | no | When true, the launcher's Darkness toggle is pre-checked so the fight starts in low-light. Pairs naturally with an `arena_id` whose map has `light_source` cells. | TBD |
| `tags` | string[] | no | Free-form **editor-side** organizational labels (e.g. `"forest"`, `"act_1"`, `"boss"`). Gameplay ignores them — they exist only to group / filter the encounter list in the editor, which buckets encounters by their **first** tag (the "primary" tag), collapsibly. Mirrors `tags` on [Map](map.md) / [Dungeon](dungeon.md). | TBD |

## Polymorphic discriminator

`area` is the discriminator. The sampler is called as `sampleEncounter(area, ...)` and filters to records matching the chosen area.

## Cross-references to other models

- `monsters[]` → [Monster](monster.md) ids
- `monster_party_tile` is a sprite path, not a [Monster](monster.md) reference — it points at a file under `web/public/sprites/`
- `custom_map` → [Map](map.md) id (optional battle arena for the encounter's fight)
- Referenced *by* future [NPC](npc.md) records (v1's town NPCs could trigger named encounters) and [Quest Step](quest_step.md) kill-step rows

## Example record

```json
{
  "id": "cellar_rats",
  "area": "dungeon",
  "name": "Cellar Rats",
  "level": 1,
  "weight": 30,
  "monster_party_tile": "monster/giant_rat.png",
  "monsters": ["giant_rat"],
  "custom_map": null
}
```

## Notes and open questions

- **`tags` is organizational only; `area` is functional.** A 2024 audit confirmed `area`, `level`, and `weight` are all live: `sampleEncounter` (called by the procedural dungeon generator) picks the bucket by `area`, filters by the `level` band, and rolls weighted by `weight`. Hand-placed encounters (painted cells, quest kill-steps, interior/town authored spawns) reference encounters by id and ignore `level`/`weight`. `tags` was added purely for editor grouping and is never read at runtime — don't repurpose it to drive spawning without wiring a real consumer. `arena_id` / `darkness` are real battle-launcher features that simply have no data yet.
- **Dropped from v1 per the not-used rule:** `terrain` (every record set it but no v1 consumer queried; 88 of 91 records were `"land"` anyway). If sea/land filtering becomes a thing, wire it deliberately and re-introduce.
- **House_basement is capped at levels 1–2.** Intentional per v1's narrative scope (only one tier of basements).
- **Two v1 overworld records had empty `monster_party_tile`** (Lich with Minions, Mind Flayer). v2 carries them forward as-is; the runtime falls back to `monsters[0]` for display.
- **Same-name encounters across areas** were silently disambiguated by v2's id assignment — the area is appended (`cellar_rats` → `cellar_rats_dungeon`, `cellar_rats_house_basement`). 11 such collisions in the v1 data.
- **Migrated to id references.** v1 (and the first v2 pass) carried Monster `name` strings in `monsters[]`. v2 switched to `Monster.id` (snake_case) so display-name refactors don't silently break encounter rosters. `monster_party_tile` is unchanged — it's always been a sprite path, not a Monster reference.
