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
| `style` | string | yes | Visual / thematic family the generator uses to pick a tileset. Closed enum: `"dungeon"`, `"cavern"`. `"dungeon"` carves a rooms-and-corridors layout and paints it with the Dungeon Tileset: flagstone floor, tileset doors and stairs, and **autotiled walls** — each wall picks its piece from its neighbours (brick face above a room, thin side strips beside it, corners / tees where they meet, solid black rock where no room touches). `"cavern"` is the cave counterpart of `"dungeon"`: the same layout with its rock walls roughened by random notches (carve-only, so every path stays open), painted with the Cave Tileset — patchy dirt / gravel / rock / moss floors, cave door and steps, the same autotiled walls (cave pieces), and a sparse scatter of stalagmites and rubble placed only in open floor where they can never block a route. Any other value (including the retired `"caves"`, `"ruins"`, `"forest"`, `"custom"`) renders as `"dungeon"`. | TBD |
| `difficulty` | string | yes | Difficulty tier. Same enum as [Monster](monster.md) `difficulty`: `"easy"`, `"normal"`, `"hard"`, `"deadly"`, `"boss"`. Drives the encounter pool the generator samples from. The tier alone sets each floor's room count, encounter level band, and fight chance — floor depth does **not** ramp it, so a 10-floor `"easy"` dungeon stays easy throughout. To scale a dungeon, set `difficulty` on individual Levels. | TBD |
| `size` | `{ width: int, height: int }` | yes | Tile dimensions for each generated floor (default; per-level overrides allowed). | TBD |
| `torch_density` | number (0–1) | yes | Probability that an eligible wall tile carries a torch. `0` = pitch dark, `1` = every wall lit. Drives ambient brightness. | TBD |
| `locked_doors` | number (0–1) | yes | Probability that an interior door is locked. Pairs with the Thief / Ranger Pick Locks ability and the Knock spell. Only doors that `doors` actually placed can be locked, so a low `doors` value caps how many locks can appear. | TBD |
| `doors` | number (0–1) | no | Probability that each eligible room opening gets a door. Defaults to `1` (doors always — the historical behaviour, so existing dungeons are unchanged). `0` leaves an open layout with no doorframes; in-between rolls per opening. Applies to every style. | TBD |
| `pits` | number (0–1) | no | Probability that each room past the entrance gets a pit (chasm). Defaults to `0` (no pits — existing dungeons are unchanged). A pit is a rectangle (2×2 up to ~60% of the room) or a single-cell hole, drawn with the style's pit rim pieces. Pits block movement but not sight, and are only carved where a full ring of walkable floor surrounds them, so they never cut off a route, stairs, chest or monster. Applies to every style. | TBD |
| `pit_falls` | boolean | no | When `true` (the default), stepping into a pit drops the party to the **floor below**, landing on the nearest open floor cell under the pit, and every conscious member takes 1–4 fall damage (never below 1 HP). `false` keeps pits as solid chasms. Pits on the bottom floor are always solid. Monsters never step into pits. | TBD |
| `objects` | number (0–1) | no | Room clutter. Dungeon: pillars (block sight) and rubble. Cavern: stalagmites (block sight) and rubble. At `1` roughly one open floor cell in ten gets an object. Objects are only placed on open floor with open floor all around, so they never block a route, stairs, chest or monster. Default: `0` for `"dungeon"`, `0.5` for `"cavern"`. Separately, every `"boss"`-difficulty `"dungeon"` floor gets a throne against the back wall of its last room. | TBD |
| `floor_variety` | number (0–1) | no | Alternate floors. Dungeon: the chance each room gets its own floor (cobble, smooth, pebbles, brick, planks, grate); corridors stay flagstone. Cavern: how much of the floor is soft patches of gravel, rock, moss, sand, slab or crystal over the dirt. Default: `0` for `"dungeon"`, `0.6` for `"cavern"`. | TBD |
| `wall_decor` | number (0–1) | no | Share of brick wall faces (those looking onto open floor, not next to a door) carrying a decoration — up to ~30% at `1`. Dungeon: banners, windows. Cavern: glowing cracks (a small light source), crystal veins, webs. Default `0`. | TBD |
| `edge_transitions` | boolean | no | Where the floor's entrance + exit stairs are placed: `true` = at the map **edge** (carving a short trail inward), `false` = in the **interior rooms**. Applies to every style. Absent → `false` (interior rooms). | TBD |
| `loot` | `{ chest_item?: string, chest_frequency?: number }` | no | Procedural loot chests. `chest_item` is the id of an item authored with `is_chest: true` (its `contents` are what the party finds on open); `chest_frequency` (0–1) is the per-room chance a chest is placed. **Chests are opt-in** — with no `loot.chest_item`, no chests generate. When an item is set but `chest_frequency` is omitted it defaults to `0.5`. | TBD |
| `levels` | object[] | yes | Ordered list of inline [Dungeon Level](dungeon_level.md) records; index 0 is the entrance floor, deeper floors follow. Each Level may override any of the parent's parameters for floor-by-floor variation. | TBD |

## Inheritance into Levels

Every Level inherits its parent Dungeon's parameter values by default. A Level may set any subset of `style`, `difficulty`, `size`, `torch_density`, `locked_doors`, `doors`, `pits`, `pit_falls`, `objects`, `floor_variety`, `wall_decor`, `edge_transitions`, `loot` to override per floor. `loot` merges field-by-field — a Level that sets only `loot.chest_frequency` keeps the parent's `chest_item`. A Level can opt out of chests on one floor with `loot: { chest_item: "" }`. Examples of why you'd override:

- The final floor is a `"boss"` difficulty floor inside an otherwise `"hard"` dungeon.
- A side wing changes `style` from `"dungeon"` to `"cavern"` for one floor.
- The bottom floor has `torch_density: 0` for the climactic dark encounter.
- The treasury floor sets `locked_doors: 1` so every door is locked.
- An open-plan floor sets `doors: 0` so it has no doorframes, while deeper floors keep the default.
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
  "style": "dungeon",
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
- **`style` is a closed enum today.** Values are `"dungeon"` and `"cavern"`. Add new values here (and in `DungeonsBrowse`'s dropdown) when the generator gains support for additional tilesets. The legacy `"caves"`, `"ruins"`, `"forest"` and `"custom"` styles (built for the old tile sets) were removed; records still carrying them load as `"dungeon"`.
- **`size` is fixed per generation.** No min/max range yet — every level either uses the inherited size or sets its own. Adding `{ min_width, max_width, ... }` for "random within a range" is a natural future extension.
- **`difficulty: "boss"` is the boss-floor convention.** Matches Monster's note that `"boss"` is intentionally outside the random-encounter pool. A Level overriding to `"boss"` flags it as the final floor for generator/UI purposes.
- **Schema is a stub.** Likely future additions: per-dungeon encounter table overrides, loot multiplier, scripted-event hooks for specific levels, seed/RNG knob.
