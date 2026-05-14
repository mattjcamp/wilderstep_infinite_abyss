# Party

## Purpose

The starting party seed: where the party spawns on the world map, the shared gold pool, which characters are available to the player (the roster), which four are currently in the active adventuring group, the party-wide effect slots, the shared inventory stash, and a few step-counter resources (torch, Galadriel's Light).

This is a **singleton** — one Party record per module, not a collection. Characters themselves live in [Character](character.md); Party references them by id. Live game state (where the party currently is, what they've changed since the seed) lives in the runtime [Game](game.md) save.

Ported from v1's `data/party.json`, then refactored: in v1 the `roster[]` was an embedded array of full character objects. In v2 the roster is a list of Character ids, and character data lives in `characters.json`. This lets the roster grow well beyond the active party without bloating the Party record.

## Location

`web/public/modules/default/party.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

A flat singleton object — the whole file is one Party record.

```json
{
  "_comment": "...",
  "start_position": { "col": ..., "row": ... },
  "gold": ...,
  "roster": [ "<character_id>", ... ],
  "active_party": [ "<character_id>", ... ],
  "party_effects": { "effect_1": ..., ..., "effect_4": ... },
  "inventory": [ <inventory_entry>, ... ],
  "torch_steps": ...,
  "galadriels_light_steps": ...
}
```

## Top-level fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `start_position` | `{ col: int, row: int }` | yes | Initial party position on the world map | TBD |
| `gold` | int | yes | Shared party gold pool | TBD |
| `roster` | string[] | yes | [Character](character.md) ids available to the player (the recruit pool). Can grow large. | TBD |
| `active_party` | string[] | yes | Character ids currently in the active adventuring group (subset of `roster`, typically 4). | TBD |
| `party_effects` | object | yes | Up to four named active [Effect](effect.md) slots; each value is an Effect id or null | TBD |
| `inventory` | object[] | yes | Shared party stash. Each entry is `{ item, charges?, durability? }` where `item` is an [Item](item.md) name. | TBD |
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

- `roster[]` and `active_party[]` → [Character](character.md) ids
- `party_effects.effect_1..4` → [Effect](effect.md) ids
- `inventory[].item` → [Item](item.md) name

## Example record

```json
{
  "start_position": { "col": 14, "row": 16 },
  "gold": 50,
  "roster": ["aldric", "pippin", "selina", "elminster"],
  "active_party": ["aldric", "pippin", "selina", "elminster"],
  "party_effects": {
    "effect_1": null,
    "effect_2": null,
    "effect_3": null,
    "effect_4": null
  },
  "inventory": [
    { "item": "Torch", "charges": 1 },
    { "item": "Rock", "charges": 20 },
    { "item": "Lockpick", "charges": 10 }
  ],
  "torch_steps": 0,
  "galadriels_light_steps": 0
}
```

## Notes and open questions

- **Refactor from v1.** v1 embedded the roster as inline character records. v2 splits Character into its own model and references by id. This means a "large roster" (10+ characters the player has rolled or recruited) doesn't bloat the Party record, and the same Character can be referenced across multiple modules if reuse is wanted later.
- **`active_party` as Character ids, not indices.** v1 used indices into the roster array (`[0, 1, 2, 3]`). v2 uses ids directly so reordering the roster doesn't shift the active set.
- **`roster` is the available pool; `active_party` is the current group.** The two arrays can diverge (a player may have 10 characters in the roster, 4 actively adventuring). At seed time they typically match.
- **Per-character data lives in [Character](character.md).** Equipment, inventory bags, stats, level — none of that is here anymore. Party only carries party-wide concerns.
- **Singleton vs. per-module seed.** This file is the *default* seed at the data-model layer. Per the architecture plan, each module ships its own starting party at `modules/<id>/party.json`. The v2 module-loading layer will determine precedence; the data shape is the same either way.
- **`Item.name` cross-reference in the shared `inventory`.** Same convention as elsewhere in v2 until the inventory references switch to id-based.
