# Quest Step

## Purpose

One objective inside a [Quest](quest.md). A Quest Step describes a single task the party has to complete — kill a monster, fetch an item, visit a tile, talk to an NPC — and is referenced by id from the Quest's `steps[]` array.

## Location

`web/public/modules/default/quest_steps.json` — real data drives the schema. Catalog ships empty; adventures populate it.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — the `kind` enum is open, and `params` shape per kind is also TBD.

## File shape

```
{
  "_comment": "optional authoring notes",
  "quest_steps": [ <step_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"lost_amulet_enter_crypt"`). Convention: `<quest_id>_<step_slug>`. | TBD |
| `name` | string | yes | Display name shown in the quest log for this step (e.g. `"Enter the crypt"`) | TBD |
| `tags` | string[] | no | Editor-side organizational labels. Usually the parent-quest id (so the editor can group all `the_lost_amulet` steps together). Gameplay doesn't read them. | TBD |
| `kind` | string | yes | Discriminator for what the step is. See *kind values* below. | TBD |
| `description` | string | no | Player-facing detail / tooltip text | TBD |
| `params` | object | no | Kind-specific parameters (monster id to kill, item id to fetch, map cell to visit, …). Shape depends on `kind`. | TBD |

## `kind` values

Open-ended enum. Anticipated values:

| Value | Meaning | Likely `params` |
|---|---|---|
| `"kill"` | Kill a specific monster or members of an encounter | `{ "monster_id": "...", "count": 1 }` or `{ "encounter_id": "..." }` |
| `"fetch"` | Obtain an item and bring it back | `{ "item_id": "...", "count": 1 }` |
| `"visit"` | Step on a specific map cell | `{ "map_id": "...", "col": 0, "row": 0 }` |
| `"talk"` | Talk to a specific NPC | `{ "npc_id": "..." }` |

Add new kinds as needed; the runtime branches on `kind` for completion-check logic.

## Cross-references to other models

- Referenced *by* [Quest](quest.md) `steps[]`
- `params` keys reference other models depending on `kind` (Monster, Item, Map, NPC ids) — those refs use the same id conventions as the rest of v2

## Example record

```json
{
  "id": "lost_amulet_enter_crypt",
  "name": "Enter the crypt",
  "tags": ["the_lost_amulet"],
  "kind": "visit",
  "description": "The hermit's family crypt is east of the village.",
  "params": { "map_id": "crypt_of_dagorn_l1_map", "col": 8, "row": 4 }
}
```

## Notes and open questions

- **Schema is a stub.** `kind` enum and `params` shapes are placeholder. Real values will solidify when the quest-completion runtime is implemented.
- **Step state is not in this record.** Whether a step is completed lives in the runtime [Game](game.md) save, not here. The Quest Step record is the *definition*; the in-progress state is per-playthrough.
- **Branching/parallel objectives** would need explicit prerequisite ids on the step (or moved to the Quest's structure). Today the Quest's `steps[]` is a strict linear ordering.
