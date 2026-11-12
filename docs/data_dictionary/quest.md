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
| `main_quest` | bool | no | Marks the module's main quest. The player's quest log pins it to a MAIN QUEST section at the top (while active or ready to turn in) and shows it expanded; other quests start collapsed. At most one per module — the editor clears the flag elsewhere when it's set. | Yes |
| `return_to_giver` | bool | no | Default **false**: the quest is turned in automatically — rewards granted, "quest complete" fires — the moment its last step completes. When **true**, the completed quest waits until the party talks to the giver again (who then shows `end_dialog`). | Yes |
| `start_triggers` | object[] | no | Events that start the quest automatically, with no giver conversation. See *Automatic start triggers* below. | Yes |
| `boards` | string[] | no | Notice-board ids the quest is posted on. See *Notice boards* below. | Yes |
| `tags` | string[] | no | Editor-side organizational labels (e.g. `["main_story"]`, `["side", "temple_arc"]`). Purely for grouping in the browse view — gameplay doesn't read them. | TBD |
| `quest_giver` | object | no | The NPC the player talks to in order to *offer* the quest (start dialog) and to *complete* it (end dialog). See *quest_giver shape* below. | TBD |
| `rewards` | object | no | What the party gets on completion. See *rewards shape* below. | TBD |
| `steps` | object[] | yes | Ordered list of inline [Quest Step](quest_step.md) records; the party completes them in order. | TBD |

## `quest_giver` shape

A single inline object describing the NPC. The same NPC handles both the offer (start_dialog) and the completion handoff (end_dialog) — different speakers per stage aren't modelled today.

| Field | Type | Required | Description |
|---|---|---|---|
| `npc_name` | string | yes | Display name shown above the dialog box (e.g. `"Old Hermit"`). |
| `npc_sprite` | string | yes | Sprite path relative to a module's `sprites/` folder (base art: `web/public/modules/default/sprites/`) (e.g. `"person/hobbit2.png"`). Same convention as Character `sprite`. |
| `start_dialog` | string | yes | The dialog shown when the player first talks to the NPC, offering the quest. |
| `end_dialog` | string | yes | The dialog shown when the player returns after completing the final step, accepting the completion. |
| `post_dialog` | string | no | Chatter shown when the player bumps the giver AFTER the quest is turned in — the giver behaves like a normal NPC from then on (standard NPC dialog, no quest overlay). Falls back to a generic "thanks again" line when absent. |

## `rewards` shape

A bag of optional rewards applied atomically when the player accepts the `end_dialog`. Any subset may be present; missing fields mean "no reward of that kind."

| Field | Type | Description |
|---|---|---|
| `xp` | int | XP added to every active party member. |
| `gold` | int | Gold added to the party stash. |
| `items` | string[] | [Item](item.md) ids handed to the party. Duplicates drop multiple copies. |
| `tile_remove` | object[] | Cells to clear. Each entry is `{ map, col, row }` — the cell at (col,row) on the named [Map](map.md) reverts to its baseline tile. Useful for removing a quest blocker (e.g. a locked door) on completion. |
| `tile_add` | object[] | Cells to place a tile on. Each entry is `{ map, col, row, tile_id }` — sets the cell at (col,row) on the named [Map](map.md) to the given [Map Tile](map_tile.md) `id`. Useful for revealing a treasure, opening a passage, swapping a door type, etc. |
| `travel` | object | The giver sends the party somewhere. `{ map, col, row, message? }` — after the other rewards land, an announcement placard names the giver and the destination [Map](map.md), shows the optional `message` (a line from the giver), and moves the party to (col,row) on that map when the player clicks **Travel**. See *Travel rewards* below. |

If a `tile_remove` and a `tile_add` target the same cell on the same map, the runtime processes remove first then add — effectively a swap.

## Travel rewards

A `travel` reward is how a quest unlocks a place the party can't otherwise reach: author a map with **no link tiles leading into it**, and let the quest giver send the party there as a reward ("Take this chart — it leads to the Sunken Vault").

```json
"rewards": {
  "xp": 50,
  "travel": {
    "map": "sunken_vault",
    "col": 4,
    "row": 9,
    "message": "Take this chart. It leads to the Sunken Vault — no road goes there."
  }
}
```

- **When it fires.** At turn-in, after XP / gold / items / tile changes are applied, so the party arrives already paid. The same block is also allowed on a step's `rewards` (fires the moment that step completes) — see [Quest Step](quest_step.md#step-rewards).
- **The player's side.** A gold "Quest Reward" placard names the destination (map `name` + `description`), quotes the `message` attributed to the quest giver, and offers **Travel** (Enter) and **Later** (Esc). It waits until any open dialog, shop, or combat has closed.
- **Coming back later.** **Later** puts the placard down without losing the trip: a gold **⚜ Travel to …** button stays at the bottom of the play screen until the party goes, and for a turn-in reward, talking to the quest giver offers the trip again. The trip is never dropped, so a hidden map is always still reachable. A newer travel reward replaces a put-off one.
- **Survives reloads.** The pending trip is stored in the save (`pendingTravel`, with `deferred: true` once the player chose Later) until the player takes it, so closing the tab with the placard up re-shows it on the next load, and a put-off trip keeps its Travel button. A hidden map is never lost.
- **How the party moves.** Exactly like walking through a link tile: the current map's state, fog of war, and the clock are saved, then the destination map loads. If the party is inside a generated dungeon it leaves it first (the dungeon's state is saved, as if they'd taken the top stairs out). The party always arrives on foot.
- **Give the hidden map a way back.** The runtime doesn't add a return trip. Put a link tile on the destination map (or send them home with a later quest's `travel`). The quest editor warns when the chosen map has no link tiles leading out, and labels maps nothing links to as "hidden".
- **Bad destinations.** An unknown map id, or a cell outside the map, is logged as an authoring error and the trip is dropped instead of loading a broken map. The editor flags both while you author.
- **One at a time.** If a final step's `travel` and the quest's `travel` fire together, the quest-level one wins.

## How a quest starts

A quest can begin three ways; any combination may be authored on one quest, and whichever happens first starts it. A started quest is never restarted.

1. **Quest giver** — a map cell with `quest: "<id>"`. Bumping it opens the offer dialog (Accept / Decline).
2. **Automatic** — an event in `start_triggers` happens. No dialog: the quest starts and the player is notified.
3. **Notice board** — the quest is listed on a board in `boards`, and the player picks it.

Quests started the second or third way don't need a `quest_giver`. If `return_to_giver` is on, though, they do — otherwise there's no one to turn the quest in to (the editor warns).

## Automatic start triggers

```json
"start_triggers": [
  { "kind": "game_start", "message": "A dream of drowned bells wakes you." },
  { "kind": "enter_map",  "map_id": "hallowmere" },
  { "kind": "leave_map",  "map_id": "hallowmere" },
  { "kind": "read_lore",  "lore_id": "letter_from_the_abbot",
    "message": "The abbot begs for help at the ruined shrine." }
]
```

| `kind` | Needs | Fires when |
|---|---|---|
| `game_start` | — | A new game begins. Also fires the first time an existing save is loaded after this quest was added to the module. |
| `enter_map` | `map_id` | The party arrives on the map — through a link, a quest `travel`, or by walking out of a generated dungeon onto it. Loading a save that's already on the map counts too. |
| `leave_map` | `map_id` | The party departs the map — through a link, a quest `travel`, or by going down into a generated dungeon. |
| `read_lore` | `lore_id` | The party reads that [Lore](lore.md) — a map object or a book item. Any read counts, not only the first. The quest starts when the reading screen closes. |

`message` (optional) is the line on the **New Quest** notification and in the log; without it the notification shows the first step. Floor changes inside a generated dungeon don't fire map triggers. A trigger with an unknown `kind`, or missing the id its kind needs, is ignored.

## Notice boards

A notice board is a map cell with `board: "<board_id>"` (Map Editor → Board). A quest is posted on it by listing the same id in `boards`:

```json
"boards": ["hallowmere_board"]
```

Bumping the board opens a list of every quest posted there that the party hasn't taken yet — name, description, "Posted by" (the `quest_giver.npc_name`, if any), the first step, and XP / gold. **Take** (or Enter) starts the quest with the usual New Quest notification; the board stays open so more can be taken. Taken quests drop off the board. One quest may be posted on several boards, and several cells may share one board id.

## Cross-references to other models

- `quest_giver.npc_sprite` → sprite asset under a module's `sprites/person/` (base art: `web/public/modules/default/sprites/person/`).
- `rewards.items[]` → [Item](item.md) ids.
- `rewards.tile_remove[].map` / `rewards.tile_add[].map` → [Map](map.md) ids.
- `rewards.travel.map` → [Map](map.md) id.
- `rewards.tile_add[].tile_id` → [Map Tile](map_tile.md) `id`.
- `steps[].params` may reference Monsters, Items, Maps, or NPCs by id depending on the step's `kind` — see [Quest Step](quest_step.md).
- `start_triggers[].map_id` → [Map](map.md) id; `start_triggers[].lore_id` → [Lore](lore.md) id.
- `boards[]` → map cell `board` ids ([Map](map.md)).
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
- **Rewards are applied atomically on completion.** All of `xp`, `gold`, `items`, `tile_remove`, `tile_add` fire together when the `end_dialog` is accepted; a `travel` reward is announced right after and taken when the player clicks Travel. Partial-completion rewards (e.g. "the first step pays you 20 gold") aren't modelled — those'd be `rewards` on individual `steps[]` entries instead.
- **`tile_add.tile_id` references a Map Tile id, not a tile-palette item.** It's whatever value the runtime cell-painter uses to identify a tile type in `map_tiles.json`.
- **Stub schema.** Likely future additions: starter trigger gating (which level / quest needs to be complete first), repeatable vs. one-shot, alternative completion paths, fail conditions.
