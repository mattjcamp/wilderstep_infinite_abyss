/**
 * Map-field config — which record fields the editor treats as
 * references into the Map catalog (web/public/modules/default/maps.json).
 *
 * Today there's one such field: `custom_map` on Spawns and Encounters.
 * When set, the runtime uses the named Map as the battle arena for
 * that spawn / encounter instead of the default arena. Empty / null
 * means "use the default arena."
 *
 * Pattern mirrors counterFields.ts: a thin lookup function that the
 * RecordForm consults when picking which input widget to render. Any
 * future model that adopts a `custom_map` field name picks up the
 * picker automatically.
 *
 * No per-model overrides today — adding one means the same shape as
 * spriteFields' PER_MODEL map.
 */

/** Tag for map-typed fields. Empty object today; the structure is
 *  here so per-field configuration can grow (filter by tag, default
 *  selection, restrict to "battle_screen_arena"-tagged maps, etc.)
 *  without restructuring callers. */
export interface MapFieldConfig {
  /** Reserved for future per-field filtering. Currently unused. */
  filter?: string;
}

/** Global field-name → config map. */
const FIELDS: Record<string, MapFieldConfig> = {
  custom_map: {},
};

/** Returns the picker config for a field, or null if the field isn't
 *  a map field. modelKey is accepted for symmetry with the
 *  sprite/animation helpers; per-model overrides aren't wired today. */
export function getMapFieldConfig(
  fieldKey: string,
  _modelKey?: string,
): MapFieldConfig | null {
  return FIELDS[fieldKey] ?? null;
}
