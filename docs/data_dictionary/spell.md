# Spell

## Purpose

The catalog of castable spell-actions. A Spell record describes **what happens when the spell is cast** — damage formula, range, targeting, applied effect, etc. — independently of how it's invoked. Both spellcasters (per the Character Class model) and magic items (via an `activates_spell` reference) can invoke the same Spell record; the Spell itself doesn't know which.

Spells that produce a lingering status (Sleep, Bless, Curse, Shield) reference an Effect by id under `action_params.effect_id` and carry the *application-time* parameters (save DCs, magnitudes that override the Effect's state-side defaults) alongside it. Spells that produce one-shot results (damage, heal, teleport, summon) carry their action-specific data directly in `action_params` and don't touch the Effect catalog.

Ported from v1's `data/spells.json` (see `_v1_reference/docs/data_dictionary/spells.json.md` for the original).

## Location

`web/public/modules/default/spells.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "spells": [ <spell_record>, ... ]
}
```

Each record:

```json
{
  "id": "",
  "name": "",
  "description": "",
  "allowable_classes": [],
  "casting_type": "",
  "min_level": 1,
  "mp_cost": 0,
  "range": 0,
  "targeting": "",
  "usable_in": [],
  "duration": "instant",
  "action": "",
  "action_params": null,
  "sfx": null,
  "hit_sfx": null
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier; referenced by Character Class (`spells_can_cast`), Item (`activates_spell`), Monster (`spells[]`), and combat logs | TBD |
| `name` | string | yes | Display label | TBD |
| `description` | string | yes | Tooltip / spellbook text | TBD |
| `allowable_classes` | string[] | yes | Class names that can cast this spell. (See *Notes* — this is granter-side info and may move to Character Class later.) | TBD |
| `class_min_levels` | object | no | Per-class min level override (e.g. `{ "Paladin": 5 }`) when one of the `allowable_classes` should require a higher level than `min_level`. Currently only used by Turn Undead. | TBD |
| `casting_type` | string | no | Spellcasting school flavor — `"sorcerer"` (arcane) or `"priest"` (divine) in v1. Drives UI grouping and possibly spell-list partitioning. | TBD |
| `min_level` | int | yes | Minimum character level to learn the spell. Per-class overrides via `class_min_levels`. | TBD |
| `mp_cost` | int | yes | Mana cost when cast by a character. Items/monsters invoking the same spell may bypass this. | TBD |
| `range` | int | yes | Maximum cast range in tiles. `0` typically means self-target. | TBD |
| `targeting` | string | yes | Target selection mode (see *Targeting modes* below) | TBD |
| `usable_in` | string[] | yes | Which game contexts the spell can be cast in: `"battle"`, `"overworld"`, `"town"`, `"dungeon"` | TBD |
| `duration` | string \| number | yes | `"instant"` for one-shot spells, or a turn/step count for effect-applying spells. For `apply_effect` spells this matches the applied Effect's default duration; explicit `duration` here would override the Effect. | TBD |
| `action` | string | yes | Action discriminator. See *Action discriminators* below for the full list. | TBD |
| `action_params` | object \| null | yes | Action-specific parameters. Shape depends on `action`. For `apply_effect` / `cure_effect`, includes `effect_id` plus any application-time overrides for the Effect's params. | TBD |
| `sfx` | string \| null | no | Sound effect on cast | TBD |
| `hit_sfx` | string \| null | no | Sound effect on impact (where applicable) | TBD |

## Action discriminators

The `action` field is a discriminated union. Each value names a runtime handler; `action_params` carries that handler's input.

| `action` | `action_params` shape | Behavior |
|---|---|---|
| `damage` | `{ dice_count, dice_sides, stat_bonus, min_damage, damage_type? }` | Single-target damage roll, optionally typed (e.g. `"lightning"`) for resistance interactions |
| `aoe_damage` | `{ dice_count, dice_sides, stat_bonus, min_damage, radius, damage_type? }` | Area damage around a targeted tile |
| `heal` | `{ dice_count, dice_sides, stat_bonus, min_heal, scope? }` | Healing roll. `scope: "all_allies"` makes it party-wide (mass heal). |
| `apply_effect` | `{ effect_id, ...effect_param_overrides, ...application_params }` | Applies the named Effect to the target. Application params (`save_dc_*`, `max_target_hp`) live here; the Effect's state-side defaults can also be overridden by including matching keys. |
| `cure_effect` | `{ effect_id }` | Removes the named Effect from the target |
| `teleport` | `null` | Teleports caster to selected tile (no params) |
| `summon` | `{ creature: { name, hp, ac, attack_bonus, damage_dice, damage_sides, damage_bonus } }` | Summons a temporary creature; `duration` on the Spell record governs how long it lasts |
| `turn_undead` | `{ hp_percent, save_dc_base, save_dc_stat }` | Damages all undead on the field; failed save destroys them outright |
| `knock` | `{ save_dc_base, save_stat }` | Utility — attempts to unlock a target |
| `restore` | `{ heal_percent, mp_percent, cure_effects, scope? }` | Composite — full or partial HP/MP restore plus list of effects to cure |

Unknown `action` values should be dropped at load with a warning.

## Targeting modes

| Mode | Meaning |
|---|---|
| `self` | Caster only |
| `select_ally` | Pick a friendly party member within range |
| `select_ally_or_self` | Pick an ally or the caster |
| `select_enemy` | Pick a hostile target within range |
| `select_tile` | Pick a tile (for AOE, teleport, summon) |
| `directional_projectile` | Aim a line; everything in the path may be hit |
| `auto_monster` | Auto-targets all monsters (e.g. Turn Undead) |

## Cross-references to other models

- `action_params.effect_id` → [Effect](effect.md) — the lingering state applied or cured
- `allowable_classes` → [Character Class](character_class.md) — class names that can learn this spell
- Referenced *by* [Character Class](character_class.md) `spells_can_cast` (or similar) when classes formalize their spell access
- Referenced *by* [Item](item.md) `activates_spell` — magic items that invoke this spell when used or equipped
- Referenced *by* [Monster](monster.md) `spells[]` — monster-castable spell ids with per-monster cast_chance and damage overrides

## Example records

**Instant damage:**

```json
{
  "id": "magic_dart",
  "name": "Magic Dart",
  "allowable_classes": ["Wizard", "Alchemist", "Druid"],
  "casting_type": "sorcerer",
  "min_level": 1,
  "mp_cost": 6,
  "range": 10,
  "targeting": "directional_projectile",
  "usable_in": ["battle"],
  "duration": "instant",
  "action": "damage",
  "action_params": {
    "dice_count": 1,
    "dice_sides": 6,
    "stat_bonus": "intelligence",
    "min_damage": 1
  },
  "sfx": "fireball",
  "hit_sfx": "explosion"
}
```

**Apply-effect (with application params on the Spell):**

```json
{
  "id": "sleep",
  "name": "Sleep",
  "allowable_classes": ["Wizard", "Druid"],
  "casting_type": "sorcerer",
  "min_level": 1,
  "mp_cost": 5,
  "range": 99,
  "targeting": "select_enemy",
  "usable_in": ["battle"],
  "duration": 2,
  "action": "apply_effect",
  "action_params": {
    "effect_id": "sleep",
    "max_target_hp": 15,
    "save_dc_stat": "intelligence",
    "save_dc_base": 8
  },
  "sfx": "shield",
  "hit_sfx": null
}
```

**Apply-effect with overrides on the Effect's state-side params** (Push applies Repelled with a larger radius and stronger push than the Effect's defaults):

```json
{
  "id": "push",
  "name": "Push",
  "allowable_classes": ["Cleric"],
  "casting_type": "priest",
  "min_level": 5,
  "mp_cost": 14,
  "range": 0,
  "targeting": "self",
  "usable_in": ["overworld", "dungeon", "town"],
  "duration": 10,
  "action": "apply_effect",
  "action_params": {
    "effect_id": "repel_monsters",
    "radius": 5,
    "push_distance": 3
  },
  "sfx": "magic_burst",
  "hit_sfx": null
}
```

**Summon:**

```json
{
  "id": "animate_dead",
  "name": "Animate Dead",
  "allowable_classes": ["Wizard", "Druid"],
  "casting_type": "sorcerer",
  "min_level": 6,
  "mp_cost": 20,
  "range": 99,
  "targeting": "select_tile",
  "usable_in": ["battle"],
  "duration": 5,
  "action": "summon",
  "action_params": {
    "creature": {
      "name": "Skeleton",
      "hp": 30,
      "ac": 14,
      "attack_bonus": 6,
      "damage_dice": 2,
      "damage_sides": 6,
      "damage_bonus": 3
    }
  },
  "sfx": "shield",
  "hit_sfx": null
}
```

## Notes and open questions

- **`allowable_classes` is granter-side info.** Following the same principle that decoupled the Effect model, "which classes can cast this spell" arguably belongs on Character Class (`spells_can_cast`) rather than on the Spell itself. We kept it on the Spell for now to minimize the porting surface, but flagged: when Character Class is filled in, this might invert. The Item/Monster invocation paths already don't read `allowable_classes` (an item invoking a spell doesn't care which classes "could" cast it), so the field is only meaningful when a Character is the source.

- **`duration` on apply_effect spells is redundant with the Effect's default.** v1 carried `duration` on every spell. For `apply_effect` spells the value matches the referenced Effect's default duration; for damage/heal/etc. it's `"instant"`. We kept it for transparency, but a stricter model would drop it from `apply_effect` records and use the Effect's default unless `action_params.duration` explicitly overrides.

- **Application-time params now live here.** v1's `effect_value` was a polymorphic blob that mixed state-side and application-time data. The port split them: state-side params stay on the Effect record's `params`; application-time params (save DCs, max target HP, per-application magnitudes) live in this Spell record's `action_params`. The Push spell record is the cleanest example of overriding Effect state-side params from the Spell side (`radius: 5, push_distance: 3` overriding `repel_monsters` defaults of `3` and `1`).

- **v1 id/name swap fixed.** v1's spell id `"fireball"` was actually Magic Dart, and the real Fireball had id `"fireball_aoe"`. v2 renames them: id `"magic_dart"` for Magic Dart, id `"fireball"` for Fireball.

- **Mass Heal and Restore are party-wide via `scope: "all_allies"`** on `action_params`. v1 had distinct `effect_type` values (`mass_heal`, `restore`) that hardcoded the party scope. Folding scope into action_params lets `heal` and `restore` cover their solo and party variants without a separate action discriminator.

- **`casting_type` is informational.** v1's TS port used it for UI grouping (spellbook tabs) but didn't gate behavior. v2 may want to formalize as a class-of-class (arcane / divine) once Character Class is filled in.

- **Composite actions.** `restore` is a multi-effect action (heal + restore MP + cure poison). If composites proliferate, a `sequence` action type that chains sub-actions would be cleaner than ad-hoc named actions. Not needed yet.

- **`item_type` interactions are TBD.** v1's Wand-of-Lightning style items would have referenced a Spell id via something like `item.activates_spell`. The Item model has not been ported yet; the cross-reference here is forward-declared.

- **Several v1 SFX values are placeholder.** Many spells reused `sfx: "shield"` regardless of their actual nature (Sleep, Long Shanks, Invisibility, etc.). Carried over as-is; expect a content pass to normalize.
