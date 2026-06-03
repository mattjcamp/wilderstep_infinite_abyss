# Dungeon

## Purpose

A **procedurally generated** multi-level dungeon. A Dungeon record holds the *defaults* the runtime generator uses (style, difficulty, size, torch density, locked-door probability) plus an ordered list of inline [Dungeon Level](dungeon_level.md) records under `levels[]`. Each Level can override any of the parent's parameters for floor-by-floor variation; an omitted/null field on a Level inherits the parent's value.

There is no authored tile data on Dungeons — the runtime generator produces each floor at play time from these parameters. This supersedes the older "authored multi-level dungeon" framing and the separate `Dungeon Config` placeholder.

## Location

`web/public/modules/default/dungeons.json` — real data drives the schema. Catalog ships empty in the seed module; adventures populate it.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — fields beyond the ones below are open, and the procedural generator that consumes them hasn't been written yet.

## File shape

```
{
  "_comment": "optional authoring notes",
  "dungeons": [ <dungeon_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"crypt_of_dagorn"`) | TBD |
| `name` | string | yes | Display name shown when the party enters | TBD |
| `description` | string | no | Flavor text shown on entry or in a quest log | TBD |
| `tags` | string[] | no | Editor-side organizational labels (e.g. `["main_story", "act_1"]`). Same convention as [Map](map.md) `tags`; gameplay doesn't read them. | TBD |
| `style` | string | yes | Visual / thematic family the generator uses to pick a tile palette and decor. Closed enum: `"caves"`, `"ruins"`, `"forest"`, `"custom"`. `"custom"` carves an ordinary rooms-and-corridors dungeon but paints the floor and walls with two author-chosen [Map Tile](map_tile.md) palette entries (see `custom_floor` / `custom_wall`). | TBD |
| `difficulty` | string | yes | Difficulty tier. Same enum as [Monster](monster.md) `difficulty`: `"easy"`, `"normal"`, `"hard"`, `"deadly"`, `"boss"`. Drives the encounter pool the generator samples from. | TBD |
| `size` | `{ width: int, height: int }` | yes | Tile dimensions for each generated floor (default; per-level overrides allowed). | TBD |
| `torch_density` | number (0–1) | yes | Probability that an eligible wall tile carries a torch. `0` = pitch dark, `1` = every wall lit. Drives ambient brightness. | TBD |
| `locked_doors` | number (0–1) | yes | Probability that an interior door is locked. Pairs with the Thief / Ranger Pick Locks ability and the Knock spell. Only doors that `doors` actually placed can be locked, so a low `doors` value caps how many locks can appear. | TBD |
| `doors` | number (0–1) | no | Probability that each eligible room opening gets a door. Defaults to `1` (doors always — the historical behaviour, so existing dungeons are unchanged). `0` leaves an open layout with no doorframes (e.g. a doorless forest); in-between rolls per opening. Applies to every style. | TBD |
| `edge_transitions` | boolean | no | Where the floor's entrance + exit transitions are placed: `true` = at the map **edge** (carving a short trail inward, the forest look), `false` = in the **interior rooms** (the caves/ruins look). Applies to every style. Absent → the style default (`true` only for `"forest"`), so existing dungeons keep their placement. The edge tile is the forest archway for `"forest"` and a regular stair tile otherwise (so `custom_stairs_*` overrides still apply). | TBD |
| `custom_floor` | string | no | When `style` is `"custom"`, the [Map Tile](map_tile.md) palette id whose sprite paints every walkable floor cell. The floor is **forced** walkable + non-sight-blocking regardless of the tile's own flags. Ignored for other styles. An unresolved id falls back to the stone-dungeon floor sprite. | TBD |
| `custom_wall` | string | no | When `style` is `"custom"`, the [Map Tile](map_tile.md) palette id whose sprite paints every wall cell. The wall is **forced** non-walkable + sight-blocking (guaranteeing a solvable, occlusion-correct layout) regardless of the tile's own flags. Ignored for other styles. Unresolved ids fall back to the stone-dungeon wall sprite. | TBD |
| `custom_stairs_up` | string | no | When `style` is `"custom"`, the [Map Tile](map_tile.md) palette id whose sprite paints the **up** floor-transition cell (the way back / up). Purely cosmetic — the transition link and walkability are unchanged. Empty / unresolved keeps the default stairs-up sprite (which can look out of place against a custom floor). Ignored for other styles. | TBD |
| `custom_stairs_down` | string | no | When `style` is `"custom"`, the [Map Tile](map_tile.md) palette id whose sprite paints the **down** floor-transition cell (deeper / out). Cosmetic only. Empty / unresolved keeps the default stairs-down sprite. Ignored for other styles. | TBD |
| `loot` | `{ chest_item?: string, chest_frequency?: number }` | no | Procedural loot chests. `chest_item` is the id of an item authored with `is_chest: true` (its `contents` are what the party finds on open); `chest_frequency` (0–1) is the per-room chance a chest is placed. **Chests are opt-in** — with no `loot.chest_item`, no chests generate. When an item is set but `chest_frequency` is omitted it defaults to `0.5`. | TBD |
| `levels` | object[] | yes | Ordered list of inline [Dungeon Level](dungeon_level.md) records; index 0 is the entrance floor, deeper floors follow. Each Level may override any of the parent's parameters for floor-by-floor variation. | TBD |

## Inheritance into Levels

Every Level inherits its parent Dungeon's parameter values by default. A Level may set any subset of `style`, `difficulty`, `size`, `torch_density`, `locked_doors`, `doors`, `edge_transitions`, `custom_floor`, `custom_wall`, `custom_stairs_up`, `custom_stairs_down`, `loot` to override per floor. `loot` merges field-by-field — a Level that sets only `loot.chest_frequency` keeps the parent's `chest_item`. A Level can opt out of chests on one floor with `loot: { chest_item: "" }`. Examples of why you'd override:

- The final floor is a `"boss"` difficulty floor inside an otherwise `"hard"` dungeon.
- A side wing changes `style` from `"caves"` to `"ruins"` for one floor.
- The bottom floor has `torch_density: 0` for the climactic dark encounter.
- The treasury floor sets `locked_doors: 1` so every door is locked.
- A surface "forest" floor sets `doors: 0` so its archways aren't blocked by doorframes, while deeper floors keep the default.
- A `"custom"` dungeon overrides `custom_wall` on one floor to swap a hedge wall for a stone wall mid-descent.
- The deepest floor sets a richer `loot.chest_item` (or a higher `chest_frequency`) than the upper floors.

An undefined / missing field on a Level means "use the Dungeon's value" — there's no separate `inherited: true` marker.

## Cross-references to other models

- `difficulty` shares the [Monster](monster.md) `difficulty` enum.
- Referenced *by* [Map Tile](map_tile.md) — a cell with `dungeon: "<dungeon_id>"` is a dungeon-entrance trigger on a normal Map (entering kicks off generation of `levels[0]`).
- The generator will sample from [Encounter](encounter.md), [Spawn](spawn.md), and [Item](item.md) pools at runtime, gated by `difficulty` and (eventually) `style`.

## Example record

```json
{
  "id": "crypt_of_dagorn",
  "name": "Crypt of Dagorn",
  "description": "An ancient burial vault sealed against the rising tide of undeath.",
  "tags": ["main_story", "act_1"],
  "style": "caves",
  "difficulty": "hard",
  "size": { "width": 32, "height": 32 },
  "torch_density": 0.15,
  "locked_doors": 0.3,
  "levels": [
    {
      "id": "crypt_of_dagorn_l1",
      "name": "Tomb Hall",
      "depth": 1
    },
    {
      "id": "crypt_of_dagorn_l2",
      "name": "Vault Approach",
      "depth": 2,
      "size": { "width": 40, "height": 40 },
      "locked_doors": 0.5
    },
    {
      "id": "crypt_of_dagorn_l3",
      "name": "The Inner Vault",
      "depth": 3,
      "difficulty": "deadly",
      "torch_density": 0.0
    }
  ]
}
```

In this example, L1 inherits everything from the parent; L2 overrides size + locked_doors; L3 overrides difficulty + torch_density (and is pitch-dark).

## Notes and open questions

- **Procedural, not authored.** Earlier drafts framed Dungeons as hand-painted multi-floor maps. The model pivoted to procedural generation; the previous [Dungeon Config](dungeon_config.md) model is now superseded by this one.
- **Levels are inline, not a separate catalog.** No other record references a Dungeon Level by global id, so the children live as inline objects under their parent.
- **`style` is a closed enum today.** Values are `"caves"`, `"ruins"`, `"forest"`, `"custom"`. Add new values here (and in `DungeonsBrowse`'s dropdown) when the generator gains support for additional themes. `"custom"` is the author-driven escape hatch: rather than a fixed palette, it renders the floor/wall from the two `map_tiles` ids in `custom_floor` / `custom_wall`, and (optionally) the up/down transitions from `custom_stairs_up` / `custom_stairs_down` — doors and chests keep their default art. Floor/wall walkability and sight-blocking are forced by the generator, so a custom dungeon is always solvable regardless of the chosen tiles' own flags; the transition tiles are cosmetic and leave the stair link untouched.
- **`size` is fixed per generation.** No min/max range yet — every level either uses the inherited size or sets its own. Adding `{ min_width, max_width, ... }` for "random within a range" is a natural future extension.
- **`difficulty: "boss"` is the boss-floor convention.** Matches Monster's note that `"boss"` is intentionally outside the random-encounter pool. A Level overriding to `"boss"` flags it as the final floor for generator/UI purposes.
- **Schema is a stub.** Likely future additions: per-dungeon encounter table overrides, loot multiplier, scripted-event hooks for specific levels, seed/RNG knob.
