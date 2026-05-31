# Map

## Purpose

A single unified model for authored maps. Overview, Towns, Buildings, Detail Screens, and Battle Screens are all just Maps — the distinction between them is conceptual, not structural. Every map shares the same shape and the same (map, x, y) tile-link system, and the game treats them all identically.

## Location

Future location: `web/public/modules/<module_id>/maps.json` (per-module). The Map data model has not been formally designed yet — it's intentionally deferred until the editor's spatial-authoring surface is being built. This doc is a placeholder.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

The canonical stub is a single example record:

```json
{
  "id": "",
  "name": ""
}
```

The on-disk representation in a real module will collect many records of this type (see `docs/dev_guides/game_architecture_plan.md` for the per-module file layout). The shape of that collection file is TBD.

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Unique identifier for this record, scoped to its module | TBD |
| `name` | string | yes | Human-readable display name | TBD |

## Polymorphic discriminators

TBD.

## Cross-references to other models

TBD. As fields are added, this section will list which other models this one points at (by id) and which models reference it.

## Example record

```json
{
  "id": "",
  "name": ""
}
```

## Per-cell tile attributes

Beyond the shared tile-catalog fields, individual painted cells in a map's
grid can carry per-cell overrides the simulation reads (see `SimCell` in
`web/src/sim/types.ts` and `TileType` in the editor). The interaction-relevant
ones today:

| Cell field | Type | Meaning |
|---|---|---|
| `sprite` | string | The cell's main (foreground) graphic. Carries the tile's gameplay role via its Tile Palette entry. May have transparent pixels. |
| `background_sprite` | string | Optional purely-visual sprite drawn BEHIND `sprite` and lit identically. Lets a transparent foreground (tower, tree) sit on a chosen terrain (grass, forest, mountain) without baking a combined tile per terrain. Absent → the dark canvas shows through (original look). No gameplay meaning of its own. |
| `link` | `{ map_id, x, y }` | Inter-map portal. Stepping onto the cell traverses to `(map_id, x, y)`. |
| `show_link_placard` | bool | When set on a `link` **or** dungeon-entrance cell, the play host shows a confirm placard (destination name + description + an Explored/Unexplored badge) before crossing, instead of traversing/entering immediately. Opt-in per tile so only authored landmarks (dungeon mouths, region portals) announce themselves; mundane doors keep crossing instantly. The placard's text comes from the destination [Map](map.md) / Dungeon `description`. |
| `dungeon` | string | Dungeon id. Stepping onto the cell descends into that dungeon (honours `show_link_placard`). |
| `locked` | bool | Passage gated until unlocked (key / pick / scripted). |
| `npc` / `counter` | string | NPC dialog / shop counter planted on the cell. |

## Notes and open questions

- Schema is a placeholder. Fields beyond `id` and `name` are still to be decided.
- `description` (string) is authored per map and surfaces in the link placard above; the play host threads it through the runtime map record.
