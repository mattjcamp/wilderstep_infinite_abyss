# Party

## Purpose

The starting party seed: which map the party spawns on and at which tile, the shared gold pool, the characters currently in the adventuring group (the roster), the party-wide effect slots, the shared inventory stash, and a few step-counter resources (torch, Galadriel's Light).

This is a **singleton** — one Party record per module, not a collection. Characters themselves live in [Character](character.md); Party references them by id. Live game state (where the party currently is, what they've changed since the seed) lives in the runtime [Game](game.md) save.

Ported from v1's `data/party.json`, then refactored: in v1 the `roster[]` was an embedded array of full character objects. In v2 the roster is a list of Character ids, and character data lives in `characters.json`. v1 also split the party into a `roster` pool plus an `active_party` subset of four — v2 collapses these into a single `roster` (every character listed is in the active group).

## Location

`web/public/modules/default/party.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

A flat singleton object — the whole file is one Party record.

```json
{
  "_comment": "...",
  "start_position": { "map_id": ..., "col": ..., "row": ... },
  "gold": ...,
  "roster": [ "<character_id>", ... ],
  "party_effects": { "effect_1": ..., ..., "effect_4": ... },
  "inventory": [ <inventory_entry>, ... ],
  "torch_steps": ...,
  "galadriels_light_steps": ...
}
```

## Top-level fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `start_position` | `{ map_id: string, col: int, row: int }` | yes | Where the party spawns. `map_id` references a [Map](map.md) id; `col`/`row` are the cell within that map. On a fresh game this is the seed; on a save-game it's overwritten with the party's last position so loading drops them where they were. | TBD |
| `gold` | int | yes | Shared party gold pool | TBD |
| `roster` | string[] | yes | [Character](character.md) ids in the adventuring party. Typically four; the engine treats every roster entry as actively adventuring. | TBD |
| `party_effects` | object | yes | Up to four named active [Effect](effect.md) slots; each value is an Effect id or null | TBD |
| `inventory` | object[] | yes | Shared party stash. Each entry is `{ item, charges?, durability? }` where `item` is an [Item](item.md) `id` (snake_case). | TBD |
| `torch_steps` | int | yes | Remaining lit-torch steps | TBD |
| `galadriels_light_steps` | int | yes | Elven Light remaining steps | TBD |

## `party_effects` sub-object

Four named slots; each value is an [Effect](effect.md) id or `null`.

| Field | Type | Description |
|---|---|---|
| `effect_1` | string \| null | First active effect id |
| `effect_2` | string \| null | Second active effect id |
| `effect_3` | string \| null | Third active effect id |
| `effect_4` | string \| null | Fourth active effect id |

## Cross-references to other models

- `start_position.map_id` → [Map](map.md) id
- `roster[]` → [Character](character.md) ids
- `party_effects.effect_1..4` → [Effect](effect.md) ids
- `inventory[].item` → [Item](item.md) id

## Example record

```json
{
  "start_position": { "map_id": "test2", "col": 14, "row": 16 },
  "gold": 50,
  "roster": ["aldric", "pippin", "selina", "elminster"],
  "party_effects": {
    "effect_1": null,
    "effect_2": null,
    "effect_3": null,
    "effect_4": null
  },
  "inventory": [
    { "item": "torch", "charges": 1 },
    { "item": "rock", "charges": 20 },
    { "item": "lockpick", "charges": 10 }
  ],
  "torch_steps": 0,
  "galadriels_light_steps": 0
}
```

## Notes and open questions

- **Refactor from v1.** v1 embedded the roster as inline character records. v2 splits Character into its own model and references by id.
- **`roster` collapsed `active_party`.** v1 carried a separate `active_party` subset of four ids on top of `roster`. v2 drops that distinction — every entry in `roster` is in the active adventuring group. Recruitable-but-bench-warming characters (the "available pool" the v1 doc described) are not modelled in v2 today; if/when they come back, they're more naturally a separate "recruitable" pool than a parallel array on Party.
- **Per-character data lives in [Character](character.md).** Equipment, inventory bags, stats, level — none of that is here anymore. Party only carries party-wide concerns.
- **Singleton vs. per-module seed.** This file is the *default* seed at the data-model layer. Per the architecture plan, each module ships its own starting party at `modules/<id>/party.json`. The v2 module-loading layer will determine precedence; the data shape is the same either way.
- **Inventory items reference by id.** Migrated from `Item.name` (`"Torch"`, `"Rock"`, `"Lockpick"`) once the rest of v2 standardized on Item ids.
