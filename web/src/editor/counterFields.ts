/**
 * Counter-field config — which record fields the editor treats as
 * references into the Counter catalog (web/public/modules/default/counters.json).
 *
 * Pattern mirrors spriteFields / animationFields: a thin lookup
 * function that the RecordForm consults when picking which input
 * widget to render. NPCs are the first model to carry a counter
 * reference (so an NPC can sell items from a Counter's stock), but
 * the same field name on any future model picks up the picker for
 * free.
 *
 * No per-model overrides today — adding one means the same shape as
 * spriteFields' PER_MODEL map.
 */

/** Tag for counter-typed fields. Empty object today; the structure
 *  is here so per-field configuration can grow (filter by kind,
 *  default selection, etc.) without restructuring callers. */
export interface CounterFieldConfig {
  /** Reserved for future per-field filtering. Currently unused. */
  filter?: string;
}

/** Global field-name → config map. */
const FIELDS: Record<string, CounterFieldConfig> = {
  counter: {},
};

/** Returns the picker config for a field, or null if the field isn't
 *  a counter field. modelKey is accepted for symmetry with the
 *  sprite/animation helpers; per-model overrides aren't wired today. */
export function getCounterFieldConfig(
  fieldKey: string,
  _modelKey?: string,
): CounterFieldConfig | null {
  return FIELDS[fieldKey] ?? null;
}
