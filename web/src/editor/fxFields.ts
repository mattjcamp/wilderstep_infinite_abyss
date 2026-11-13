/**
 * FX-field config — which record fields the editor treats as
 * references into the module's FX catalog (fx.json).
 *
 * Spells, abilities, items and effects all use `fx_id`. The saved
 * value is always an FX record `id`; the FxPicker is the only writer.
 * Per-model overrides go in PER_MODEL when a model needs a second FX
 * field (e.g. a separate on-hit FX).
 */

export interface FxFieldConfig {
  /** Reserved for future per-field filtering. */
  filter?: string;
}

const FIELDS: Record<string, FxFieldConfig> = {
  fx_id: {},
};

const PER_MODEL: Record<string, Record<string, FxFieldConfig>> = {};

/** The picker config for a field, or null if it isn't an FX field. */
export function getFxFieldConfig(
  fieldKey: string,
  modelKey?: string,
): FxFieldConfig | null {
  if (modelKey && PER_MODEL[modelKey]?.[fieldKey]) {
    return PER_MODEL[modelKey][fieldKey];
  }
  return FIELDS[fieldKey] ?? null;
}
