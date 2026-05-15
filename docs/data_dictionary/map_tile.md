# Map Tile

## Purpose

The canonical tile catalog — every tile id referenced in any map (overworld, town, dungeon, combat screen) resolves to a record here. Each tile carries display `name`, `walkable` flag, RGB fallback `color`, `sprite` key, optional `flags` for lighting/transparency, and optional `interaction_type` + `interaction_data` for tiles that drive game interactions (shop counters, signs, spawn triggers).

Ported from v1's `data/tile_defs.json` (see `_v1_reference/docs/data_dictionary/tile_defs.json.md`).

## Location

`web/public/data/map_tiles.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "map_tiles": [ <map_tile_record>, ... ]
}
```

v1 keyed records by stringified integer tile id; v2 flattens to an array with `tile_id` as a regular integer field (the identity used by every map data file).

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable text identifier (`<slugified_name>_<tile_id>`, e.g. `"grass_0"`, `"wall_torch_34"`). Tile-id suffix disambiguates name collisions like the two "Door" entries (town vs. dungeon). | TBD |
| `tile_id` | int | yes | The integer tile id used as cell values in all map data files. Sparse range (0–78 with gaps). | TBD |
| `name` | string | yes | Display name (e.g. `"Grass"`, `"Stone Floor"`, `"Wall Torch"`) | TBD |
| `walkable` | bool | yes | Whether the party can step on this tile | TBD |
| `color` | `[int, int, int]` | yes | RGB fallback rectangle color when no sprite renders | TBD |
| `sprite` | string | yes | Logical sprite key (e.g. `"overworld/grass"`); resolved to `/assets/<key>.png`. Empty string = render the fallback color. | TBD |
| `context` | string | no | Editor-side bucket: `"overworld"`, `"town"`, `"dungeon"`, `"artifacts"`, `"spawns"`. Only `"artifacts"` is queried by v1 TS at runtime (for quest artifact placement); other values are organizational. | TBD |
| `flags` | object | no | Lighting / transparency flags; see *flags* below | TBD |
| `interaction_type` | string | no | Interaction discriminator: `"shop"`, `"sign"`, `"spawn"` | TBD |
| `interaction_data` | string | no | Payload for the interaction; see *interactions* below | TBD |

## `flags` sub-object

Present on tiles that emit light or interact with the lighting system.

| Field | Type | Description |
|---|---|---|
| `light_source` | bool | Tile emits light (torch, brazier, lava) |
| `light_radius` | number | Light source radius in tiles |
| `light_intensity` | number | Light source intensity |
| `feature_light` | bool | "Feature light" (door, altar, exit) emitting smaller ambient light |
| `feature_radius` | number | Feature light radius |
| `feature_intensity` | number | Feature light intensity |
| `transparent` | bool | Light passes through this tile (water, windows) |

## Interactions (`interaction_type` + `interaction_data`)

| `interaction_type` | `interaction_data` meaning | Cross-reference |
|---|---|---|
| `"shop"` | Counter id (e.g. `"general"`, `"weapon"`, `"healing"`) | [Counter](counter.md) |
| `"sign"` | Literal sign message string | none |
| `"spawn"` | Spawn template id (matches a [Spawn](spawn.md) `id`) | [Spawn](spawn.md) |

## Cross-references to other models

- `interaction_data` for `interaction_type: "shop"` → [Counter](counter.md) id
- `tile_id` referenced *by* all map data files (overworld, town, dungeon — when those land in v2)
- A painted cell's `spawn` field references a [Spawn](spawn.md) `id` (the lair binding lives here, not on Spawn)
- v1 hardcoded specific tile ids as named constants in `Tiles.ts` (`TILE_GRASS = 0`, `TILE_BOAT = 64`, etc.). v2 should keep similar named constants in sync with this data.

## Example record (light-emitting tile)

```json
{
  "id": "wall_torch_34",
  "tile_id": 34,
  "name": "Wall Torch",
  "walkable": false,
  "color": [160, 120, 40],
  "sprite": "dungeon/wall_torch",
  "context": "dungeon",
  "flags": {
    "light_source": true,
    "light_radius": 5.0,
    "light_intensity": 3.0
  }
}
```

## Notes and open questions

- **Sparse id space.** v1 had gaps at 15–19, 30–31, 40–42, etc. — historical churn from the Python era. Renumbering would touch every map file, so v2 keeps the ids; just don't assume the range is dense.
- **`context` is mostly editor metadata.** Only `"artifacts"` is queried at runtime in v1 (for artifact placement). Other contexts are organizational. Could split into a separate `editor_metadata` block if v2 wants to distinguish runtime-meaningful fields from authoring fields.
- **Color placeholders.** Tile ids 48–65 and 70–76 have `color: [128, 128, 128]` in v1 — authors stopped filling it in once sprites became reliable. Fine in practice (the sprite is what renders) but the fallback won't be useful for those tiles.
- **Two "Door" entries.** Tile 13 (town door) and 26 (dungeon door) share the display name. v2's text ids disambiguate via the tile-id suffix; v1's `findArtifactTileId` matched by display name, which would have been ambiguous here.
- **Spawn trigger tiles (66–75) are identified in v1 by a hardcoded set in code**, not by `context`. If the relationship is going to be data-driven in v2, formalize it via the `context: "spawns"` discriminator and validate against [Spawn](spawn.md) records.
