# Character

## Purpose

A person who can join a Party — the unit of identity for player characters and recruitable companions. Each Character carries class, race, gender, base stats, starting equipped gear, a personal inventory bag, and a sprite.

This file holds **starting state** — the data needed to construct a Character when the module first loads or a new playthrough begins. Live state (HP/MP changes during play, XP gained, gear swapped, levels gained) lives in the runtime [Game](game.md) save, not here.

Characters are not embedded in [Party](party.md) anymore. Party references Characters by id via its `roster` array — every roster entry is in the active adventuring group.

## Location

`web/public/modules/default/characters.json` — real data drives the schema.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

```
{
  "_comment": "optional authoring notes",
  "characters": [ <character_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"aldric"`, `"pippin"`). Referenced by [Party](party.md) `roster`. | TBD |
| `name` | string | yes | Display name (e.g. `"Aldric"`) | TBD |
| `class` | string | yes | Character Class id (snake_case, e.g. `"fighter"`, `"wizard"`) — see [Character Class](character_class.md) | TBD |
| `race` | string | yes | Race id (snake_case, e.g. `"human"`, `"halfling"`) — see [Race](race.md) | TBD |
| `gender` | string | no | `"Male"` / `"Female"`; cosmetic on the character sheet | TBD |
| `level` | int | yes | Starting level (typically 1) | TBD |
| `exp` | int | yes | Starting cumulative XP (typically 0) | TBD |
| `hp` | int | yes | Starting HP (also seeds max HP via the runtime) | TBD |
| `mp` | int | yes | Starting MP (also seeds max MP via the runtime) | TBD |
| `strength` | int | yes | Post-race STR — already includes racial modifiers from [Race](race.md).`stat_modifiers` | TBD |
| `dexterity` | int | yes | Post-race DEX | TBD |
| `constitution` | int | yes | Post-race CON | TBD |
| `intelligence` | int | yes | Post-race INT | TBD |
| `wisdom` | int | yes | Post-race WIS | TBD |
| `equipped` | object | no | Equipment slot map. Slots: `hands` (weapon — one slot per character; two-handed weapons still occupy just `hands`), `body` (armor). Values are [Item](item.md) names. | TBD |
| `inventory` | object[] | no | Personal bag (separate from the party's shared stash). Each entry is `{ item, charges?, durability? }` where `item` is an Item name. | TBD |
| `sprite` | string | no | Asset path relative to the assets directory (e.g. `"characters/fighter.png"`) | TBD |

## Cross-references to other models

- `class` → [Character Class](character_class.md) id
- `race` → [Race](race.md) id
- `equipped.*` values → [Item](item.md) name
- `inventory[].item` → [Item](item.md) name
- Referenced *by* [Party](party.md) `roster[]` (array of Character ids)

## Example record

```json
{
  "id": "aldric",
  "name": "Aldric",
  "class": "fighter",
  "race": "human",
  "gender": "Male",
  "level": 1,
  "exp": 0,
  "hp": 16,
  "mp": 0,
  "strength": 16,
  "dexterity": 11,
  "constitution": 12,
  "intelligence": 8,
  "wisdom": 8,
  "equipped": { "hands": "Club", "body": "Cloth" },
  "inventory": [],
  "sprite": "characters/fighter.png"
}
```

## Notes and open questions

- **Class and race fields use ids, not display names.** This is a small consistency break from the rest of v2 (Party's `inventory[].item`, Counter's `items[]`, Recipe's `reagents` keys all still use display names for [Item](item.md)). Character is a new model and uses the id-based pattern from the start; the rest of v2 should follow on a sweep.
- **Stat lines are post-race.** v1's convention was that racial modifiers from [Race](race.md) are baked into the stored stat values. The runtime doesn't re-apply them on load. If v2 wants to derive stats from a base + race delta, this needs to flip and a `base_<stat>` shape needs to live here instead.
- **Live state vs. starting state.** Everything in this file represents the character at start-of-game. Mid-playthrough state (HP that has been damaged, XP earned, gear changes) lives in the runtime [Game](game.md) save. The two need a clean serialization contract once Game is filled in.
- **Equipped slots are minimal.** v1 had `right_hand`, `left_hand`, and `head` slots; the left-hand and head slots were never surfaced by the v1 PartyScene UI and the loader silently migrated their contents back to inventory. v2 collapses what survived (the right hand) into a single `hands` slot — a weapon is held in `hands` regardless of one- or two-handedness. If shield / off-hand / helm slots come back, re-introduce here.
- **Sprite paths are relative.** v1's seed had absolute-ish paths under `src/assets/game/...` that failed v1's loader prefix check and fell through to class defaults. v2 stores `characters/<class>.png` (relative to the assets directory); the runtime asset pipeline will need to map this to served URLs.
- **No `abilities` or `known_spells` arrays yet.** Class-granted abilities live on [Character Class](character_class.md). Spell access is derived: a character can cast any spell whose `casting_type` is in their class's `casting_type[]`, gated by `min_level` (or `class_min_levels[class_name]`). If a character has unique acquired abilities or spells (e.g. learned from a quest, granted by an artifact), a future `granted_effects` / `granted_spells` array on Character would be the right home.
