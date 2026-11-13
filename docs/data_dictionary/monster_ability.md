# Monster Ability

## Purpose

The special attacks monsters use in combat: breath weapons, spells, bites, heals. Each record is one named, reusable ability: a combat **behavior**, its numbers, and the [FX](fx.md) it plays. Monsters list the abilities they use in their `abilities[]` array with a per-monster cast chance and optional overrides (see [Monster](monster.md)).

Separate from player [Spells](spell.md) on purpose: monster casts resolve through different combat code, and most monster abilities (breath, heal ally, venom) have no player equivalent.

Edited in the editor under **Module data → Monster Abilities**: behavior dropdown, FX dropdown with preview, plain number fields.

## Location

`web/public/modules/<module_id>/monster_abilities.json` — module-inheritable (a child module's record for an id replaces its parent's). Collection key `monster_abilities`.

## Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique id; what monster `abilities[].ability_id` references. |
| `name` | string | yes | Shown in the combat log ("Lich casts Hex at …"). |
| `description` | string | no | Designer notes. |
| `effect_type` | string | yes | Combat behavior — see the table below. |
| `damage_type` | string | `damage` | `fire`, `lightning`, `arcane`, `cold`, `poison`, `physical` (default). Resistances match on it — `fire_resistance` reduces `fire`. Also picks the default FX. |
| `fx_id` | string | no | [FX](fx.md) played when used. Unset → the behavior's default FX. |
| `range` | int | no | Reach in tiles (omit on `heal_self`). |
| `damage_dice` / `damage_sides` / `damage_bonus` | int | damage behaviors | Damage roll, e.g. 4d6+0. |
| `heal_dice` / `heal_sides` / `heal_bonus` | int | heal behaviors | Heal roll. |
| `save_dc` | int | no | Save DC. `damage`: DEX save, success halves the damage (omit for no save). `sleep`: WIS save negates. `poison`: CON save negates. |
| `duration` | int | status behaviors | Turns the status lasts. |
| `max_target_hp` | int | `sleep` | Targets above this HP are unaffected. |
| `ac_penalty` / `attack_penalty` | int | `curse` | Penalties while cursed. |
| `damage_per_turn` | int | `poison` | Poison damage each turn. |

A monster's link can override any of these (and `name`) for that monster only.

## Behaviors (`effect_type`)

| Behavior | What it does | Default FX |
|---|---|---|
| `damage` | Rolls the damage dice at one target. With `save_dc`, the target makes a DEX save (d20 + DEX modifier) — meeting the DC halves it. `damage_type` feeds resistances. Fire hits glow the caster and shake the screen (harder with a breath FX). | by `damage_type`: fire → Hellfire, lightning → Lightning Strike, arcane → Magic Dart, else Arcane Streak |
| `sleep` | AI skips targets above `max_target_hp`; WIS save vs `save_dc` or asleep for `duration` | — |
| `curse` | AC / attack penalties for `duration`; no save | Curse Aura |
| `poison` | CON save vs `save_dc` or poisoned (`damage_per_turn` for `duration`); immune targets don't roll | — |
| `heal_ally` | AI picks the most-hurt ally in range and heals them | Healing Sparkles |
| `heal_self` | Used only when the caster is hurt; heals the caster | Healing Sparkles |

The five older damage behaviors (`breath_fire`, `fireball`, `lightning_bolt`, `magic_dart`, `magic_arrow`) were identical in combat and were merged into `damage` (Nov 2026). They're still accepted when loading old data and map to `damage` with the matching `damage_type` and FX.

Log for a saved hit:

```
Red Dragon casts Fire Breath at Cameron!
Cameron dodges half the Fire Breath! (DEX save 17+2=19 vs DC 15)
Cameron takes 12 damage.
```

New behaviors are a code change (`MonsterSpellType` in `web/src/battle/data/monsters.ts` and `Combat.castMonsterSpell`); new abilities using existing behaviors are data only. `web/src/battle/data/monsterAbilities.test.ts` casts abilities of each behavior through the engine, including both save outcomes and fire resistance.

## Example

```json
{
  "id": "web",
  "name": "Web",
  "description": "Sticky webbing pins the target (sleep) unless it saves.",
  "effect_type": "sleep",
  "fx_id": "",
  "range": 5,
  "save_dc": 12,
  "duration": 2,
  "max_target_hp": 40
}
```

## Runtime

Play mode loads the module's merged catalog (`seedBattleCaches` → `setMonsterAbilities`) before monsters; the battle loaders fall back to fetching the file directly. `specFromRaw` resolves each `abilities[]` link (catalog record ⊕ link overrides) into the `MonsterSpell` the combat engine reads.
