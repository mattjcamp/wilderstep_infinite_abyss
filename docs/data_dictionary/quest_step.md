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
| `rewards` | object | no | Per-step rewards applied **immediately** when the step completes (the moment its progress flag flips true). Same shape as the quest-level `rewards` block but narrowed to two keys — `items` and `tile_add`. XP and gold stay on the quest-level rewards so the big numerical payoff still arrives at turn-in. See *Step rewards* below. | yes |
| `positions` | object[] | no | For `kind: "kill"` only — author-anchored cells the spawn pass uses to place the step's encounter copies. Each entry is `{ "col": <int>, "row": <int> }` on the step's `map_id`. Consumed in order: `positions[0]` for the first copy, `positions[1]` for the second, and so on. Copies beyond `positions.length` (and any position whose cell isn't walkable at spawn time) fall back to random walkable selection. Empty / omitted = pure random placement. | yes |

## Step rewards

The optional `rewards` block lets a step grant items or mutate the world the moment the step completes — gating the next step on a map change ("a bridge appears so the party can reach the next dungeon") or seeding inventory the next step needs ("here's the key for the door you're about to find"). Unlike quest-level rewards, which are deferred until the player returns to the giver and turns the quest in, **step rewards apply immediately**.

| Key | Type | Description |
|---|---|---|
| `items` | string[] | Item catalog ids granted to the party on step completion. Merges into existing stacks via the same `addToInventory` path quest-level rewards use. |
| `tile_add` | object[] | Cells on named maps to paint with a named palette tile. Each entry: `{ "map": "<map_id>", "col": <int>, "row": <int>, "tile_id": "<palette_tile_id>" }`. Recorded into `save.maps[<map_id>].tileOverrides` so the mutation survives reload + re-entry. If the affected cell is on the currently-mounted map the live grid + cell sprite update in the same frame the step completes. |

Step rewards are **only** items and tile mutations. XP and gold are not authored at the step level — those stay on the quest-level rewards. Both fields are optional; absent JSON authors as `{ items: [], tile_add: [] }`.

## Kill-step placement (`positions`)

Kill steps spawn `count` copies of the named encounter on the step's map. By default each copy lands on a random walkable cell. To author specific cells, list them under `positions` — the runtime consumes them in order, one per copy.

```json
{
  "id": "ratking_step_1_clear_rats",
  "name": "Clear the rat patrols",
  "kind": "kill",
  "encounter_id": "giant_rat",
  "count": 3,
  "location_kind": "map",
  "map_id": "sewer_map",
  "positions": [
    { "col": 5,  "row": 12 },
    { "col": 8,  "row": 12 },
    { "col": 11, "row": 12 }
  ]
}
```

With this authoring, the three rat encounters appear at the three named cells when the quest is accepted. If only two positions are listed for a count of three, the first two copies land at the authored cells and the third picks a random walkable cell. If an authored cell isn't walkable at spawn time (a wall got painted over it after the quest was authored, or another spawn consumed it first) that copy quietly falls back to random selection too — defensive against the map evolving after the quest was authored.

### Example step with rewards

```json
{
  "id": "amulet_step_2_cross_river",
  "name": "Find a way across the river",
  "kind": "retrieve",
  "params": { "item_id": "river_stone" },
  "rewards": {
    "items": ["lockpick"],
    "tile_add": [
      { "map": "forest_map", "col": 14, "row": 7, "tile_id": "bridge" }
    ]
  }
}
```

After the party picks up the river stone, a Lockpick lands in inventory and a bridge tile is painted at (14, 7) on `forest_map`. The next step can then route the party across that cell.

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
