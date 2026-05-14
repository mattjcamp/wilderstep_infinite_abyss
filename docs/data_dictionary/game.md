# Game

## Purpose

A runtime instance of a Module. Carries the Module's current state as it changes over the game lifecycle: the Characters in the current Party, the party's position on a Map, quest progress, counter values, flags, any procedurally generated dungeon Maps, and anything else that diverges from the Module's starting state. A save file is a serialized Game.

## Location

No static JSON file. A Game is a runtime save — the serialized form of a Module instance plus all accumulated state (party position, HP/MP, quest progress, generated dungeon maps, etc.). v2 will define the save format in TypeScript and persist via the SaveProvider (likely localStorage to start). This doc is a placeholder.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up.

## File shape

The canonical stub is a single example record:

```json
{
  "id": "",
  "name": ""
}
```

The on-disk representation in a real module will collect many records of this type (see `docs/dev_guides/game_architecture_plan.md` for the per-module file layout). The shape of that collection file is TBD.

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Unique identifier for this record, scoped to its module | TBD |
| `name` | string | yes | Human-readable display name | TBD |

## Polymorphic discriminators

TBD.

## Cross-references to other models

TBD. As fields are added, this section will list which other models this one points at (by id) and which models reference it.

## Example record

```json
{
  "id": "",
  "name": ""
}
```

## Notes and open questions

- Schema is a placeholder. Fields beyond `id` and `name` are still to be decided.
