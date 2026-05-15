# Quest

## Purpose

An authored adventure thread — a named sequence of objectives the party works through. Each Quest record names the quest and lists its [Quest Step](quest_step.md) records in order. Quest Step records describe what each objective actually *is* (kill a monster, fetch an item, visit a tile, talk to an NPC); the Quest itself just ties them together and gives the player something to read in a quest log.

This model supersedes the older `quest_config.md` placeholder, which was a TBD stub for the same concept.

## Location

`web/public/modules/default/quests.json` — real data drives the schema. Catalog ships empty; adventures populate it.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — fields beyond `id`, `name`, and `steps[]` are open.

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
| `steps` | string[] | yes | Ordered list of [Quest Step](quest_step.md) ids; the party completes them in order. | TBD |

## Cross-references to other models

- `steps[]` → [Quest Step](quest_step.md) ids
- Future: referenced *by* [NPC](npc.md) records (NPCs that offer or react to specific quests) and [Map Tile](map_tile.md) cells with `quest: "<quest_id>"` for trigger tiles

## Example record

```json
{
  "id": "the_lost_amulet",
  "name": "The Lost Amulet",
  "description": "An old hermit asks the party to retrieve a family heirloom from the crypt where his ancestors are buried.",
  "tags": ["side", "temple_arc"],
  "steps": [
    "lost_amulet_talk_to_hermit",
    "lost_amulet_enter_crypt",
    "lost_amulet_recover_amulet",
    "lost_amulet_return_to_hermit"
  ]
}
```

## Notes and open questions

- **Schema is a stub.** Likely future additions: starter trigger (which NPC or tile activates the quest), reward block (XP / gold / items handed to the party on completion), gating flags (requires another quest first, level minimum), repeatable vs. one-shot, parallel-vs-strict-order steps.
- **Linear sequence today.** `steps[]` is treated as a strict order. If branching or parallel-objective quests become a thing, the natural evolution is steps with explicit prerequisite ids rather than a flat array.
