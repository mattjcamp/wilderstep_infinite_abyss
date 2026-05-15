# Dungeon Level

## Purpose

One floor of an **authored** [Dungeon](dungeon.md). A Dungeon Level wraps a [Map](map.md) (the actual playable tile grid) with dungeon-specific metadata: which floor number it is, and the display name shown when the party descends.

Dungeon Levels are **inline objects under their parent Dungeon's `levels[]`**, not a separate top-level catalog. They have no meaning outside the Dungeon that owns them and aren't referenced by any other model.

Procedural dungeon floors are generated at runtime and don't live in this catalog — see [Dungeon Config](dungeon_config.md).

## Location

Inline under [Dungeon](dungeon.md) records in `web/public/modules/default/dungeons.json`. The `dungeon_levels.json` file is a deprecated stub kept empty so old fetches don't 404.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — fields beyond `id`, `name`, `depth`, and `map_id` are open.

## Inline shape

Each entry in a parent Dungeon's `levels[]` is an object with the fields below.

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"crypt_of_dagorn_l1"`). Unique within the parent Dungeon's `levels[]` — there is no global Dungeon Level catalog, so the id only needs to disambiguate among siblings. Convention: `<dungeon_id>_l<depth>`. | TBD |
| `name` | string | yes | Display name shown to the player when entering this floor (e.g. `"Crypt of Dagorn — Tomb Hall"`) | TBD |
| `tags` | string[] | no | Editor-side organizational labels. Usually carried for tooling convenience; gameplay doesn't read them. | TBD |
| `depth` | int | yes | 1-indexed floor number; level 1 is the entrance, larger numbers go deeper. | TBD |
| `map_id` | string | yes | [Map](map.md) `id` — the tile grid actually rendered when the party is on this floor. | TBD |

## Cross-references to other models

- `map_id` → [Map](map.md) `id`
- Owned *by* [Dungeon](dungeon.md) `levels[]` (inline, not by reference)

## Example record (inline under a Dungeon)

```json
{
  "id": "crypt_of_dagorn_l1",
  "name": "Crypt of Dagorn — Tomb Hall",
  "depth": 1,
  "map_id": "crypt_of_dagorn_l1_map"
}
```

## Notes and open questions

- **Inline, not a separate catalog.** An earlier pass put Dungeon Levels in their own `dungeon_levels.json` catalog. The model collapsed to inline objects because levels have no meaning outside their owning Dungeon and no other model needs to reference them by global id. The standalone catalog file is deprecated; if you have local copies, drop them.
- **Schema is a stub.** Likely future additions: per-floor entry/exit coordinates on the Map (so stair tiles know where to land the party on the floor above / below), per-floor ambient lighting override, per-floor encounter pool override, scripted-event hooks.
- **`depth` vs. `levels[]` index.** Both convey "which floor is this." Carry both for now — the Dungeon's ordering is the truth, but `depth` on the level record makes the floor self-describing for tooling.
