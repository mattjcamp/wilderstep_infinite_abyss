# Data dictionary

This folder documents the canonical data models for Wilderstep: Infinite Abyss (v2). Each model gets its own markdown doc describing what the model is for, what its fields mean, how it relates to other models, and an example record.

The data files live under `web/public/` so the running app can fetch them directly. Shared data (used by every module) lives in `web/public/data/` — currently `character_classes.json`, `races.json`, `map_tiles.json`. Per-module data lives in `web/public/modules/<module_id>/` — currently a placeholder `default` module containing everything else. This split mirrors the architecture plan; see `docs/dev_guides/game_architecture_plan.md` for the rationale. The data drives the schema — there is no separate schema spec layer; the dictionary docs in this folder play that role for humans.

## How to read these docs

Each doc follows the same structure: **Purpose**, **Location**, **Scope of this document**, **File shape**, **Fields** (table with a "Used?" implementation column), **Polymorphic discriminators**, **Cross-references to other models**, **Example record**, and **Notes and open questions**.

When you're looking up "what does field X on model Y mean," go straight to the Fields table. When you're trying to clean things up or revisit a decision, scan the "Notes and open questions" section.

The v2 codebase is just being built. The **Used?** column is `TBD` everywhere for now; it will be filled in as fields are wired up in the TypeScript implementation under `web/`.

## Models

| Model | Doc | Purpose |
|---|---|---|
| Effect | [effect.md](effect.md) | Unified model for abilities, statuses, passives, and on-hit triggers; ported from v1 and decoupled from its granters |
| Spell | [spell.md](spell.md) | Castable spell-actions (damage, heal, apply_effect, summon, etc.); ported from v1 |
| Recipe | [recipe.md](recipe.md) | Brew options as id + name + reagents-map; ported from v1 (DC/result deferred) |
| Item | [item.md](item.md) | Weapons, armor, consumables, reagents, scrolls, keys, quest items; ported from v1 |
| Counter | [counter.md](counter.md) | Shops and temples — stock lists or service menus; ported from v1 |
| Monster | [monster.md](monster.md) | Monster catalog with stats, spells (inline), Effect-id passives + on-hit triggers; ported from v1 |
| Race | [race.md](race.md) | Playable races — stat modifiers, optional XP override, racial ability Effect ids; ported from v1 |
| Character Class | [character_class.md](character_class.md) | The eight playable classes — HP/MP growth, allowed races, MP source, non-spell class abilities; ported from v1 |
| Character | [character.md](character.md) | Character catalog — class, race, base stats, starting gear; referenced by Party.roster/active_party by id |
| Party | [party.md](party.md) | Starting party seed (singleton) — references Character ids; party-wide gold, effect slots, shared inventory |
| NPC | [npc.md](npc.md) | TBD |
| Encounter | [encounter.md](encounter.md) | Named monster rosters for the random-encounter sampler, with area discriminator; ported from v1 |
| Spawn | [spawn.md](spawn.md) | Monster-lair behavior bound to a map tile id; ported from v1 |
| Map Tile | [map_tile.md](map_tile.md) | The tile catalog — display, walkability, sprite, lighting flags, interaction metadata; ported from v1 |
| Map | [map.md](map.md) | Unified model for authored maps (overworld, towns, buildings, detail screens, battle screens) |
| Dungeon Config | [dungeon_config.md](dungeon_config.md) | Procedural dungeon generator inputs (not authored tile data) |
| Quest Step | [quest_step.md](quest_step.md) | TBD |
| Quest Config | [quest_config.md](quest_config.md) | TBD |
| Module | [module.md](module.md) | The canonical definition of an adventure — a template a Game is instantiated from |
| Game | [game.md](game.md) | Runtime instance of a Module; a save file is a serialized Game |

## Cross-model relationships

TBD. As models gain fields, this section will summarize the reference graph (which models point at which by id, which collections live per-module vs. globally, etc.). For the architectural overview that motivates these relationships, see `docs/dev_guides/game_architecture_plan.md`.

## Common cleanup candidates

(Placeholder, mirroring the v1 dictionary structure. Nothing to flag yet — v2's schema is starting fresh.)
