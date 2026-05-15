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
  "result_item": "",
  "reagents": {}
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier; snake_case (e.g. `"healing_potion"`). Used by the crafting UI to identify the picked option and by save-game state if recipe knowledge is persisted later. | TBD |
| `name` | string | yes | Display label shown in the brew picker. | TBD |
| `result_item` | string | yes | [Item](item.md) `id` produced on a successful brew. In current data this happens to equal the recipe's own `id` (convenient when the recipe and its output share a name), but the contract is that they're independent: future recipes can produce an item whose id differs from the recipe's. | TBD |
| `reagents` | object<string, int> | yes | Required materials: `{ "<item_id>": <quantity>, ... }`. Keys are [Item](item.md) ids (snake_case). Quantities are positive integers. | TBD |

## Cross-references to other models

- `result_item` → [Item](item.md) `id` — the item produced on a successful brew
- `reagents` keys → [Item](item.md) ids — the ingredient items (entries with `item_type: "reagent"` in `items.json`: `moonpetal`, `spring_water`, `glowcap_mushroom`, `serpent_root`, `brimite_ore`)

## Example record

```json
{
  "id": "healing_potion",
  "name": "Healing Potion",
  "result_item": "healing_potion",
  "reagents": { "moonpetal": 1, "spring_water": 1 }
}
```

## Notes and open questions

- **Intentional v2 simplification.** v1's recipe records also carried `description`, `dc` (alchemy skill check DC), `result_count`, and `category`. v2 dropped these for the first pass — the Recipe right now exists only to populate the brew-option picker, check ingredient counts, and name the resulting item. They'll come back when crafting execution lands.

- **Reagent keys are Item ids.** Migrated from the original `Item.name` keys (`"Moonpetal"`, `"Spring Water"`, …) once the rest of v2 standardized on id references.

- **Dropped because not used in v1.** v1's `potions.json` had a top-level `reagents` array (master list of valid reagent names) that the TS port did not consume — dropped per the "don't bring over not-used fields" rule. v1 also had `category` (preserved on the runtime model but no UI consumed it — same treatment) and `_comment` (no TS reader).

- **No DC, no skill-check semantics yet.** v1 ran `d20 + INT mod ≥ dc` to determine brew success, consuming reagents on both success and failure. v2 has no equivalent system. When the brew action is implemented, decide whether DC lives on the Recipe (where it does the work) or is computed from Recipe + class/level/items at apply time.

- **`result_item` made explicit.** v1 used the recipe's id as the produced item's id by convention, which kept the data DRY but coupled the recipe's identity to its output. v2 makes the link explicit so the two ids can drift apart — useful when a recipe is renamed without renaming the item, or when two recipes produce the same Item (e.g. a fast/expensive variant) and they need distinct recipe ids.

- **Recipe knowledge is not modeled.** v1 made every recipe available to any Alchemist who opened the brew menu. v2 hasn't decided whether recipes are learned, discovered, gated by class, or universal. The Recipe record carries no `allowable_classes` or `min_level` field today; if recipe discovery becomes a thing, it'll live somewhere — possibly here, possibly on Character Class.
