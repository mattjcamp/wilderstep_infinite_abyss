/**
 * Inventory-field config — which record fields are `{ item, charges }[]`
 * stash lists the editor renders with the InventoryEditor (item picker +
 * quantity) instead of a raw JSON textarea.
 *
 * Pattern mirrors idListFields / spriteFields / counterFields: a thin
 * lookup the RecordForm consults per (modelKey, fieldKey). Kept separate
 * from idListFields because those entries are bare id strings, whereas
 * these carry a per-item quantity and so need their own structured
 * editor.
 */

export interface InventoryFieldConfig {
  /** One-line authoring hint rendered under the editor. */
  help?: string;
}

const PER_MODEL: Record<string, Record<string, InventoryFieldConfig>> = {
  party: {
    inventory: {
      help: "Starting shared stash — pick items and set each quantity.",
    },
  },
  characters: {
    inventory: {
      help: "Items this character starts with — pick items and set each quantity.",
    },
  },
};

/** Returns the inventory-editor config for a field, or null when the
 *  field isn't an item-quantity list on this model. */
export function getInventoryFieldConfig(
  fieldKey: string,
  modelKey?: string,
): InventoryFieldConfig | null {
  if (!modelKey) return null;
  return PER_MODEL[modelKey]?.[fieldKey] ?? null;
}
