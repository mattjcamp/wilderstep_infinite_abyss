/**
 * Id-list field config — which record fields the editor treats as
 * "a list of ids picked from somewhere" and renders with the
 * IdListPicker instead of a raw JSON textarea.
 *
 * Pattern mirrors spriteFields / counterFields / mapFields: a thin
 * lookup the RecordForm consults per (modelKey, fieldKey). This is
 * the P1 recommendation from docs/dev_guides/editor_usability_audit.md
 * — these fields were the largest class of raw-JSON authoring
 * surface (encounters.monsters alone: 63 records of hand-typed
 * monster-id arrays).
 *
 * Three option sources:
 *   - catalog:  ids come from another model's records (with display
 *               names + sprite thumbnails where the model has them)
 *   - static:   a fixed enum list (e.g. usable_in: battle | party)
 *   - distinct: every distinct value of some field across a model's
 *               records (e.g. allowable_item_types ← items.item_type)
 *
 * NOT covered here (deliberately): fields whose entries are objects
 * rather than id strings (character_classes.abilities' {ability_id,
 * min_level} links, monsters.spells' inline spell blocks). Those
 * keep the JSON textarea until they get structured editors of their
 * own.
 */

import type { ModelKey } from "@/data_model/models";

export type IdListSource =
  | {
      kind: "catalog";
      model: ModelKey;
      /** Optional record filter — keep only records whose `field`
       *  value is in the list (e.g. items where item_type ∈
       *  [reagent, herb] for recipe reagents). Absent = all records. */
      where?: { field: string; in: ReadonlyArray<string> };
    }
  | { kind: "static"; options: ReadonlyArray<string> }
  | { kind: "distinct"; model: ModelKey; field: string };

export interface IdListFieldConfig {
  source: IdListSource;
  /** One-line authoring hint rendered under the picker. */
  help?: string;
  /** Allow the same id more than once. Rosters list one entry per
   *  combatant (two goblins = "goblin" twice); ability / enum lists
   *  are sets. Default false. */
  allowDuplicates?: boolean;
}

/** Per-model field configs. A `"*"` model key would apply to every
 *  model (none needed yet — id-list fields are model-specific). */
const PER_MODEL: Record<string, Record<string, IdListFieldConfig>> = {
  encounters: {
    monsters: {
      source: { kind: "catalog", model: "monsters" },
      allowDuplicates: true,
      help: "Combat roster — one entry per combatant; repeat a monster to field several.",
    },
  },
  spawns: {
    spawn_monsters: {
      source: { kind: "catalog", model: "monsters" },
      allowDuplicates: true,
      help: "Roamers this lair drops around itself each step.",
    },
    boss_monsters: {
      source: { kind: "catalog", model: "monsters" },
      allowDuplicates: true,
      help: "The fight waiting on the lair tile itself.",
    },
    loot: {
      source: { kind: "catalog", model: "items" },
      allowDuplicates: true,
      help: "Items awarded when the boss falls.",
    },
  },
  races: {
    abilities: {
      source: { kind: "catalog", model: "abilities" },
      help: "Innate abilities every member of this race carries.",
    },
  },
  items: {
    slots: {
      source: { kind: "static", options: ["hands", "body"] },
      help: "Equipment slots this item can occupy.",
    },
  },
  spells: {
    usable_in: {
      source: { kind: "static", options: ["battle", "party"] },
      help: "Where the spell can be cast.",
    },
  },
  abilities: {
    usable_in: {
      source: { kind: "static", options: ["battle", "party"] },
      help: "Where the ability can be used.",
    },
  },
  character_classes: {
    casting_type: {
      source: { kind: "distinct", model: "spells", field: "casting_type" },
      help: "Spell catalogs this class can cast from.",
    },
    allowable_item_types: {
      source: { kind: "distinct", model: "items", field: "item_type" },
      help: "Item types members of this class may equip / use.",
    },
  },
};

/** Returns the picker config for a field, or null when the field
 *  isn't an id-list field on this model. */
export function getIdListFieldConfig(
  fieldKey: string,
  modelKey?: string,
): IdListFieldConfig | null {
  if (!modelKey) return null;
  return PER_MODEL[modelKey]?.[fieldKey] ?? null;
}
