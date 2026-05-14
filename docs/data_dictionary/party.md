# Party

## Purpose

The starting party seed: where the party spawns on the world map, how much gold they have, who's in the roster, who's currently active, what gear they're carrying, the party-wide effect slots, the shared inventory, and a few step-counter resources (torch, Galadriel's Light).

This is a **singleton** — one Party record per module — not a collection. At runtime the file is consulted only on a fresh start; live game state is loaded from a save (a serialized [Game](game.md)).

Ported from v1's `data/party.json` (see `_v1_reference/docs/data_dictionary/party.json.md`).

## Location

`data_model/party.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

A flat singleton object — no `parties` collection, the whole file is one Party record.

```json
{
  "_comment": "...",
  "start_position": { "col": ..., "row": ... },
  "gold": ...,
  "roster": [ <character_record>, ... ],
  "active_party": [ ...indices into roster ],
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
| `roster` | object[] | yes | All available members (see *roster entry* below) | TBD |
| `active_party` | int[] | yes | Indices into `roster` for the four currently active members | TBD |
| `party_effects` | object | yes | Up to four named active Effect slots; values are Effect ids or null | TBD |
| `inventory` | object[] | yes | Shared party stash (see *inventory entry* below) | TBD |
| `torch_steps` | int | yes | Remaining lit-torch steps | TBD |
| `galadriels_light_steps` | int | yes | Elven Light remaining steps | TBD |

## `roster[]` entry

| Field | Type | Description |
|---|---|---|
| `name` | string | Character name |
| `class` | string | Class display name (matches a [Character Class](character_class.md) `name`) |
| `race` | string | Race display name (matches a [Race](race.md) `name`, case-insensitive) |
| `gender` | string | `"Male"` / `"Female"` — cosmetic on the character sheet |
| `level` | int | Character level |
| `exp` | int | Cumulative XP |
| `hp` | int | Current HP (also seeds `maxHp`) |
| `mp` | int | Current MP (also seeds `maxMp`) |
| `strength` | int | Post-race STR |
| `dexterity` | int | Post-race DEX |
| `constitution` | int | Post-race CON |
| `intelligence` | int | Post-race INT |
| `wisdom` | int | Post-race WIS |
| `equipped` | object | Equipment slot map: `right_hand`, `body` (legacy `left_hand`/`head` dropped — see Notes) |
| `inventory` | object[] | Per-member bag (same shape as the shared party `inventory`) |
| `sprite` | string | PNG path under `web/public/assets/...` |

## `inventory[]` entry (shared and per-member both use this shape)

| Field | Type | Description |
|---|---|---|
| `item` | string | Item name from [Item](item.md) |
| `charges` | int (optional) | For consumables and ammo |
| `durability` | int (optional) | For gear with wear |

## `party_effects` sub-object

Four named slots. Each value is an [Effect](effect.md) id or `null`.

| Field | Type | Description |
|---|---|---|
| `effect_1` | string \| null | First active effect id |
| `effect_2` | string \| null | Second active effect id |
| `effect_3` | string \| null | Third active effect id |
| `effect_4` | string \| null | Fourth active effect id |

## Cross-references to other models

- `roster[].class` → [Character Class](character_class.md)
- `roster[].race` → [Race](race.md)
- `roster[].equipped.*` and `inventory[].item` strings → [Item](item.md) by name
- `party_effects.effect_1..4` → [Effect](effect.md) ids

## Example record (truncated to one member)

```json
{
  "start_position": { "col": 14, "row": 16 },
  "gold": 50,
  "roster": [
    {
      "name": "Aldric",
      "class": "Fighter",
      "race": "Human",
      "gender": "Male",
      "level": 1,
      "exp": 0,
      "hp": 16,
      "mp": 0,
      "strength": 16,
      "dexterity": 11,
      "constitution": 12,
      "intelligence": 8,
      "wisdom": 8,
      "equipped": { "right_hand": "Club", "body": "Cloth" },
      "inventory": [],
      "sprite": "characters/fighter.png"
    }
  ],
  "active_party": [0],
  "party_effects": { "effect_1": null, "effect_2": null, "effect_3": null, "effect_4": null },
  "inventory": [
    { "item": "Torch", "charges": 1 }
  ],
  "torch_steps": 0,
  "galadriels_light_steps": 0
}
```

## Notes and open questions

- **Dropped from v1:** `equipped.left_hand` and `equipped.head` — legacy slots that v1's loader silently migrated back to inventory. The PartyScene UI only surfaced `right_hand` and `body`. If those slots come back, re-introduce here.
- **`gender` kept despite being unread in v1's TS.** Useful for the character sheet display in v2. If the v2 character creator goes gender-neutral, drop.
- **Singleton vs. per-module seed.** This file is the *default* seed at the data-model layer. Per the architecture plan, each module ships its own starting party at `modules/<id>/party.json`. The v2 module-loading layer will determine precedence.
- **`magic_light_steps` and `last_tinker_day` were absent from v1's seed** — they appear only after gameplay populates them. Worth seeding them as `0` once we know how the runtime exposes "no value" vs. "zero."
- **`Item.name` is the cross-reference, not `Item.id`** — same convention as elsewhere in v2.
- **Sprite paths in v1's seed were dead** (`src/assets/game/...` failed the loader's prefix check and fell through to class defaults). v2 normalizes to relative-from-assets paths (`characters/fighter.png`). Whether the new paths resolve depends on where the asset pipeline lands.
