# Dungeon

## Purpose

An **authored** multi-level dungeon — a hand-painted adventure with named floors the party descends through. Each Dungeon record names the dungeon and embeds its [Dungeon Level](dungeon_level.md) records inline under `levels[]`; each level points at a [Map](map.md) for its tile grid.

This is distinct from [Dungeon Config](dungeon_config.md), which describes a *procedural* generator's input parameters. Authored dungeons are hand-painted maps with deliberate placement; procedural dungeons are rolled at runtime. The two models coexist — a Module can ship both.

## Location

`web/public/modules/default/dungeons.json` — real data drives the schema. Catalog ships empty in the seed module; adventures populate it.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — fields beyond `id`, `name`, `tags`, and `levels[]` are open.

## File shape

```
{
  "_comment": "optional authoring notes",
  "dungeons": [ <dungeon_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"crypt_of_dagorn"`) | TBD |
| `name` | string | yes | Display name shown when the party enters | TBD |
| `description` | string | no | Flavor text shown on entry or in a quest log | TBD |
| `tags` | string[] | no | Editor-side organizational labels (e.g. `["main_story", "act_1"]`). Purely for grouping in the browse view — gameplay doesn't read them. Same convention as [Map](map.md) `tags`. | TBD |
| `levels` | object[] | yes | Ordered list of inline [Dungeon Level](dungeon_level.md) records; index 0 is the entrance floor, deeper floors follow. | TBD |

## Cross-references to other models

- `levels[].map_id` → [Map](map.md) `id` (each inline level points at the tile grid it renders)
- Referenced *by* [Map Tile](map_tile.md) — a cell with `dungeon: "<dungeon_id>"` is a dungeon-entrance trigger on a normal Map (entering steps the party onto `levels[0]`'s Map)

## Example record

```json
{
  "id": "crypt_of_dagorn",
  "name": "Crypt of Dagorn",
  "description": "An ancient burial vault sealed against the rising tide of undeath.",
  "tags": ["main_story", "act_1"],
  "levels": [
    {
      "id": "crypt_of_dagorn_l1",
      "name": "Tomb Hall",
      "depth": 1,
      "map_id": "crypt_of_dagorn_l1_map"
    },
    {
      "id": "crypt_of_dagorn_l2",
      "name": "Vault Approach",
      "depth": 2,
      "map_id": "crypt_of_dagorn_l2_map"
    }
  ]
}
```

## Notes and open questions

- **Levels are inline, not a separate catalog.** Earlier drafts stored Dungeon Levels in their own `dungeon_levels.json`; the model collapsed back to inline objects because no other record references levels by id — they exist only as children of their parent Dungeon. The dictionary entry for [Dungeon Level](dungeon_level.md) still documents the inline shape.
- **Schema is a stub.** Likely future additions: party-entry coordinates per level (so descending stairs land somewhere specific), per-dungeon ambient lighting, per-dungeon encounter/spawn overrides, completion flags.
- **Authored vs. procedural.** Use Dungeon when every floor should be deliberately laid out (puzzles, set-piece encounters). Use [Dungeon Config](dungeon_config.md) when the rogue-like dimension is the point.
- **Level ids are scope-local.** A level id like `crypt_of_dagorn_l1` only needs to be unique within its parent Dungeon's `levels[]` — there's no global level catalog to collide with. Save-game state can address a level as `(dungeon_id, level_id)` or by the level's position in `levels[]`.
