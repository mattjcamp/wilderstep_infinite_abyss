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
  "party_effects": [ "<ability_id>", ... ],
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
| `party_effects` | string[] | yes | Currently-active party-wide [Ability](ability.md) ids — abilities flagged with `party_effect: true`. Dynamic list (no fixed slot count); the in-game Party screen renders one row per available ability and lets the player toggle them on or off. Default `[]`. | TBD |
| `inventory` | object[] | yes | Shared party stash. Each entry is `{ item, charges?, durability? }` where `item` is an [Item](item.md) `id` (snake_case). | TBD |
| `torch_steps` | int | yes | Remaining lit-torch steps | TBD |
| `galadriels_light_steps` | int | yes | Elven Light remaining steps | TBD |

## Cross-references to other models

- `start_position.map_id` → [Map](map.md) id
- `roster[]` → [Character](character.md) ids
- `party_effects[]` → [Ability](ability.md) ids (only ids of abilities with `party_effect: true` should appear here)
- `inventory[].item` → [Item](item.md) id

## Example record

```json
{
  "start_position": { "map_id": "test2", "col": 14, "row": 16 },
  "gold": 50,
  "roster": ["aldric", "pippin", "selina", "elminster"],
  "party_effects": [],
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
- **No fixed slot count on `party_effects`.** v1 modeled the in-game effect list as four named slots (`effect_1..4`) to match the original Ultima 3 HUD constraint. v2 drops the cap — the in-game Party screen lists every available party-wide Ability the roster unlocks and lets the player toggle them on or off; `party_effects` is just the array of currently-on ability ids. Source-of-truth for which abilities qualify is the `party_effect` flag on [Ability](ability.md) records.
