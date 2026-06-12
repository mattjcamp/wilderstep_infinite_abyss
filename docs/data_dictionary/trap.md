# Trap

## Purpose

The trap catalog — every trap placed on a map resolves to a record here. A trap is a hidden cell hazard: the party steps onto the cell, the trap fires once (disarming itself), and the record's `trap_type` decides what happens — rolled damage, a status effect, or a teleport. Records are placed on maps via the cell's `trap_id` field (Cell Inspector → Trap dropdown in the map editor).

Legacy boolean trap cells (`trap: true`) and procedural dungeon traps (the `TILE_TRAP` prototype) resolve to the `dart_trap` record, so the old hardcoded 3+d6 behaviour is now data-driven and editable.

## Location

`web/public/modules/<id>/traps.json` — module-inheritable like every other catalog (child modules extend the base and override by record id).

## File shape

```
{
  "_comment": "optional authoring notes",
  "traps": [ <trap_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Stable identifier referenced by `tile.trap_id`. |
| `name` | string | yes | Display name, used in trigger log lines ("Dart Trap! …"). |
| `description` | string | no | Authoring note / flavour. Not shown to the player. |
| `trap_type` | string | yes | Resolution branch: `"damage"` rolls `damage_range` against the victim(s); `"effect"` applies `effect` with no damage; `"teleport"` moves the party to `params.teleport`. |
| `damage_type` | string | no | Flavour + VFX driver: `"fire"`, `"poison"`, `"piercing"`, `"magic"`, … Picks the burst colour and log wording. Reserved for future resistances (e.g. the `fire_resistance` effect). |
| `damage_range` | `{ min, max }` | for `damage` | Uniform damage roll per victim. Null for effect / teleport traps. |
| `effect` | string | no | [Effect](effect.md) id applied to each victim that fails the save (or every victim when no save is authored). Rides along on `damage` traps too — a poison dart deals damage AND poisons. |
| `params` | object | no | Per-trap knobs, see below. Null = defaults. |

## `params` sub-object

| Field | Type | Description |
|---|---|---|
| `targets` | `"one"` \| `"all"` | Who gets hit: one random alive member (default) or every alive member. Ignored by `teleport` (the whole party moves). |
| `save_stat` | string | Ability score for the avoidance save: `"dexterity"`, `"wisdom"`, … When present with `save_dc`, each victim rolls d20 + stat modifier; pass = half damage (rounded down) and no effect. |
| `save_dc` | number | DC for the save roll. |
| `teleport` | `{ map_id, col, row }` | `teleport` traps only — destination cell. Same map teleports in place; another map traverses like a link. |

## Behaviour notes

- **One-shot.** A trap fires once and disarms. Triggered overworld traps persist per map in the save (`SavedMapState.triggeredTraps`), so they stay disarmed across reloads and map re-entry. Dungeon traps persist via the dungeon session's `triggeredTraps` (unchanged).
- **Detection.** Detect Traps reveals armed trap cells (boolean or `trap_id`) within the party's light radius — same overlay as before.
- **Misauthored records** (unknown `trap_id`, missing `damage_range` on a damage trap, bad teleport target) degrade gracefully: the trap fizzles with a log line rather than crashing the step.

## Cross-references to other models

- `effect` → [Effect](effect.md) id
- `params.teleport.map_id` → [Map](map.md) id
- Placed by painted cells via `tile.trap_id` (see [Map](map.md) cell fields)

## Example record

```json
{
  "id": "poison_dart_trap",
  "name": "Poison Dart Trap",
  "description": "A dart coated in greenish venom.",
  "trap_type": "damage",
  "damage_type": "poison",
  "damage_range": { "min": 2, "max": 6 },
  "effect": "poisoned",
  "params": { "targets": "one", "save_stat": "dexterity", "save_dc": 12 }
}
```
