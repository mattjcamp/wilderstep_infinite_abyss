# Item

## Purpose

The master item catalog — every weapon, armor piece, consumable, reagent, scroll, key, quest artifact, and miscellaneous object the game knows about. Items split into three categories (`weapons`, `armors`, `general`) but share a single record shape; the `category` field discriminates and a finer-grained `item_type` further classifies items inside `general`.

Specialized item kinds (potions, ammo, reagents, etc.) are variants of Item rather than separate models, expressed through the `item_type` tag.

Ported from v1's `data/items.json` (see `_v1_reference/docs/data_dictionary/items.json.md` for the original full-fat shape).

## Location

`web/public/modules/default/items.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

A flat array under the `items` key, with each record carrying an explicit `category` discriminator. This collapses v1's three top-level buckets (`weapons` / `armors` / `general`) into one collection so loaders don't need to flatten on parse:

```
{
  "_comment": "optional authoring notes",
  "items": [ <item_record>, ... ]
}
```

Each record minimally has `id`, `name`, `category`. The rest of the fields are populated according to what the item is — most weapons set `power`/`slots`/`ranged`, armors set `evasion`, consumables set `usable`/`effect`/`power`, and so on.

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"sun_sword"`, `"healing_potion"`) | TBD |
| `name` | string | yes | Display label (e.g. `"Sun Sword"`, `"Healing Potion"`). Currently also used by cross-references that key off item *names* rather than ids (Recipe reagents, weapon `ammo`). | TBD |
| `category` | string | yes | One of `"weapons"`, `"armors"`, `"general"`. | TBD |
| `description` | string | no | Tooltip / UI text. | TBD |
| `icon` | string | no | Render glyph hint (e.g. `"sword"`, `"potion"`, `"herb"`, `"key"`). | TBD |
| `item_type` | string | no | Finer-grained sub-discriminator. See *item_type values* below. | TBD |
| `power` | number | no | Weapon damage (weapons) or consumable potency (general, e.g. heal amount). | TBD |
| `ranged` | bool | no | Weapon attacks at range. | TBD |
| `throwable` | bool | no | Eligible for a Throw action. | TBD |
| `slots` | string[] | no | Equip slots. Vocabulary: `"hands"` (weapons — one slot per character regardless of one- or two-handedness), `"body"` (armor). | TBD |
| `evasion` | number | no | Armor base AC (replaces unarmored AC). | TBD |
| `ac_bonus` | number | no | Flat AC bonus added on top of any base. | TBD |
| `bonus_damage` | string \| number | no | Extra dice on hit (e.g. `"1d6"`) — string for dice notation, number for flat bonuses. | TBD |
| `damage_type` | string | no | Damage school (e.g. `"fire"`). Used for resistance interactions. | TBD |
| `ammo` | string | no | Id of the ammo item this weapon consumes (e.g. `"arrows"`, `"bolts"`, `"stones"`). Cross-references another Item by `id`. | TBD |
| `durability` | number | no | Max uses; `0` means indestructible. | TBD |
| `usable` | bool | no | Marks the item as a consumable. | TBD |
| `combat_usable` | bool | no | Usable mid-combat (defaults to true for consumables). | TBD |
| `effect` | string | no | Action verb for `usable` items — what happens when consumed. **Not an Effect-model id** — see Notes. Observed values: `"heal_hp"`, `"heal_mp"`, `"cure_poison"`, `"buff_strength"`, `"buff_ac"`, `"combat_only"`, `"rest"`. | TBD |
| `stackable` | bool | no | Multiple copies stack on one inventory row. | TBD |
| `charges` | number | no | Stack size or per-row use count. | TBD |
| `grants_effect` | string | no | Effect id conferred while the item is equipped — see [Effect](effect.md). Currently unused in v2 data (the lone v1 example, `sun_sword_aura`, was removed). | TBD |
| `quest_item` | bool | no | Marks the item as a quest objective. | TBD |
| `party_can_equip` | bool | no | Eligible for a party-wide slot. | TBD |
| `character_can_equip` | bool | no | Eligible for a per-character equip slot. | TBD |
| `buy` | number | no | Shop purchase price. | TBD |
| `sell` | number | no | Shop sell-back price. | TBD |

## Polymorphic discriminators

**`category`** (`weapons` | `armors` | `general`) — the primary discriminator. Sets which fields are typically populated:

| Category | Typical fields |
|---|---|
| `weapons` | `power`, `ranged`, `throwable`, `slots`, `bonus_damage`, `damage_type`, `ammo`, `durability`, `character_can_equip`, `buy`/`sell` |
| `armors` | `evasion`, `slots`, `durability`, `character_can_equip`, `buy`/`sell` |
| `general` | varies wildly: `usable`+`effect`+`power` for consumables, `stackable`+`charges`+`item_type: "reagent"` for reagents, `quest_item: true` for quest items, etc. |

**`item_type`** — finer-grained sub-discriminator. Observed values in current data:

- **Weapons**: `sword`, `dagger`, `mace`, `halberd`, `spear`, `axe`, `club`, `gloves`, `fists`, `bow`, `long_bow`, `short_bow`, `crossbow`, `silver_bow`, `sling`, `rock`
- **Armors**: `cloth`, `leather`, `chain`, `plate`, `exotic`
- **General**: `potion`, `antidote`, `poison_potion`, `bomb`, `scroll`, `herb`, `reagent`, `ammo`, `holy_water`, `lockpick`, `torch`, `camping_supplies`, `rope`, `throwable`, `quest_item`

For weapons, `item_type` drives ranged-attack range lookups (the v1 implementation branched on `long_bow`/`crossbow`/`short_bow`/`sling`/`rock` to set range). For general items, most values are informational tags that the UI may filter on.

**`effect`** (on `usable` general items) — discriminator for consumable behavior. The runtime branches on the value:

| `effect` | Behavior (per v1) |
|---|---|
| `heal_hp` | Restores HP (amount from `power`) |
| `heal_mp` | Restores MP (amount from `power`) |
| `cure_poison` | Removes the poisoned status |
| `buff_strength` | Temporarily boosts strength |
| `buff_ac` | Temporarily boosts AC |
| `combat_only` | Marks the consumable as combat-only (used by throwable poisons in v1) |
| `rest` | Consumes the item to camp / long-rest (Camping Supplies) |

Items with `effect` values that have no v1 handler (`Scroll of Fire`, `Smoke Bomb`, `Rope`, `Holy Water`) are inventory placeholders today.

## Cross-references to other models

- `grants_effect` → [Effect](effect.md) — Effect id conferred while the item is equipped
- `ammo` → another **Item** in this same file (matches another item's `id`; e.g. Long Bow's `ammo: "arrows"`)
- Referenced *by* [Recipe](recipe.md) `reagents` keys — recipe ingredients (by id)
- Referenced *by* [Party](party.md) `inventory[].item` slots — items the party carries (by id)
- Referenced *by* [Counter](counter.md) shop stock + loot tables (by id)
- Referenced *by* [Spawn](spawn.md) `loot[]` — clear-the-lair drops (by id)
- Referenced *by* [Character](character.md) `equipped.*` values + `inventory[].item` — equipped weapon/armor and personal bag (by id)
- Forward-declared: an `activates_spell` field referencing [Spell](spell.md) would let magic items invoke a Spell (e.g. a Wand of Lightning). No items currently use this; the design was discussed alongside the spells port.
- The `effect` action-verb on consumables is **not** an [Effect](effect.md) id — see Notes for the naming overlap and the future-bridge to Spell.

## Example records

**Weapon (basic):**

```json
{
  "id": "sword",
  "category": "weapons",
  "name": "Sword",
  "description": "A well-balanced longsword. Standard fighter fare.",
  "icon": "sword",
  "item_type": "sword",
  "power": 5,
  "ranged": false,
  "throwable": false,
  "slots": ["hands"],
  "durability": 20,
  "party_can_equip": false,
  "character_can_equip": true,
  "buy": 40,
  "sell": 30
}
```

**Weapon (magical, with damage type and bonus damage):**

```json
{
  "id": "sun_sword",
  "category": "weapons",
  "name": "Sun Sword",
  "description": "A radiant blade infused with solar energy. Burns those it strikes and bathes its wielder in light.",
  "icon": "sword",
  "item_type": "sword",
  "power": 20,
  "ranged": false,
  "throwable": false,
  "slots": ["hands"],
  "ac_bonus": 0,
  "bonus_damage": "1d6",
  "damage_type": "fire",
  "durability": 0,
  "party_can_equip": false,
  "character_can_equip": true,
  "buy": 0,
  "sell": 0
}
```

**Armor:**

```json
{
  "id": "chain",
  "category": "armors",
  "name": "Chain",
  "description": "A coat of interlocking iron rings.",
  "icon": "armor_heavy",
  "item_type": "chain",
  "evasion": 55,
  "slots": ["body"],
  "durability": 15,
  "party_can_equip": false,
  "character_can_equip": true,
  "buy": 60,
  "sell": 30
}
```

**Consumable potion:**

```json
{
  "id": "healing_potion",
  "category": "general",
  "name": "Healing Potion",
  "description": "A ruby-red elixir that mends wounds. Restores a large amount of HP.",
  "icon": "potion",
  "item_type": "potion",
  "power": 30,
  "usable": true,
  "effect": "heal_hp",
  "stackable": true,
  "charges": 1,
  "party_can_equip": false,
  "character_can_equip": false,
  "buy": 40,
  "sell": 20
}
```

**Reagent (used by Recipes):**

```json
{
  "id": "moonpetal",
  "category": "general",
  "name": "Moonpetal",
  "description": "A luminous flower petal that glows faintly in the dark. Prized by alchemists.",
  "icon": "herb",
  "item_type": "reagent",
  "stackable": true,
  "charges": 1,
  "party_can_equip": false,
  "character_can_equip": false,
  "buy": 12,
  "sell": 5
}
```

**Quest item:**

```json
{
  "id": "bronze_key",
  "category": "general",
  "name": "Bronze Key",
  "description": "A tarnished bronze key with intricate gnomish gearwork. One of the 8 Keys of Shadow.",
  "icon": "key",
  "item_type": "quest_item",
  "quest_item": true,
  "party_can_equip": false,
  "character_can_equip": false
}
```

## Notes and open questions

- **Dropped because not used in v1.** Per the "don't bring over not-used fields" rule, the following v1 fields are absent from the port:
  - `indestructible` — redundant with `durability: 0`; v1 TS reads only `durability`.
  - `stat_bonuses` — present only on Sun Sword as an empty `{}`; no v1 reader.
  - `on_hit` (`{ spell_id, chance }`) — present only on Sun Sword; no v1 reader, and the referenced `spell_id: "fireball"` pointed to the wrong v1 spell. The Sun Sword still exists as a powerful fire-damage weapon; the proc was never live.
  - `icon_color` — RGB tint on Keys and the Dragonheart; no v1 reader.
  - `melee` — descriptive only in v1 (TS treats `!ranged` as melee); inconsistently set across records (often `false` on clearly-melee weapons). Dropped to avoid propagating the bug.
  - Throwable-poison subfields (`poison_type`, `poison_damage`, `poison_duration`, `poison_mp_drain`, `poison_debilitate`, throwable `save_dc`) — all dormant in v1; the v1 use-handler dealt only `power + 1d6` splash damage and ignored these. If poison-DOT throwables come back, the natural home is `params` on the Poisoned Effect plus an application reference, not a parallel set of fields on the Item.

- **`effect` on consumables is *not* an Effect-model id.** The name collision is unfortunate. `effect` here is an *action verb* describing what happens when the item is consumed (`"heal_hp"`, `"buff_strength"`, etc.) — the runtime branches on it. The decoupled v2 way to model this is to point at a [Spell](spell.md) instead (e.g. a Healing Potion `activates_spell: "heal"` invokes the heal spell with the item as the source). Until that bridge is wired, the v1 string-discriminator stays. Strong candidate for a rename to `on_use` or `use_action` in a future pass to disentangle the field name from the Effect model.

- **Sun Sword's `grants_effect` was dropped.** v1 had `grants_effect: "sun_sword_aura"`, but the `sun_sword_aura` Effect record was removed from `effects.json` earlier. To avoid a dangling reference, the field was dropped from Sun Sword in the port; the weapon is still a `power: 20` fire weapon with `bonus_damage: 1d6`. If the aura comes back as an Effect, re-add `grants_effect: "sun_sword_aura"` here.

- **All cross-references use `Item.id`.** v1 keyed inventory entries, recipe reagents, counter stock, spawn loot, weapon ammo, and equipped slots by display name. v2 standardized every Item reference on `Item.id` (snake_case) — no name-based holdouts remain.

- **`item_type` is an open string.** No enum validation today. Typo risk; the observed values are listed under *Polymorphic discriminators* above, but adding a new value silently is too easy.

- **`bonus_damage` mixes string and number.** v1 stored dice notation as `"1d6"` (string) and could in principle store a flat number. Loaders need to parse both. Worth normalizing — either always strings (with `"+3"` for flats) or always a structured object (`{ dice_count, dice_sides, bonus }`).

- **`effect` values without handlers.** Per v1's dictionary, `Scroll of Fire`, `Smoke Bomb`, `Rope`, and `Holy Water` carry `effect` values that no v1 use-handler implemented. They're inventory placeholders today. Either wire the behavior or strip the `effect` field from these records.

- **Party-equip vs. character-equip flags are both bool and both default false.** Every item carries both, almost always one or the other is true (or both are false for inventory-only items like consumables and reagents). Could be folded into a single `equip_scope: "party" | "character" | "none"` enum if the model wants tightening.
