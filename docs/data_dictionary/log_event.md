# Log Event

## Purpose

Authored lines of text that appear in the exploration log (the left-hand panel on the play screen, and the L Adventure Log) a set number of steps after the party enters a map. Use them for a tutorial, or a description that unfolds as the party explores.

Edited under **Module data → Log Events** in the editor.

## Location

`web/public/modules/<id>/log_events.json` — module-inheritable like every other catalog (child modules extend the base and override by record id).

## File shape

```
{
  "_comment": "optional authoring notes",
  "log_events": [ <log_event_record>, ... ]
}
```

## Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Stable identifier. Also keys which lines a save has already seen, so renaming it makes "once" lines show again. |
| `name` | string | no | Editor label. Not shown to the player. |
| `map_id` | string | yes | The [Map](map.md) these lines belong to. |
| `repeat` | `"once"` \| `"every_visit"` | no | `"once"` (default): each line appears a single time per save. `"every_visit"`: lines appear again every time the party arrives on the map. |
| `entries` | `{ steps, text }[]` | yes | The lines. `steps` is the number of moves the party has made on the map since arriving (`0` = the moment it arrives); `text` is what appears in the log. Lines sharing a step appear together, in authoring order. Blank lines are skipped. |

## Runtime notes

- **On screen, not just in the log.** Lines due at the same moment also appear together on a large card at the top-center of the play screen, and the card stays up until the party moves (moves in the first 1.2 seconds don't count, so a held arrow key can't skip it). The card's heading is the map's name — or **Tip** when every line starts with `Tip:` (the prefix is dropped on the card, kept in the log). Cards queue behind any other placard, e.g. a New Quest notification.

- The step counter restarts whenever the party arrives on a map, so with `"once"` a line the party walked off the map before reaching shows on a later visit, counted from that arrival.
- Waiting in place doesn't count as a step, and steps taken inside a dungeon don't count toward the surface map.
- Lines already shown are recorded on the save in `logEventsShown` as `<id>#<entry index>`, so reordering entries in a published module can re-show or skip lines on existing saves.
