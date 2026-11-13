# Monster

## Purpose

The monster catalog — every monster the game can spawn. Each record carries combat stats (HP, AC, attack and damage), visual identity (sprite path, battle scale), movement rules, and three optional arrays describing what the monster *does* in combat: `abilities[]` (special attacks, from the [Monster Ability](monster_ability.md) catalog), `on_hit_effects[]` (effects triggered on a successful melee hit), and `passives[]` (always-on traits).

Ported from v1's `data/monsters.json` (see `_v1_reference/docs/data_dictionary/monsters.md`).

## Location

`web/public/modules/default/monsters.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "monsters": [ <monster_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"goblin"`, `"vampire_lord"`) | TBD |
| `name` | string | yes | Display name; the cross-reference key used by [Encounter](encounter.md) and [Spawn](spawn.md) rosters | TBD |
| `description` | string | no | Flavour text shown beside the monster's portrait on the play encounter screen (Fight / Run / Talk). | Yes |
| `undead` | bool | yes | Marks creature as undead; consumed by Turn Undead | TBD |
| `turn_resistance` | int | no | Elite undead's bonus on Turn Undead saving throws (vampire +4, lich/vampire lord +6, banshee/mummy +2). Any value > 0 also exempts the creature from outright destruction: a failed save sears it for the usual 50% and **turns** it — it flees/cowers for 1d4 of its own turns instead of dying. Omit for lesser undead (skeletons, zombies), which remain destroyable. | TBD |
| `humanoid` | bool | yes | Marks creature as humanoid (forwarded to Combatant; gates Charm in design intent). The encounter screen's **Talk** option is only offered when every monster in the roster is humanoid. `dexterity` likewise sets the **Run** DC (10 + the fastest foe's DEX mod). | Yes |
| `theme` | string | no | Organizational tag for assembling themed maps — one of `"undead"`, `"devil"`, `"elemental"`, `"humanoid"`, `"cryptid"`, `"magical"`. A single primary theme per monster (a Vampire is `undead` even though it's also humanoid). Authoring / filtering aid only; the combat engine ignores it. [Encounter](encounter.md) records derive their own `theme` from the dominant theme of their monsters. | TBD |
| `hp` | int | yes | Max hit points at spawn | TBD |
| `ac` | int | yes | Armor class (attack roll target) | TBD |
| `attack_bonus` | int | yes | Bonus added to melee attack rolls | TBD |
| `damage_dice` | int | yes | Number of dice for melee damage roll | TBD |
| `damage_sides` | int | yes | Sides per damage die (d4, d6, d8…) | TBD |
| `damage_bonus` | int | yes | Flat bonus added to melee damage | TBD |
| `xp_reward` | int | yes | XP granted to the party on kill | TBD |
| `gold_min` | int | yes | Minimum gold drop on kill (inclusive) | TBD |
| `gold_max` | int | yes | Maximum gold drop on kill (inclusive) | TBD |
| `sprite` | string | yes | Sprite identifier or relative path (e.g. `"game/monsters/goblin.png"` or `"monsters/lich"`). Resolved by the asset pipeline the same way Character `sprite` is — there's no relationship to [Map Tile](map_tile.md) ids. | TBD |
| `move_range` | int | yes | Tiles the monster can move per turn in combat | TBD |
| `post_attack_move` | int | yes | Extra tiles allowed after a successful melee hit | TBD |
| `battle_scale` | int (1 or 2) | yes | Sprite size multiplier in combat (1 = standard, 2 = oversized boss) | TBD |
| `difficulty` | string | yes | Difficulty tier (`"easy"`, `"normal"`, `"hard"`, `"deadly"`, `"boss"` for placed-only) | TBD |
| `abilities` | object[] | no | Special attacks — links into [Monster Abilities](monster_ability.md); see *abilities entry* below | Yes |
| `on_hit_effects` | object[] | no | Effects that may trigger on a successful melee hit; see *on_hit_effects entry* | TBD |
| `passives` | object[] | no | Always-on traits; see *passives entry* | TBD |

## `abilities[]` entry

Links a [Monster Ability](monster_ability.md) by id, with this monster's cast chance and optional overrides. Same pattern as `on_hit_effects[]` / `passives[]` → Effects. Order matters: on its turn the AI walks the list top to bottom and uses the first ability whose cast roll succeeds and that has a valid target.

| Field | Type | Description |
|---|---|---|
| `ability_id` | string | Monster ability id (`"fire_breath"`, `"web"`, …) |
| `cast_chance` | int (0–100) | Chance the monster uses it on its turn |
| `...` | various | Any other key overrides the ability's value for this monster only (e.g. the Orc King's `"damage_bonus": 2` on Lightning Bolt, or a renamed `"name"`) |

```json
"abilities": [
  { "ability_id": "lightning_bolt", "cast_chance": 15, "damage_bonus": 2 },
  { "ability_id": "magic_dart", "cast_chance": 25 }
]
```

Edited in the Monsters editor with an ability picker, a cast % per row, up/down ordering, and an overrides box. The old inline `spells[]` array (full spell objects on the monster) is still read as a fallback when `abilities` is absent.

## `on_hit_effects[]` entry

References an [Effect](effect.md) id with per-monster overrides. Triggered when the monster lands a successful melee hit.

| Field | Type | Description |
|---|---|---|
| `effect_id` | string | Effect id (`"drain"`, `"poisoned"`, `"slowed"`, `"consumed"`) |
| `chance` | int (0–100) | Per-monster probability the effect fires on hit |
| `...` | various | Additional flat keys override the Effect's state-side `params` defaults *or* carry application-time data (e.g. `save_dc`, `save_stat` for `consumed`; `amount` for `drain`; `damage_per_turn`+`duration` for `poisoned`) |

## `passives[]` entry

References an [Effect](effect.md) id with optional overrides. Always-on traits applied at spawn.

| Field | Type | Description |
|---|---|---|
| `effect_id` | string | Effect id (`"regen"`, `"fire_resistance"`, `"poison_immunity"`) |
| `...` | various | Optional overrides for the Effect's params (e.g. `amount: 10` to override the Regenerating effect's default of 2) |

## Cross-references to other models

- `on_hit_effects[].effect_id` and `passives[].effect_id` → [Effect](effect.md)
- `name` referenced *by* [Encounter](encounter.md) `monsters[]` and `monster_party_tile`
- `name` referenced *by* [Spawn](spawn.md) `spawn_monsters[]` and `boss_monsters[]`
- `sprite` is **not** a Map Tile id — it's a sprite path string; monsters bypass [Map Tile](map_tile.md) entirely for their sprite

## Example record

```json
{
  "id": "vampire_lord",
  "name": "Vampire Lord",
  "undead": true,
  "humanoid": true,
  "hp": 60,
  "ac": 16,
  "attack_bonus": 7,
  "damage_dice": 2,
  "damage_sides": 8,
  "damage_bonus": 4,
  "xp_reward": 500,
  "gold_min": 50,
  "gold_max": 200,
  "sprite": "game/monsters/vampire_lord.png",
  "move_range": 6,
  "post_attack_move": 1,
  "battle_scale": 1,
  "difficulty": "deadly",
  "on_hit_effects": [
    { "effect_id": "drain", "chance": 40, "amount": 8 }
  ],
  "passives": [
    { "effect_id": "regen", "amount": 10 }
  ]
}
```

## Notes and open questions

- **Dropped from v1 per the not-used rule:** `description` (parsed but never read), `spawn_weight` (TS uses `encounters.json` weights instead), the entire `ranged` sub-object (parsed but unread; would have driven a ranged-attack mode that never shipped), and the top-level `spawn_tables` object (replaced by `encounters.json`).
- **Passives and on_hit_effects now reference Effect ids.** v1 used a `type` string (e.g. `"regen"`, `"fire_resistance"`) that doubled as the runtime handler key and matched no formal Effect record. v2 renames `type` → `effect_id` and resolves against `effects.json`. Per-monster overrides stay as flat keys alongside `effect_id`.
- **Monster special attacks moved to a catalog (Nov 2026).** The inline `spells[]` blocks became [monster_abilities.json](monster_ability.md) records referenced by `abilities[]`. They stay separate from player [Spells](spell.md): the combat engine resolves monster and player casts through different code, and most monster abilities (breath, heal ally, venom) have no player equivalent.
- **`difficulty: "boss"` is not in the standard difficulty enum** (`easy`/`normal`/`hard`/`deadly`). v1 used it deliberately so bosses are excluded from rolled encounter pools (placement is intentional, not random). Carried forward; either add `"boss"` to the enum officially or document the convention.
- **`sprite` paths are inconsistent.** Some records use `"game/monsters/<name>.png"` (path + extension), others `"monsters/<name>"` (no prefix, no extension). v1's loader normalized both; v2 carries the v1 strings as-is. Standardizing is a small future cleanup.
- **Dropped fields (`color`, `terrain`) and rename (`tile` → `sprite`).** v1 carried an RGB `color` fallback used when no sprite was loaded; v2 always renders the sprite (placeholder marker if missing), so the fallback is dead. `terrain` ("land" / "sea") gated where a monster could spawn in v1; v2 surfaces spawn-eligibility through the [Encounter](encounter.md) `area` discriminator and per-cell [Spawn](spawn.md) bindings, so the field is redundant. `tile` was confusingly named (it had no relationship to [Map Tile](map_tile.md) ids); renamed to `sprite` to match the Character convention.
- **No id-based reference yet.** Encounters and Spawn lists reference monsters by `name`; same convention as elsewhere in v2.
