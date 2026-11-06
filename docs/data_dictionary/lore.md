# Lore

## Purpose

A piece of world writing the party can find and read: a history, a letter, a legend, an inscription. Each record is a titled series of paragraphs. The **first** time the party reads a lore record it is added to their **Journal** (the `J` key) and every living party member earns experience. Re-reading is always free.

## Location

`web/public/modules/<module_id>/lore.json` — `{ "lore": [ ... ] }`. Edited in the editor's **Lore** node (paragraph editor, tag chips, XP).

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Unique identifier, referenced by map cells and items. | Yes |
| `name` | string | no | Title shown on the reading screen and in the journal. Falls back to the id. | Yes |
| `tags` | string[] | no | **Player-facing** labels ("History", "The Orc Wars", "Letters"). The journal lists them as filters, so players can find related lore quickly. | Yes |
| `xp` | int | no | Experience each living party member earns on the **first** read. Default **25**; `0` turns it off. | Yes |
| `paragraphs` | string[] | yes | The text, one entry per paragraph, read top to bottom. Blank entries are skipped. (Hand-written JSON may instead give a single `text` string; blank lines split it into paragraphs.) | Yes |

## How players discover lore

| Where | How to author | What the player does |
|---|---|---|
| **Map object** | In the Map Editor, set a cell's **Lore** to the record's id (a bookshelf, plaque, gravestone, statue…). | Bumps the cell; the party stays put and the reading screen opens. Works on walkable and non-walkable tiles. |
| **Readable item** | Give an Item a `lore` field with the record's id (a book, a scroll, a letter). Books live in the `books` item category, one item per lore record (e.g. `book_chronicle_willowbrook` → `chronicle_of_willowbrook`). | Uses it from the Party screen (shared stash or a character's pack). The item is **not** consumed and can be read again. |

The reading screen shows the title, tags and paragraphs, and on a first read a "+N XP" note. The read is saved (`party.readLore` in the save) the moment the screen opens.

## The Journal (`J`)

Lists every lore record the party has read, newest first, with:
- tag filter chips (built from the tags of the lore discovered so far),
- a search box (title, tags and text),
- the full text of the selected entry.

Lore that is later removed from the module simply drops out of the journal.

## Cross-references to other models

- Referenced *by* map cells: `cell.lore` → Lore `id` ([Map](map.md), [Map Tile](map_tile.md)).
- Referenced *by* items: `item.lore` → Lore `id` ([Item](item.md)).

## Example record

```json
{
  "id": "fall_of_kel_marrow",
  "name": "The Fall of Kel Marrow",
  "tags": ["History", "The Orc Wars"],
  "xp": 25,
  "paragraphs": [
    "Kel Marrow stood for three hundred years at the edge of the Ashen Wood.",
    "When the orc host came down from the passes, the gates held for nine days."
  ]
}
```
