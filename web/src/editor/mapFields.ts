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

/** Tag for map-typed fields. The picker consults this to decide how
 *  to filter the maps catalog before rendering. */
export interface MapFieldConfig {
  /** When set, the picker only lists maps whose `tags` array includes
   *  this string. Authors who haven't tagged their arenas accordingly
   *  see an empty list (with a hint) rather than picking the wrong
   *  shape of map. Today this is used to gate `custom_map` selection
   *  on `"battle_screen_arena"` — combat needs an 18×16 grid with
   *  the perimeter-wall convention, and accidentally pointing it at
   *  an overworld map would crash placement. */
  requiredTag?: string;
}

/** Global field-name → config map. */
const FIELDS: Record<string, MapFieldConfig> = {
  // Spawn / encounter custom_map: only maps tagged
  // "battle_screen_arena" — the combat scene expects an 18×16
  // arena layout. See web/src/battle/combat/Arena.ts for the
  // constraints (perimeter walls, formation bands, etc.).
  custom_map: { requiredTag: "battle_screen_arena" },
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
