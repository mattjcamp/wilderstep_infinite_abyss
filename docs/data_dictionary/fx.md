# FX

## Purpose

Every named effect the game can play. An FX record bundles three things:

1. **A visual** — one of the game's built-in effects (Hellfire, Lightning Bolt, Healing Sparkles, Dragon Breath…), or `none` for a sound-only FX.
2. **Tuning** for that visual — colours, size, timing, particle counts; only the knobs that visual supports.
3. **Sounds** — one played when the effect starts (`cast_sfx`) and one on impact (`hit_sfx`).

Spells, items, effects, abilities and monster spells point at an FX by `fx_id`, picked from a dropdown in their editors. Change an FX and it changes everywhere it's used. Several FX can share a visual: "Lightning Strike" and a hypothetical "Lich Bolt" can both draw `lightning_bolt`, tuned differently.

FX replaced the older two-part setup (tuning-only `fx.json` + `animations.json` bundles referenced by `animation_id`). Everything that used `animation_id` now uses `fx_id`, with the same ids.

Edited in the editor under **Module data → FX**: pick an FX to watch it play with its sounds, change its visual, tune it, set its sounds, and create / duplicate / delete FX. The page shows which records use each FX.

## Location

`web/public/modules/<module_id>/fx.json` — module-inheritable (a child module's record for an id replaces its parent's whole record). The Default module ships the base catalog.

## File shape

```json
{
  "_comment": "optional",
  "fx": [
    {
      "id": "lightning_strike",
      "name": "Lightning Strike",
      "description": "Jagged blue-white zigzag drawn from caster to target.",
      "visual": "lightning_bolt",
      "params": { "width": 5 },
      "cast_sfx": "fireball",
      "hit_sfx": "explosion"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique id. What `fx_id` fields reference. |
| `name` | string | yes | Display name in the FX page and dropdowns. |
| `description` | string | no | Notes for designers. |
| `visual` | string | no | Built-in visual id (table below) or `"none"`. Defaults to `id`, so an old tuning-only record (`{ "id": "hellfire", "params": {…} }`) still works. |
| `params` | object | no | Tuning for the visual. Only values that differ from the visual's defaults are stored. Colours are `"#rrggbb"`; numbers are clamped to the visual's range; unknown keys are ignored. |
| `cast_sfx` | string | no | Sound played at the start. A name from `web/src/battle/audio/Sfx.ts`; `""` = silent. |
| `hit_sfx` | string | no | Sound played on impact. Same rules. |

## Built-in visuals and their settings

The authoritative list (names, ranges, defaults) is `FX_DEFS` in `web/src/vfx/fxCatalog.ts`. Adding a brand-new visual is a code change; adding a new FX that uses an existing visual is data only.

| Visual id | Name | Settings |
|---|---|---|
| `projectile_line` | Arcane Streak | color, duration_ms |
| `fire_projectile` | Fire Streak | color, duration_ms |
| `lightning_bolt` | Lightning Bolt | color, width, segments, jitter, fade_ms |
| `meteor_strike` | Meteor Strike | color, duration_ms |
| `magic_dart` | Magic Dart | color, duration_ms |
| `magic_arrow` | Magic Arrow | color, duration_ms |
| `void_orb` | Void Orb | duration_ms (palette fixed) |
| `hellfire` | Hellfire | outer, body, ember, core, smoke, size, flight_ms (0 = by distance) |
| `breath_of_fire` | Dragon Breath | fire, ember, width, duration_ms |
| `heal_sparkles` | Healing Sparkles | color, accent, count |
| `buff_aura` | Buff Aura | color, radius, width, duration_ms |
| `curse_aura` | Curse Aura | color, radius, width, duration_ms |
| `radial_burst` | Radial Burst | color, ember, radius |
| `explosion_burst` | Explosion | color, ember, radius |

## Who references FX

| Record | Field | Notes |
|---|---|---|
| [Spell](spell.md) | `fx_id` | Played on cast. |
| [Item](item.md) | `fx_id` | E.g. a relic ranged weapon's shot. Ranged weapons with no `fx_id` fall back to an FX picked by `damage_type` (lightning → Lightning Strike, fire → Fireball Burst, meteor → Meteor Strike, arcane → Magic Dart, ice / frost / light → Magic Arrow). |
| [Effect](effect.md) | `fx_id` | Played when applied. |
| [Ability](ability.md) | `fx_id` | Played on use. |
| [Monster](monster.md) | `spells[].fx_id` | Per monster spell. Unset → a per-type default (see Monster). |

Traps don't play FX yet — overworld trap triggers have no visual or sound playback.

## Runtime

Play mode loads the module's merged `fx.json` (`seedBattleCaches` → `setFxRecords`); the editor's battle simulator falls back to the Default module's file. `getFxRecord(id)` resolves a record; `playFx(id, …)` draws its visual with its tuning. A bare built-in visual id with no record of its own still resolves (defaults, silent). The editor preview plays your unsaved values.
