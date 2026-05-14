# Recipe

## Purpose

A craftable option the player can pick from a crafting UI (currently the alchemy / brew picker). Each Recipe carries enough to *present the option and check ingredients*: an id, a display name, and the reagents required to attempt the brew.

**Scope is deliberately minimal in this pass.** The execution side of crafting — difficulty class for the skill check, the resulting Item produced on success, how many copies are produced, recipe categories for filtering — is *not* in v2 yet. Those fields existed in v1's `potions.json` but they cover behavior we haven't designed for v2 yet; they'll land on Recipe (or an adjacent model) when the brew-execution path is implemented.

Ported from v1's `data/potions.json` (see `_v1_reference/docs/data_dictionary/potions.json.md` for the original full-fat shape).

## Location

`web/public/modules/default/recipes.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "recipes": [ <recipe_record>, ... ]
}
```

Each record:

```json
{
  "id": "",
  "name": "",
  "reagents": {}
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier; snake_case (e.g. `"healing_potion"`). Used by the crafting UI to identify the picked option and by save-game state if recipe knowledge is persisted later. | TBD |
| `name` | string | yes | Display label shown in the brew picker. | TBD |
| `reagents` | object<string, int> | yes | Required materials: `{ "<item_name>": <quantity>, ... }`. Keys are Item names (display-string form, matching `Item.name`). Quantities are positive integers. | TBD |

## Cross-references to other models

- `reagents` keys → [Item](item.md) — the ingredient items. v1's reagents were `Item.item_type: "reagent"` entries in `items.json` (`Moonpetal`, `Spring Water`, `Glowcap Mushroom`, `Serpent Root`, `Brimite Ore`). Until Item is ported, reagent names are just strings; once Item lands they should resolve to real Item ids/names.
- Future: a Recipe's *result* (what item it produces on a successful brew) will reference [Item](item.md) once that side of the model lands.

## Example record

```json
{
  "id": "healing_potion",
  "name": "Healing Potion",
  "reagents": { "Moonpetal": 1, "Spring Water": 1 }
}
```

## Notes and open questions

- **Intentional v2 simplification.** v1's recipe records also carried `description`, `dc` (alchemy skill check DC), `result_item`, `result_count`, and `category`. v2 dropped these for the first pass — the Recipe right now exists only to populate the brew-option picker and check ingredient counts; nothing produces an item yet, so DC and result fields would be data without a consumer. They'll come back when crafting execution lands.

- **Reagent keys are strings, not ids, today.** v1 keyed reagents by `Item.name` (e.g. `"Moonpetal"`) because v1 items were keyed by display name. When Item is ported and gains real ids, the convention here may shift to `Item.id` (e.g. `"moonpetal"`). Either way the contract is "keys are Item references"; the exact form is open until Item lands.

- **Dropped because not used in v1.** v1's `potions.json` had a top-level `reagents` array (master list of valid reagent names) that the TS port did not consume — dropped per the "don't bring over not-used fields" rule. v1 also had `category` (preserved on the runtime model but no UI consumed it — same treatment) and `_comment` (no TS reader).

- **No DC, no skill-check semantics yet.** v1 ran `d20 + INT mod ≥ dc` to determine brew success, consuming reagents on both success and failure. v2 has no equivalent system. When the brew action is implemented, decide whether DC lives on the Recipe (where it does the work) or is computed from Recipe + class/level/items at apply time.

- **No result_item yet either.** Currently a recipe with id `"healing_potion"` is just a labeled bundle of reagents. There's no formal claim that picking it produces a Healing Potion item. v1's convention was that `result_item` defaulted to the recipe key, which kept the data DRY but coupled the recipe's identity to its output. v2 will need to decide whether the recipe's id is the result-item id by convention, or whether `result_item` should be an explicit field added later.

- **Recipe knowledge is not modeled.** v1 made every recipe available to any Alchemist who opened the brew menu. v2 hasn't decided whether recipes are learned, discovered, gated by class, or universal. The Recipe record carries no `allowable_classes` or `min_level` field today; if recipe discovery becomes a thing, it'll live somewhere — possibly here, possibly on Character Class.
