# Quest Step

## Purpose

One objective inside a [Quest](quest.md). A Quest Step describes a single task the party has to complete — kill a monster, fetch an item, visit a tile, talk to an NPC — and lives as an inline object inside its parent Quest's `steps[]` array.

Quest Steps are not a top-level catalog; they have no meaning outside the Quest that owns them.

## Location

Inline under [Quest](quest.md) records in `web/public/modules/default/quests.json`. The `quest_steps.json` file is a deprecated stub kept empty so old fetches don't 404.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — the `kind` enum is open, and `params` shape per kind is also TBD.

## Inline shape

Each entry in a parent Quest's `steps[]` is an object with the fields below.

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"lost_amulet_enter_crypt"`). Unique within the parent Quest's `steps[]` — there is no global Quest Step catalog, so the id only needs to disambiguate among siblings. Convention: `<quest_id>_<step_slug>`. | TBD |
| `name` | string | yes | Display name shown in the quest log for this step (e.g. `"Enter the crypt"`) | TBD |
| `tags` | string[] | no | Editor-side organizational labels. Optional; gameplay doesn't read them. | TBD |
| `kind` | string | yes | Discriminator for what the step is. See *kind values* below. | TBD |
| `description` | string | no | Player-facing detail / tooltip text | TBD |
| `params` | object | no | Kind-specific parameters (encounter id to clear, item id to fetch, map cell to visit, …). Shape depends on `kind`. | TBD |

## `kind` values

Open-ended enum. Anticipated values:

| Value | Meaning | Likely `params` |
|---|---|---|
| `"kill"` | Clear a specific encounter the listed number of times | `{ "encounter_id": "...", "count": 1 }` |
| `"fetch"` | Obtain an item and bring it back | `{ "item_id": "...", "count": 1 }` |
| `"visit"` | Step on a specific map cell | `{ "map_id": "...", "col": 0, "row": 0 }` |
| `"talk"` | Talk to a specific NPC | `{ "npc_id": "..." }` |

Add new kinds as needed; the runtime branches on `kind` for completion-check logic.

## Cross-references to other models

- Owned *by* [Quest](quest.md) `steps[]` (inline, not by reference)
- `params` keys reference other models depending on `kind` (Monster, Item, Map, NPC ids) — those refs use the same id conventions as the rest of v2

## Example record (inline under a Quest)

```json
{
  "id": "lost_amulet_enter_crypt",
  "name": "Enter the crypt",
  "kind": "visit",
  "description": "The hermit's family crypt is east of the village.",
  "params": { "map_id": "crypt_of_dagorn_l1_map", "col": 8, "row": 4 }
}
```

## Notes and open questions

- **Inline, not a separate catalog.** An earlier pass stored Quest Steps in their own `quest_steps.json` catalog. The model collapsed to inline objects because steps have no meaning outside their owning Quest. The standalone catalog file is deprecated.
- **Schema is a stub.** `kind` enum and `params` shapes are placeholder. Real values will solidify when the quest-completion runtime is implemented.
- **Step state is not in this record.** Whether a step is completed lives in the runtime [Game](game.md) save, not here. The Quest Step record is the *definition*; the in-progress state is per-playthrough.
- **Branching/parallel objectives** would need explicit prerequisite ids on the step (or moved to the Quest's structure). Today the Quest's `steps[]` is a strict linear ordering.
