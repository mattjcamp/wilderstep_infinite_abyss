# Editor Usability Audit

*June 2026. Scope: every authoring surface under `web/src/editor/` and
`web/app/editor/`. Motivation: module authoring is heading toward
non-developer users, who cannot be expected to hand-edit JSON. This
audit inventories where the editors line up, where they drift, and —
the headline issue — exactly which fields still drop authors into a
raw JSON textarea.*

## 1. How the editor system is structured

Two parallel widget systems exist today:

**System A — the model registry pipeline.** `src/data_model/models.ts`
declares every catalog; `ModelView.tsx` renders the browse table
(free-text search, click-to-sort columns, tag filter, sprite
thumbnail column, draft badge, Publish, per-record JSON dump,
add/edit/delete); `RecordForm.tsx` auto-generates the edit form by
inferring each field's type from the record. Custom field editors are
injected by field-config lookups: SpritePicker, AnimationPicker,
CounterPicker, MapPicker, TagsPicker, DialogsEditor (npcs.dialogs).
Everything the lookups don't catch falls back by type — strings get
inputs, numbers get number inputs, booleans get checkboxes, and
**arrays/objects get a raw JSON textarea with parse-only validation**
(no shape checking; a typo in structure saves fine and fails silently
in play).

**System B — the Map Editor's Cell Inspector.** A separate, hand-built
widget set: `InspectorRow`, `BoolEditor`, `NumberEditor`,
`StringEditor`, `SelectEditor`, `LinkEditor`, `PressurePlateEditor`,
`PaletteTilePicker`. Richer than System A (palette-default
annotations, per-field "modified" pills + reset, tag-grouped pickers
with sprite thumbnails) but shares no code with it.

Routing (`app/editor/[moduleId]/[modelKey]/page.tsx`): 15 models use
the generic ModelView; 5 have custom browse components —
CharactersBrowse, DungeonsBrowse, MapsBrowse, PartyBrowse,
QuestsBrowse — each with its own layout, save flow, and delete copy.

## 2. The headline problem: raw-JSON exposure

Measured against the default module's data, these fields render as
JSON textareas in the record form. Count = records in the default
module actually carrying the field (real-world exposure, not
theoretical):

| Model | Field | Records | What an author is hand-typing |
|---|---|---|---|
| encounters | `monsters` | **63** | array of monster ids |
| items | `slots` | **32** | array of slot ids |
| spells | `usable_in` | **21** | array of context enums |
| spells | `action_params` | **20** | free-form params object |
| monsters | `spells` / `passives` / `on_hit_effects` | 12 / 9 / 7 | id arrays + param objects |
| abilities | `params` / `usable_in` | 11 / 6 | params object + enum array |
| recipes | `reagents` | 10 | item-id → count map |
| effects | `params` | 9 | params object |
| character_classes | `casting_type` / `allowable_item_types` / `abilities` | 8 / 8 / 6 | enum arrays + ability-link objects |
| items | `combat_aura` / `wielder_passives` / `contents` | 7 / 1 / 1 | structured objects |
| counters | `items` / `services` | 6 / 1 | stock rows / service rows |
| spawns | `spawn_monsters` / `boss_monsters` / `loot` | 6 each | monster-id arrays, loot table |
| races | `stat_modifiers` / `abilities` | 5 / 5 | stat → number map, id array |
| traps | `params` / `damage_range` | 4 / 3 | params object, {min,max} |
| characters | `equipped` / `inventory` | 4 / 4 | slot → item map, item rows |
| quests | `steps` / `quest_giver` / `rewards` | 1 each | deep nested objects |
| dungeons | `size` / `levels` | 1 each | partially covered by DungeonsBrowse |

Clean models (no JSON exposure): animations, map_tiles, npcs (since
the DialogsEditor landed — and its "bare object instead of array"
incident is the proof-of-concept for why this list matters: the
browse table even *counted the object's keys* as 3 dialogs).

The pattern behind nearly all of it is small: **(a) pick-many-ids
from a catalog** (monsters, abilities, items, slots, enums), **(b)
id → number maps** (reagents, stat_modifiers), and **(c) per-record
params objects** (effects/abilities/spells/traps). Three reusable
widgets cover ~90% of the table above.

## 3. Consistency findings

1. **Two widget systems, no shared parts.** RecordForm and the Cell
   Inspector implement selects, bools, numbers, and strings twice,
   with different visuals and behaviors. Concretely user-visible:
   the Cell Inspector's map pickers (Link, Pressure Plate) group maps
   by tag with a custom-id escape hatch; RecordForm's `MapPicker` is
   a flat list with neither. Same task, two experiences.
2. **Button label drift.** Custom browses use "+ New Quest" / "+ New
   Map" / "+ New Dungeon" / "+ New Character"; ModelView and inner
   lists use bare "+ Add" / "+ Add Step" / "+ Add Level".
3. **Delete confirmations** all use `window.confirm` but the copy
   varies from a bare "Discard all draft edits for this model?"
   (ModelView) to MapsBrowse's detailed draft-vs-publish explanation.
   Some explain consequences; most don't.
4. **Validation is parse-only.** RecordForm rejects invalid JSON
   syntax but accepts any shape; nothing cross-checks ids (a typo'd
   monster id in an encounter saves silently). The RecordForm header
   comment already anticipates "a Zod layer" — it never arrived.
5. **Draft/publish affordances differ by surface.** ModelView and the
   custom browses each wire their own draft badge + publish button +
   "saved to draft" messaging; phrasing differs ("Saved to the draft —
   Publish when ready" vs. badge-only). Now that play is strictly
   published-only, the *visibility of unpublished-draft state* is the
   thing standing between an author and "why isn't my edit in the
   game" — it deserves identical, prominent treatment everywhere.
6. **Browse affordance gaps.** ModelView's search/sort/filter/thumbnail
   column come free for registry models, but the custom browses
   each reimplement a subset (e.g. not all have free-text search or
   sortable columns), so capability depends on which model you're in.
7. **Terminology drift.** "Record", "entry", "item", and the domain
   noun are used interchangeably across surfaces.

## 4. What's already good (patterns to standardize on)

- The **Cell Inspector** row pattern: label + palette default +
  modified pill + reset, and its tag-grouped, thumbnail-bearing
  pickers (PaletteTilePicker, the Link/plate map picker).
- **Injected field editors** in RecordForm (SpritePicker → …
  → DialogsEditor). The injection seam works; it just needs more
  tenants.
- **DialogsEditor** as the template for structured-array editing:
  cards with add/remove/reorder, inline empty-text warning, canonical
  shape emitted on save (it actively repairs malformed records).
- The browse-table conventions in ModelView (search, sort, thumbnail,
  draft badge) — the custom browses should converge on these, not
  diverge from them.

## 5. Recommendations, prioritized

**P1 — kill the worst JSON textareas with two generic widgets.**
1. ✅ **SHIPPED** — `IdListPicker` (src/editor/IdListPicker.tsx +
   idListFields.ts): chips + filterable catalog panel with sprite
   thumbnails, unknown-id preservation, duplicates only where
   rosters need them. Covers encounters.monsters (63), spawns
   spawn/boss_monsters + loot, races.abilities, items.slots,
   spells/abilities.usable_in (static enums), character_classes
   casting_type / allowable_item_types (distinct-values source).
   Catalog options load through StaticModuleSource, so module
   inheritance applies (an improvement over the older pickers,
   which hardcode the base module). NOT covered (object-shaped,
   need their own editors): character_classes.abilities links,
   monsters.spells blocks.
2. ✅ **SHIPPED** — `KeyMapEditor` (src/editor/KeyMapEditor.tsx +
   keyMapFields.ts), generalised from "KeyCountEditor" to cover id
   values too: recipes.reagents (item → count, options filtered to
   reagent/herb items with icons), races + character_classes
   stat_modifiers (fixed five-stat rows, negatives allowed),
   characters.equipped (slot → item id via the shared option panel).
   Shares the option loader + filter panel with IdListPicker
   (`useIdOptions` / `IdOptionPanel`), so all id-picking surfaces
   stay visually and behaviourally identical.

**P2 — params objects.** ✅ **SHIPPED** — `ParamsEditor`
(src/editor/ParamsEditor.tsx) driven by per-model vocabularies
(paramsFields.ts), covering ALL four surfaces in one pass:
effects.params, abilities.params, traps.params, AND
spells.action_params (the vocabulary turned out tractable, so it
wasn't deferred). Typed rows per knob — number / string / enum
(stats, sfx catalog, one|all) / single-id pickers (effect_id) /
id-lists (terrain tiles, cure_effects) / a map-cell block for
teleport destinations — each with inline help text; unknown keys
render as marked "custom" JSON rows, and a custom-key escape hatch
covers knobs the vocabulary hasn't met. A data-driven test walks the
default module's records and FAILS if data ever uses a params key
the vocabulary doesn't declare, so typed coverage can't silently
rot. Declared-complex values (spells' `creature` block) stay JSON
by design.

**P3 — unify the duplicated widgets.** Extract the tag-grouped map
picker into a shared component used by both LinkEditor/
PressurePlateEditor and RecordForm's MapPicker; longer-term, migrate
Cell Inspector primitives and RecordForm primitives toward one set.

**P4 — uniform shell conventions.** ✅ **SHIPPED** —
`src/editor/editorShell.tsx` is now the single source for shell
copy, applied across ModelView, Characters/Dungeons/Maps/Quests
browses, and the Map Editor:
- Record creation reads "+ New <Thing>" everywhere (singular labels
  from `singularModelLabel` in models.ts; ModelView's bare "+ Add"
  and its "Delete record" copy were the offenders). Convention:
  "+ New X" creates a catalog record; "+ Add x" appends inside one
  (steps, levels, dialog lines, list entries).
- `deleteRecordConfirmMessage` — every delete confirm names the
  thing and states the draft-vs-published consequence; the
  previously consequence-free confirms (dungeon levels, quest
  steps) now carry it too.
- `discardDraftConfirmMessage` — one phrasing for every model file.
- `DraftBanner` — the standard unpublished-draft bar ("the game
  plays published files; press Publish") rendered under the header
  of every draft-bearing browse.
Remaining (niche, untouched): ModulePicker's module-delete confirm
(intentionally multi-bullet — different semantics), LibrariesPanel's
manifest discard, PartyBrowse (no draft lifecycle of its own).

**P5 — validation layer.** Zod (or hand-rolled) schemas per model:
shape validation on save + id cross-reference warnings ("monster
'gobblin' not found in monsters.json"). This also unlocks honest
error display in the JSON-textarea fallbacks that remain.

**Addendum (post-audit fix): raw JSON dumps removed from browses.**
✅ The expanded-record view in ModelView (and the Party singleton
view) used to render `JSON.stringify` dumps — the surface that
*displayed* the malformed King's Messenger dialogs while its count
column said "3". Both now render `RecordSummary`
(src/editor/RecordSummary.tsx): a read-only property sheet —
scalars as text, id arrays comma-joined, object arrays as
"N entries: <names>", nested objects as shallow key: value pairs.
No JSON-view toggle by design: authors read the sheet; developers
open the file in their own editor.

## 6. Suggested sequencing

P1.1 IdListPicker → immediately de-risks the single biggest authoring
surface (encounters) → P1.2 KeyCountEditor → P4 shell pass (cheap,
high perceived polish) → P2 ParamsEditor pilot on traps → P3 picker
unification → P5 validation. Each step is independently shippable.
