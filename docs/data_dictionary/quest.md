# Quest

## Purpose

An authored adventure thread — a named sequence of objectives the party works through. Each Quest record names the quest and embeds its [Quest Step](quest_step.md) records inline under `steps[]`. Each step describes what its objective actually *is* (kill a monster, fetch an item, visit a tile, talk to an NPC); the Quest itself just ties them together and gives the player something to read in a quest log.

This model supersedes the older `quest_config.md` placeholder, which was a TBD stub for the same concept.

## Location

`web/public/modules/default/quests.json` — real data drives the schema. Catalog ships empty; adventures populate it.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — fields beyond `id`, `name`, `tags`, and `steps[]` are open.

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
| `tags` | string[] | no | Editor-side organizational labels (e.g. `["main_story"]`, `["side", "temple_arc"]`). Purely for grouping in the browse view — gameplay doesn't read them. Same convention as [Map](map.md) `tags`. | TBD |
| `steps` | object[] | yes | Ordered list of inline [Quest Step](quest_step.md) records; the party completes them in order. | TBD |

## Cross-references to other models

- `steps[].params` may reference Monsters, Items, Maps, or NPCs by id depending on the step's `kind` — see [Quest Step](quest_step.md).
- Future: referenced *by* [NPC](npc.md) records (NPCs that offer or react to specific quests) and [Map Tile](map_tile.md) cells with `quest: "<quest_id>"` for trigger tiles.

## Example record

```json
{
  "id": "the_lost_amulet",
  "name": "The Lost Amulet",
  "description": "An old hermit asks the party to retrieve a family heirloom from the crypt where his ancestors are buried.",
  "tags": ["side", "temple_arc"],
  "steps": [
    {
      "id": "lost_amulet_talk_to_hermit",
      "name": "Talk to the hermit",
      "kind": "talk",
      "params": { "npc_id": "old_hermit" }
    },
    {
      "id": "lost_amulet_enter_crypt",
      "name": "Enter the crypt",
      "kind": "visit",
      "params": { "map_id": "crypt_of_dagorn_l1_map", "col": 8, "row": 4 }
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

- **Steps are inline, not a separate catalog.** Earlier drafts stored Quest Steps in their own `quest_steps.json`; the model collapsed back to inline objects because no other record references steps by id — they exist only as children of their parent Quest. The dictionary entry for [Quest Step](quest_step.md) still documents the inline shape.
- **Schema is a stub.** Likely future additions: starter trigger (which NPC or tile activates the quest), reward block (XP / gold / items handed to the party on completion), gating flags (requires another quest first, level minimum), repeatable vs. one-shot, parallel-vs-strict-order steps.
- **Linear sequence today.** `steps[]` is treated as a strict order. If branching or parallel-objective quests become a thing, the natural evolution is steps with explicit prerequisite ids rather than a flat array.
