# Counter

## Purpose

The shops and temples encountered behind town counter tiles. Each counter has an id, name, description, and either a stock list (regular shops like the weapons / armor / general store) or a service menu (temples — heal, restore MP, cure poisons, raise dead).

In v1, the `general`, `weapon`, and `armor` counters' `items` arrays also doubled as the post-combat loot pool. If v2 keeps that double-duty, document it explicitly when the loot path is wired up.

Ported from v1's `data/counters.json` (see `_v1_reference/docs/data_dictionary/counters.json.md`).

## Location

`data_model/counters.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "counters": [ <counter_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Counter identifier (e.g. `"general"`, `"weapon"`, `"healing"`). Referenced by NPC shopType fields and by tile `interaction_data` for `interaction_type: "shop"`. | TBD |
| `name` | string | yes | Display label shown as the shop UI title | TBD |
| `description` | string | no | Flavor text shown under the title | TBD |
| `items` | string[] | yes | Stock list — each entry is an Item `name`. Duplicates control stocking weight. Empty for service-only counters. | TBD |
| `kind` | string | no | `"service"` for temple-style counters; omitted/null for regular shops | TBD |
| `services` | object[] | no | Service menu entries (present when `kind === "service"`); see *services entry* below | TBD |

## `services[]` entry

| Field | Type | Description |
|---|---|---|
| `id` | string | Service handler id (`"heal_all_hp"`, `"restore_all_mp"`, `"cure_all_poisons"`, `"raise_dead"`) |
| `name` | string | Display label |
| `description` | string | Tooltip / description text |
| `cost` | int | Gold cost |

## Polymorphic discriminator

`kind` discriminates between regular shop (omitted) and service counter (`"service"`). Regular shops use the `items` stock list; service counters use the `services` menu. The two coexist on a single schema rather than being separate types.

## Cross-references to other models

- `items[]` strings → [Item](item.md) names — the shop's stock and (in v1) the post-combat loot pool
- Counter ids are referenced from [Map Tile](map_tile.md) — tiles with `interaction_type: "shop"` carry the counter id as `interaction_data`
- Will be referenced by [NPC](npc.md) records once that model is filled in (v1 had a `shopType` field linking NPC dialogs to counters)
- `services[].id` strings are looked up in code, not data — the runtime branches on the known set (`heal_all_hp`, `restore_all_mp`, `cure_all_poisons`, `raise_dead`)

## Example record (service counter)

```json
{
  "id": "healing",
  "name": "Healing Counter",
  "description": "A temple healer who mends flesh, restores the arcane, purges poison, and — for a price — returns the dead to life.",
  "items": [],
  "kind": "service",
  "services": [
    { "id": "heal_all_hp",      "name": "Heal All HP",      "description": "Restore every living member to full hit points.",      "cost": 100 },
    { "id": "restore_all_mp",   "name": "Restore All MP",   "description": "Refill every living member's magic points.",            "cost": 75 },
    { "id": "cure_all_poisons", "name": "Cure All Poisons", "description": "Cleanse poison from every party member.",               "cost": 50 },
    { "id": "raise_dead",       "name": "Raise Dead",       "description": "Return a fallen ally to full health. Costly miracle.", "cost": 1000 }
  ]
}
```

## Notes and open questions

- **Stock duplicates are the stocking mechanism.** Buying removes one entry from the live stock array, so `["Sword", "Sword", "Mace"]` means two Swords and one Mace in stock.
- **Loot pool double-duty.** In v1, the `general`, `weapon`, and `armor` counters' item lists were the source of the post-combat drop pool. The other counters were excluded. If v2 keeps that contract, document it on the Counter model or split out an explicit `Loot` model.
- **`services[].id` is a string discriminator with hardcoded handlers.** Unknown ids fall through politely in v1. If v2 makes service behavior more declarative, this is the wiring point.
- **`Item.name` is the cross-reference, not `Item.id`** — same convention as elsewhere in v2 until items move to id-keyed references.
