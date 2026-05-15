# Dungeon Level

## Purpose

One floor of an **authored** [Dungeon](dungeon.md). A Dungeon Level wraps a [Map](map.md) (the actual playable tile grid) with dungeon-specific metadata: which floor number it is, the display name shown when the party descends, and the link back to its owning Dungeon (implicitly, via the Dungeon's `levels[]` ordering).

Procedural dungeon floors are generated at runtime and don't live in this catalog — see [Dungeon Config](dungeon_config.md).

## Location

`web/public/modules/default/dungeon_levels.json` — real data drives the schema. Catalog ships empty.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — fields beyond `id`, `name`, `depth`, and `map_id` are open.

## File shape

```
{
  "_comment": "optional authoring notes",
  "dungeon_levels": [ <level_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"crypt_of_dagorn_l1"`). Convention: `<dungeon_id>_l<depth>`. | TBD |
| `name` | string | yes | Display name shown to the player when entering this floor (e.g. `"Crypt of Dagorn — Tomb Hall"`) | TBD |
| `tags` | string[] | no | Editor-side organizational labels. Usually the parent-dungeon id (so the editor can group all `crypt_of_dagorn` floors together). Gameplay doesn't read them. | TBD |
| `depth` | int | yes | 1-indexed floor number; level 1 is the entrance, larger numbers go deeper. | TBD |
| `map_id` | string | yes | [Map](map.md) `id` — the tile grid actually rendered when the party is on this floor. | TBD |

## Cross-references to other models

- `map_id` → [Map](map.md) `id`
- Referenced *by* [Dungeon](dungeon.md) `levels[]`

## Example record

```json
{
  "id": "crypt_of_dagorn_l1",
  "name": "Crypt of Dagorn — Tomb Hall",
  "tags": ["crypt_of_dagorn"],
  "depth": 1,
  "map_id": "crypt_of_dagorn_l1_map"
}
```

## Notes and open questions

- **Schema is a stub.** Likely future additions: per-floor entry/exit coordinates on the Map (so stair tiles know where to land the party on the floor above / below), per-floor ambient lighting override, per-floor encounter pool override, scripted-event hooks.
- **`depth` vs. `levels[]` index.** Both convey "which floor is this." Carry both for now — the Dungeon's ordering is the truth, but `depth` on the level record makes the floor self-describing for tooling.
