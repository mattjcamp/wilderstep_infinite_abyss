# Module

## Purpose

The canonical definition of an adventure. Contains all the custom schema that define the game world using the other data models. Think of a Module as a template — static content authored once and shipped.

## Location

Each module ships its own `module.json` at the root of its folder — `web/public/modules/<module_id>/module.json`. A provisional record exists at `web/public/modules/default/module.json` as a placeholder while the Module data model is being designed. This doc is a placeholder.

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

### Manifest text fields (`module.json`)

These are live today, edited in the editor's **Module Properties** dialog.

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `title` | string | yes | The module's display name — module cards, the play picker, and the beginning screen heading. | Yes |
| `description` | string | no | What the module is, at a high level — a player-facing pitch shown on the module card and the play picker. | Yes |
| `trailer` | string | no | **Playable modules.** The dramatic opening shown full-screen on the beginning screen (under the title, before "Press any key to begin") when a new game starts. Line breaks are kept. When absent or blank, the beginning screen shows `description` instead, so older modules keep working. The Module Properties dialog only shows this field for playable modules; other roles keep any value they already have. | Yes |

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
