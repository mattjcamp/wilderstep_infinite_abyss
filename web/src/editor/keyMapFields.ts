/**
 * Key-map field config — record fields shaped as a flat object map
 * (`{ key: value }`) that render with the KeyMapEditor instead of a
 * raw JSON textarea. P1.2 from the usability audit.
 *
 * Two value kinds:
 *   - number: id → count / modifier (recipes.reagents,
 *             stat_modifiers)
 *   - id:     key → catalog id (characters.equipped: slot → item)
 *
 * Keys come from an IdListSource (same machinery as the IdListPicker
 * — catalogs, static enums, distinct values), so reagent keys get
 * item thumbnails and stat keys are a fixed list.
 *
 * `fixedRows: true` renders one row per key option (a stat block, an
 * equipment loadout) instead of add/remove rows.
 */

import type { IdListSource } from "./idListFields";

export interface KeyMapValueNumber {
  kind: "number";
  /** Coerce to integer on edit. Default true — every current map is
   *  counts or whole-point modifiers. */
  integer?: boolean;
  /** Lowest allowed value. Absent = negatives allowed (stat mods). */
  min?: number;
}

export interface KeyMapValueId {
  kind: "id";
  source: IdListSource;
}

export interface KeyMapFieldConfig {
  /** Where row keys come from. */
  keys: IdListSource;
  value: KeyMapValueNumber | KeyMapValueId;
  /** One row per key option (stat blocks, equipment slots) instead
   *  of add/remove rows. */
  fixedRows?: boolean;
  /** One-line authoring hint rendered under the editor. */
  help?: string;
}

/** Ability scores in the order character sheets list them. */
const STATS = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
] as const;

const PER_MODEL: Record<string, Record<string, KeyMapFieldConfig>> = {
  recipes: {
    reagents: {
      keys: {
        kind: "catalog",
        model: "items",
        // Recipes brew from foraged reagents/herbs — filter the
        // 60-item catalog down to what Herbalism actually drops.
        where: { field: "item_type", in: ["reagent", "herb"] },
      },
      value: { kind: "number", integer: true, min: 1 },
      help: "Reagents consumed per brew, with counts.",
    },
  },
  races: {
    stat_modifiers: {
      keys: { kind: "static", options: STATS },
      value: { kind: "number", integer: true },
      fixedRows: true,
      help: "Added to a member's rolled scores. Negatives allowed.",
    },
  },
  character_classes: {
    stat_modifiers: {
      keys: { kind: "static", options: STATS },
      value: { kind: "number", integer: true },
      fixedRows: true,
      help: "Added to a member's rolled scores. Negatives allowed.",
    },
  },
  characters: {
    equipped: {
      keys: { kind: "static", options: ["hands", "body"] },
      value: { kind: "id", source: { kind: "catalog", model: "items" } },
      fixedRows: true,
      help: "Starting equipment by slot. Leave a slot empty for bare hands / no armor.",
    },
  },
};

/** Returns the editor config for a field, or null when the field
 *  isn't a key-map field on this model. */
export function getKeyMapFieldConfig(
  fieldKey: string,
  modelKey?: string,
): KeyMapFieldConfig | null {
  if (!modelKey) return null;
  return PER_MODEL[modelKey]?.[fieldKey] ?? null;
}
