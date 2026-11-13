# FX

## Purpose

Tuning for the game's built-in **visual effects** — Hellfire, Lightning Bolt, Healing Sparkles, Dragon Breath and the rest. Each effect exposes the knobs it actually supports (colours, size, timing, particle counts); a module stores only the values it changes.

FX are the *visuals*. [Animations](animation.md) are the bundles spells / abilities / items pick (a visual + cast / hit sounds); an animation names an FX by its id in `visual`. Changing an FX here changes it everywhere it's used.

Edited in the editor under **Module data → FX**, which lists every effect, plays the selected one on a live preview stage, and updates the preview as settings change.

## Location

`web/public/modules/<module_id>/fx.json` — module-inheritable (a child module's record for an id replaces its parent's). Optional: with no file, every effect plays with its built-in defaults.

## File shape

```json
{
  "_comment": "optional",
  "fx": [
    { "id": "hellfire", "params": { "core": "#ffffff", "size": 1.4 } },
    { "id": "lightning_bolt", "params": { "color": "#ffe066", "width": 5 } }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | FX id (see the table below). Unknown ids are ignored. |
| `params` | object | Overrides. Colours are `"#rrggbb"`; numbers are clamped to the effect's allowed range. Unknown keys are ignored. |

## Effects and their settings

The authoritative list (names, ranges, defaults) is `FX_DEFS` in `web/src/vfx/fxCatalog.ts`.

| FX id | Name | Settings |
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

## Runtime

Battles load the module's merged `fx.json` (`seedBattleCaches` → `setFxOverrides`) and play every effect through the FX catalog, so a published change shows up in the next fight. The editor preview plays your unsaved values. Adding a brand-new effect is still a code change (a new `FX_DEFS` entry).
