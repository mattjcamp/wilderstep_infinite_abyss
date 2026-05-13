# Data dictionary

This folder documents the canonical data models for Wilderstep: Infinite Abyss (v2). Each model gets its own markdown doc describing what the model is for, what its fields mean, how it relates to other models, and an example record.

The canonical schema stubs themselves live in `data_model/` at the repo root. The on-disk JSON files that ship inside a module (collections of records of each model type) are described in `docs/dev_guides/game_architecture_plan.md`.

## How to read these docs

Each doc follows the same structure: **Purpose**, **Location**, **Scope of this document**, **File shape**, **Fields** (table with a "Used?" implementation column), **Polymorphic discriminators**, **Cross-references to other models**, **Example record**, and **Notes and open questions**.

When you're looking up "what does field X on model Y mean," go straight to the Fields table. When you're trying to clean things up or revisit a decision, scan the "Notes and open questions" section.

The v2 codebase is just being built. The **Used?** column is `TBD` everywhere for now; it will be filled in as fields are wired up in the TypeScript implementation under `web/`.

## Models

| Model | Doc | Purpose |
|---|---|---|
| Effect | [effect.md](effect.md) | TBD |
| Spell | [spell.md](spell.md) | TBD |
| Recipe | [recipe.md](recipe.md) | Crafting recipes — ingredients, tools/stations, and the resulting Item |
| Item | [item.md](item.md) | Items including weapons, armor, consumables; potions are a subtype |
| Counter | [counter.md](counter.md) | TBD |
| Monster | [monster.md](monster.md) | TBD |
| Race | [race.md](race.md) | TBD |
| Character Class | [character_class.md](character_class.md) | TBD |
| Character | [character.md](character.md) | TBD |
| Party | [party.md](party.md) | TBD |
| NPC | [npc.md](npc.md) | TBD |
| Encounter | [encounter.md](encounter.md) | TBD |
| Spawn | [spawn.md](spawn.md) | TBD |
| Map Tile | [map_tile.md](map_tile.md) | TBD |
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
