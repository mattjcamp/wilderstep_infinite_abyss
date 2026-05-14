# Monster

## Purpose

The monster catalog — every monster the game can spawn. Each record carries combat stats (HP, AC, attack and damage), visual identity (sprite path, fallback color, battle scale), movement rules, and three optional arrays describing what the monster *does* in combat: `spells[]` (castable abilities), `on_hit_effects[]` (effects triggered on a successful melee hit), and `passives[]` (always-on traits).

Ported from v1's `data/monsters.json` (see `_v1_reference/docs/data_dictionary/monsters.md`).

## Location

`data_model/monsters.json` — real data drives the schema.

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
| `undead` | bool | yes | Marks creature as undead; consumed by Turn Undead | TBD |
| `humanoid` | bool | yes | Marks creature as humanoid (forwarded to Combatant; gates Charm in design intent) | TBD |
| `hp` | int | yes | Max hit points at spawn | TBD |
| `ac` | int | yes | Armor class (attack roll target) | TBD |
| `attack_bonus` | int | yes | Bonus added to melee attack rolls | TBD |
| `damage_dice` | int | yes | Number of dice for melee damage roll | TBD |
| `damage_sides` | int | yes | Sides per damage die (d4, d6, d8…) | TBD |
| `damage_bonus` | int | yes | Flat bonus added to melee damage | TBD |
| `xp_reward` | int | yes | XP granted to the party on kill | TBD |
| `gold_min` | int | yes | Minimum gold drop on kill (inclusive) | TBD |
| `gold_max` | int | yes | Maximum gold drop on kill (inclusive) | TBD |
| `color` | `[int, int, int]` | yes | RGB fallback color when no sprite renders | TBD |
| `tile` | string | yes | Sprite identifier or relative path (e.g. `"game/monsters/goblin.png"` or `"monsters/lich"`) — **not** a Map Tile id | TBD |
| `terrain` | string | yes | Spawn terrain: `"land"` or `"sea"` | TBD |
| `move_range` | int | yes | Tiles the monster can move per turn in combat | TBD |
| `post_attack_move` | int | yes | Extra tiles allowed after a successful melee hit | TBD |
| `battle_scale` | int (1 or 2) | yes | Sprite size multiplier in combat (1 = standard, 2 = oversized boss) | TBD |
| `difficulty` | string | yes | Difficulty tier (`"easy"`, `"normal"`, `"hard"`, `"deadly"`, `"boss"` for placed-only) | TBD |
| `spells` | object[] | no | Castable abilities; see *spells entry* below | TBD |
| `on_hit_effects` | object[] | no | Effects that may trigger on a successful melee hit; see *on_hit_effects entry* | TBD |
| `passives` | object[] | no | Always-on traits; see *passives entry* | TBD |

## `spells[]` entry

A polymorphic object discriminated by `type`. Stays inline (not yet linked to [Spell](spell.md) ids) because several monster spell types (`breath_fire`, `heal_self`, `heal_ally`, `poison`) don't have player-castable Spell records.

Common fields: `type` (string), `name` (string), `cast_chance` (int 0–100), `range` (int, omitted on `heal_self`).

Variant types and extras: `sleep` (`save_dc`, `duration`, `max_target_hp`), `curse` (`duration`, `ac_penalty`, `attack_penalty`), `poison` (`save_dc`, `damage_per_turn`, `duration`), `magic_dart` / `magic_arrow` / `lightning_bolt` / `fireball` / `breath_fire` (damage dice + optional `save_dc`), `heal_self` / `heal_ally` (heal dice).

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
- `tile` is **not** a Map Tile id — it's a sprite path string; monsters bypass [Map Tile](map_tile.md) entirely for their sprite

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
  "color": [120, 0, 60],
  "tile": "game/monsters/vampire_lord.png",
  "terrain": "land",
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
- **Monster `spells[]` stay inline.** Many monster-only spell types (`breath_fire`, `heal_self`, `heal_ally`, `poison`) don't have player-castable Spell records, so flipping `type` → `spell_id` would require either adding monster-only Spells (with empty `allowable_classes`) or a separate monster-spell catalog. Decision deferred; the inline duplication is the cost for now.
- **`difficulty: "boss"` is not in the standard difficulty enum** (`easy`/`normal`/`hard`/`deadly`). v1 used it deliberately so bosses are excluded from rolled encounter pools (placement is intentional, not random). Carried forward; either add `"boss"` to the enum officially or document the convention.
- **`tile` sprite paths are inconsistent.** Some records use `"game/monsters/<name>.png"` (path + extension), others `"monsters/<name>"` (no prefix, no extension). v1's loader normalized both; v2 carries the v1 strings as-is. Standardizing is a small future cleanup.
- **No id-based reference yet.** Encounters and Spawn lists reference monsters by `name`; same convention as elsewhere in v2.
