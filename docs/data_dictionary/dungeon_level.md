# Dungeon Level

## Purpose

One floor of a procedurally generated [Dungeon](dungeon.md). A Dungeon Level carries its own identity (id, display name, depth) plus *optional overrides* of any of the parent Dungeon's generator parameters. Floors without overrides simply inherit the parent's defaults; floors that vary set only the fields they care about.

Dungeon Levels are **inline objects under their parent Dungeon's `levels[]`**, not a separate top-level catalog. They have no meaning outside the Dungeon that owns them and aren't referenced by any other model.

## Location

Inline under [Dungeon](dungeon.md) records in `web/public/modules/default/dungeons.json`. The `dungeon_levels.json` file is a deprecated stub kept empty so old fetches don't 404.

## Scope of this document

The "Used?" column reflects the v2 TypeScript implementation under `web/`. The codebase is in its early stages, so every field is currently `TBD` until it is wired up. This model is a **stub** — the generator that consumes these parameters hasn't been written yet.

## Inline shape

Each entry in a parent Dungeon's `levels[]` is an object with the fields below.

## Fields

| Field | Type | Required | Description | Used? |
|---|---|---|---|---|
| `id` | string | yes | Stable identifier in snake_case (e.g. `"crypt_of_dagorn_l1"`). Unique within the parent Dungeon's `levels[]`. Convention: `<dungeon_id>_l<depth>`. | TBD |
| `name` | string | yes | Display name shown to the player when entering this floor (e.g. `"Crypt of Dagorn — Tomb Hall"`) | TBD |
| `tags` | string[] | no | Editor-side organizational labels. Optional; gameplay doesn't read them. | TBD |
| `depth` | int | yes | 1-indexed floor number; level 1 is the entrance, larger numbers go deeper. | TBD |
| `style` | string | no | Override the parent Dungeon's `style`. Same closed enum: `"caves"`, `"ruins"`, `"forest"`, `"custom"`. Omit to inherit. | TBD |
| `difficulty` | string | no | Override the parent Dungeon's `difficulty`. Same enum as [Monster](monster.md): `"easy"`, `"normal"`, `"hard"`, `"deadly"`, `"boss"`. Omit to inherit. | TBD |
| `size` | `{ width: int, height: int }` | no | Override the parent Dungeon's `size` for this floor's generated dimensions. Omit to inherit. | TBD |
| `torch_density` | number (0–1) | no | Override the parent Dungeon's `torch_density`. Useful for going pitch-dark on a climactic floor (`0`) or extra-lit on a temple floor. Omit to inherit. | TBD |
| `locked_doors` | number (0–1) | no | Override the parent Dungeon's `locked_doors`. Crank toward 1 for a "treasury" floor full of locked doors. Omit to inherit. | TBD |
| `doors` | number (0–1) | no | Override the parent Dungeon's `doors` (per-opening door placement chance; parent defaults to `1`). Set `0` for an open floor with no doorframes. Omit to inherit. | TBD |
| `edge_transitions` | boolean | no | Override the parent Dungeon's `edge_transitions` (entrance/exit at the map edge when `true`, interior rooms when `false`). Omit to inherit (which falls back to the style default — edge for `"forest"`). | TBD |
| `custom_floor` | string | no | Override the parent's `custom_floor` palette id (only meaningful when the effective `style` is `"custom"`). Omit to inherit. | TBD |
| `custom_wall` | string | no | Override the parent's `custom_wall` palette id (only meaningful when the effective `style` is `"custom"`). Omit to inherit. | TBD |
| `custom_stairs_up` | string | no | Override the parent's `custom_stairs_up` transition palette id (custom style only, cosmetic). Omit to inherit. | TBD |
| `custom_stairs_down` | string | no | Override the parent's `custom_stairs_down` transition palette id (custom style only, cosmetic). Omit to inherit. | TBD |

## Inheritance semantics

An undefined/missing field on a Dungeon Level means "use the parent Dungeon's value." There is no `inherited: true` marker — absence *is* the marker. To force a value, set the field; to fall back to the parent, drop the key.

The editor's level row shows the inherited value in placeholder/grey text when an override is empty so authors can see what they'd get without leaving the level expanded.

## Cross-references to other models

- `difficulty` shares the [Monster](monster.md) `difficulty` enum.
- Owned *by* [Dungeon](dungeon.md) `levels[]` (inline, not by reference).

## Example records (inline under a Dungeon)

**A floor that just rides the parent's defaults:**

```json
{
  "id": "crypt_of_dagorn_l1",
  "name": "Tomb Hall",
  "depth": 1
}
```

**A floor that overrides size and lock density:**

```json
{
  "id": "crypt_of_dagorn_l2",
  "name": "Vault Approach",
  "depth": 2,
  "size": { "width": 40, "height": 40 },
  "locked_doors": 0.5
}
```

**A pitch-dark final boss floor:**

```json
{
  "id": "crypt_of_dagorn_l3",
  "name": "The Inner Vault",
  "depth": 3,
  "difficulty": "boss",
  "torch_density": 0.0
}
```

## Notes and open questions

- **Procedural, no `map_id`.** Earlier drafts had each Level point at an authored [Map](map.md); the Dungeon pivot to procedural generation dropped that field — there is no authored grid for the runtime to load.
- **Inline, not a separate catalog.** Same rationale as before: Levels have no meaning outside their owning Dungeon and aren't referenced by any other model.
- **Override semantics are absence-based.** No `null` distinction from "unset" today — they're the same thing. If a future case needs "explicit null = take generator default ignoring the parent," that's a separate field convention to introduce then.
- **Schema is a stub.** Likely future additions: per-floor entry/exit coordinates so stair tiles know where to land the party, scripted-event hooks, encounter / loot table overrides at the per-floor level.
