# Quest

## Purpose

An authored adventure thread — a named sequence of objectives the party works through. Each Quest record names the quest, names the NPC that offers and accepts it (`quest_giver`), describes the reward block on completion (`rewards`), and embeds its [Quest Step](quest_step.md) records inline under `steps[]`.

This model supersedes the older `quest_config.md` placeholder, which was a TBD stub for the same concept.

## Location

`web/public/modules/default/quests.json` — real data drives the schema. Catalog ships empty; adventures populate it.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — fields beyond the ones below are open.

## File shape

```
{
  "_comment": "optional authoring notes",
  "quests": [ <quest_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"the_lost_amulet"`) | TBD |
| `name` | string | yes | Display name shown in the quest log | TBD |
| `description` | string | no | Flavor text / quest-log summary | TBD |
| `tags` | string[] | no | Editor-side organizational labels (e.g. `["main_story"]`, `["side", "temple_arc"]`). Purely for grouping in the browse view — gameplay doesn't read them. | TBD |
| `quest_giver` | object | no | The NPC the player talks to in order to *offer* the quest (start dialog) and to *complete* it (end dialog). See *quest_giver shape* below. | TBD |
| `rewards` | object | no | What the party gets on completion. See *rewards shape* below. | TBD |
| `steps` | object[] | yes | Ordered list of inline [Quest Step](quest_step.md) records; the party completes them in order. | TBD |

## `quest_giver` shape

A single inline object describing the NPC. The same NPC handles both the offer (start_dialog) and the completion handoff (end_dialog) — different speakers per stage aren't modelled today.

| Field | Type | Required | Description |
|---|---|---|---|
| `npc_name` | string | yes | Display name shown above the dialog box (e.g. `"Old Hermit"`). |
| `npc_sprite` | string | yes | Sprite path under `web/public/sprites/` (e.g. `"person/hobbit2.png"`). Same convention as Character `sprite`. |
| `start_dialog` | string | yes | The dialog shown when the player first talks to the NPC, offering the quest. |
| `end_dialog` | string | yes | The dialog shown when the player returns after completing the final step, accepting the completion. |

## `rewards` shape

A bag of optional rewards applied atomically when the player accepts the `end_dialog`. Any subset may be present; missing fields mean "no reward of that kind."

| Field | Type | Description |
|---|---|---|
| `xp` | int | XP added to every active party member. |
| `gold` | int | Gold added to the party stash. |
| `items` | string[] | [Item](item.md) ids handed to the party. Duplicates drop multiple copies. |
| `tile_remove` | object[] | Cells to clear. Each entry is `{ map, col, row }` — the cell at (col,row) on the named [Map](map.md) reverts to its baseline tile. Useful for removing a quest blocker (e.g. a locked door) on completion. |
| `tile_add` | object[] | Cells to place a tile on. Each entry is `{ map, col, row, tile_id }` — sets the cell at (col,row) on the named [Map](map.md) to the given [Map Tile](map_tile.md) `id`. Useful for revealing a treasure, opening a passage, swapping a door type, etc. |

If a `tile_remove` and a `tile_add` target the same cell on the same map, the runtime processes remove first then add — effectively a swap.

## Cross-references to other models

- `quest_giver.npc_sprite` → sprite asset under `web/public/sprites/person/`.
- `rewards.items[]` → [Item](item.md) ids.
- `rewards.tile_remove[].map` / `rewards.tile_add[].map` → [Map](map.md) ids.
- `rewards.tile_add[].tile_id` → [Map Tile](map_tile.md) `id`.
- `steps[].params` may reference Monsters, Items, Maps, or NPCs by id depending on the step's `kind` — see [Quest Step](quest_step.md).
- Future: referenced *by* [NPC](npc.md) records (NPCs that offer or react to specific quests) and [Map Tile](map_tile.md) cells with `quest: "<quest_id>"` for trigger tiles.

## Example record

```json
{
  "id": "the_lost_amulet",
  "name": "The Lost Amulet",
  "description": "An old hermit asks the party to retrieve a family heirloom from the crypt where his ancestors are buried.",
  "tags": ["side", "temple_arc"],
  "quest_giver": {
    "npc_name": "Old Hermit",
    "npc_sprite": "person/hobbit2.png",
    "start_dialog": "Greetings, traveler. A family heirloom of mine lies in the crypt east of town. Would you retrieve it for me?",
    "end_dialog": "You have my amulet! Bless you, hero. Take this for your trouble."
  },
  "rewards": {
    "xp": 100,
    "gold": 50,
    "items": ["healing_potion", "healing_potion"],
    "tile_remove": [
      { "map": "town_one_square", "col": 5, "row": 3 }
    ],
    "tile_add": [
      { "map": "town_one_square", "col": 5, "row": 3, "tile_id": "open_door" }
    ]
  },
  "steps": [
    {
      "id": "lost_amulet_talk_to_hermit",
      "name": "Talk to the hermit",
      "kind": "talk",
      "params": { "npc_id": "old_hermit" }
    },
    {
      "id": "lost_amulet_recover_amulet",
      "name": "Recover the amulet",
      "kind": "fetch",
      "params": { "item_id": "hermit_amulet", "count": 1 }
    },
    {
      "id": "lost_amulet_return_to_hermit",
      "name": "Return to the hermit",
      "kind": "talk",
      "params": { "npc_id": "old_hermit" }
    }
  ]
}
```

## Notes and open questions

- **Steps are inline, not a separate catalog.** Same rationale as Dungeon Levels: no other record references steps by global id.
- **Quest giver is one NPC for both stages.** If a future quest needs different speakers for offer vs. completion (e.g. you talk to NPC A to start, deliver to NPC B to finish), the natural evolution is `start_giver` / `end_giver` blocks or moving the dialogs onto the relevant `steps[]` entries.
- **Rewards are applied atomically on completion.** All of `xp`, `gold`, `items`, `tile_remove`, `tile_add` fire together when the `end_dialog` is accepted. Partial-completion rewards (e.g. "the first step pays you 20 gold") aren't modelled — those'd be `rewards` on individual `steps[]` entries instead.
- **`tile_add.tile_id` references a Map Tile id, not a tile-palette item.** It's whatever value the runtime cell-painter uses to identify a tile type in `map_tiles.json`.
- **Stub schema.** Likely future additions: starter trigger gating (which level / quest needs to be complete first), repeatable vs. one-shot, alternative completion paths, fail conditions.
