# Spawn

## Purpose

Monster-lair behavior. A Spawn record describes how a lair behaves; the binding to a place on the world happens on the [Map Tile](map_tile.md) — every painted cell carries an optional `spawn` field that names a Spawn id. When the party steps on (or near) such a cell, this record drives the roamer-roller (`spawn_monsters` + `spawn_chance` + `max_spawned` + `spawn_radius`); when they step on the cell itself, the boss fight (`boss_monsters`).

Ported from v1's `data/spawn_points.json` (see `_v1_reference/docs/data_dictionary/spawn_points.json.md`). v1 keyed lairs by integer tile id; v2 inverts that — Spawns are catalog records and *cells* point at them — so the same lair definition can be reused across maps and the binding is an explicit author choice.

## Location

`web/public/modules/default/spawns.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "spawns": [ <spawn_record>, ... ]
}
```

v1 keyed spawn records by stringified tile id; v2 flattens to an array (uniform with the other v2 collections) and the cell→spawn link replaces the inline `tile_id` (see Purpose).

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"monster_spawn"`, `"dragon_lair"`). Referenced by [Map Tile](map_tile.md) `spawn`. | TBD |
| `name` | string | yes | Display name for the "Approach Lair?" prompt | TBD |
| `description` | string | no | Flavor text shown when approaching | TBD |
| `spawn_monsters` | string[] | yes | Roster the per-step roller picks from (uniform random). Each entry is a [Monster](monster.md) `id`. Duplicates control sampling weight (`["goblin","goblin","orc"]` ≈ 2:1 goblin-to-orc). | TBD |
| `spawn_chance` | int (1–100) | yes | Per-step percent chance to spawn a roamer | TBD |
| `spawn_radius` | int | yes | Chebyshev tile radius for the saturation check | TBD |
| `max_spawned` | int | yes | Cap on simultaneous roamers around the tile | TBD |
| `boss_monsters` | string[] | yes | Monsters composing the boss fight triggered when stepping on the tile itself. Each entry is a [Monster](monster.md) `id`. Duplicates spawn multiple instances. | TBD |
| `xp_reward` | int | yes | XP awarded for clearing the lair | TBD |
| `gold_reward` | int | yes | Gold awarded for clearing the lair | TBD |
| `loot` | string[] | yes | [Item](item.md) `id` strings dropped on clear. Duplicates drop multiple copies. | TBD |
| `custom_map` | string \| null | no | Optional [Map](map.md) `id`. When set, the lair's boss fight loads this authored map as the battle arena; `null` falls back to the default arena. The editor renders a Map picker for this field. | TBD |

## Cross-references to other models

- Referenced *by* [Map Tile](map_tile.md) `spawn` — the cell→spawn link is the binding mechanism
- `spawn_monsters[]` and `boss_monsters[]` → [Monster](monster.md) ids
- `loot[]` → [Item](item.md) ids
- `custom_map` → [Map](map.md) id (optional battle arena for the lair's boss fight)

## Example record

```json
{
  "id": "monster_spawn",
  "name": "Monster Spawn",
  "description": "A monster lair.",
  "spawn_monsters": ["giant_rat", "wolf", "goblin", "orc", "lich"],
  "spawn_chance": 5,
  "spawn_radius": 5,
  "max_spawned": 2,
  "boss_monsters": ["goblin"],
  "xp_reward": 50,
  "gold_reward": 25,
  "loot": ["chain_plus_2", "arrows"],
  "custom_map": null
}
```

## Notes and open questions

- **Dropped from v1 per the not-used rule:** `background_tile` (set on every v1 record but the v1 parser ignored it — cleared lairs in v1 had no explicit reveal tile). If cleared-lair reveal becomes a thing, re-introduce as `cleared_tile_id`.
- **`boss_monster` (singular) was a legacy fallback for `boss_monsters` in v1.** v2 keeps only the plural form; lairs that v1 had with only the singular set should be updated to populate `boss_monsters`.
- **v1's tile_id binding was replaced by the cell→spawn link.** v1 carried `tile_id` on each spawn record; v2 drops it. Spawns are now place-agnostic catalog records, and each painted [Map Tile](map_tile.md) cell carries an optional `spawn` field naming the Spawn id. This decouples lair behavior from any single tile and lets one Spawn back many cells across many maps.
- **Migrated to id references.** v1 (and the first v2 pass) carried Monster *names* in `spawn_monsters[]`/`boss_monsters[]` and Item *names* in `loot[]`. v2 switched all three to id strings (snake_case) so refactors of display names don't silently break spawn rosters.
- **Two dangling loot ids.** The `graveyard_spawn` record references `bones` and `ancient_shield` — neither has a matching record in `items.json` (carried over from v1 where they were never ported as proper Items). The ids are preserved here so author intent isn't lost; resolving them means either adding the missing Item records or pruning the refs.
