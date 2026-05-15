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
| `style` | string | yes | Visual / thematic family the generator uses to pick a tile palette and decor. Closed enum: `"caves"`, `"ruins"`, `"forest"`. | TBD |
| `difficulty` | string | yes | Difficulty tier. Same enum as [Monster](monster.md) `difficulty`: `"easy"`, `"normal"`, `"hard"`, `"deadly"`, `"boss"`. Drives the encounter pool the generator samples from. | TBD |
| `size` | `{ width: int, height: int }` | yes | Tile dimensions for each generated floor (default; per-level overrides allowed). | TBD |
| `torch_density` | number (0–1) | yes | Probability that an eligible wall tile carries a torch. `0` = pitch dark, `1` = every wall lit. Drives ambient brightness. | TBD |
| `locked_doors` | number (0–1) | yes | Probability that an interior door is locked. Pairs with the Thief / Ranger Pick Locks ability and the Knock spell. | TBD |
| `levels` | object[] | yes | Ordered list of inline [Dungeon Level](dungeon_level.md) records; index 0 is the entrance floor, deeper floors follow. Each Level may override any of the parent's parameters for floor-by-floor variation. | TBD |

## Inheritance into Levels

Every Level inherits its parent Dungeon's parameter values by default. A Level may set any subset of `style`, `difficulty`, `size`, `torch_density`, `locked_doors` to override per floor. Examples of why you'd override:

- The final floor is a `"boss"` difficulty floor inside an otherwise `"hard"` dungeon.
- A side wing changes `style` from `"caves"` to `"ruins"` for one floor.
- The bottom floor has `torch_density: 0` for the climactic dark encounter.
- The treasury floor sets `locked_doors: 1` so every door is locked.

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
- **`style` is a closed enum today.** Values are `"caves"`, `"ruins"`, `"forest"`. Add new values here (and in `DungeonsBrowse`'s dropdown) when the generator gains support for additional themes.
- **`size` is fixed per generation.** No min/max range yet — every level either uses the inherited size or sets its own. Adding `{ min_width, max_width, ... }` for "random within a range" is a natural future extension.
- **`difficulty: "boss"` is the boss-floor convention.** Matches Monster's note that `"boss"` is intentionally outside the random-encounter pool. A Level overriding to `"boss"` flags it as the final floor for generator/UI purposes.
- **Schema is a stub.** Likely future additions: per-dungeon encounter table overrides, loot multiplier, scripted-event hooks for specific levels, seed/RNG knob.
