/**
 * Animation-field config — which record fields the editor treats as
 * references into the Animation catalog (web/public/modules/default/animations.json).
 *
 * One field name, four record types: spells, abilities, items, and
 * effects all use `animation_id` to point at a curated visual+audio
 * bundle. A few records may eventually use a different field name
 * (e.g. weapon `hit_animation_id` distinct from consumable
 * `use_animation_id`); the per-model override map below is the place
 * for that.
 *
 * Adding animation-field support to a new model is one entry here
 * (or relying on the default if the field name is reused). Note that
 * unlike spriteFields, there's no "format" choice — the saved value
 * is always an Animation `id`. The picker is the only writer.
 */

/** Tag for animation-typed fields. The struct is intentionally tiny
 *  — the picker doesn't currently need per-field configuration, but
 *  keeping a config object preserves room to grow (default-pick-by-tag,
 *  preview-on-hover, model-specific filtering, etc.). */
export interface AnimationFieldConfig {
  /** Reserved for future per-field filtering. Currently unused — every
   *  field sees the full catalog. */
  filter?: string;
}

/** Global field-name → config map. The default field name across all
 *  four record types is `animation_id`. Per-model overrides go below. */
const FIELDS: Record<string, AnimationFieldConfig> = {
  animation_id: {},
};

/** Per-model overrides — when the same model wants additional
 *  animation-typed fields beyond the default, or wants to filter the
 *  catalog (e.g., weapons should only see "impact"-tagged animations
 *  once tags exist). Empty today; the structure is here so adding the
 *  first override doesn't require restructuring. */
const PER_MODEL: Record<string, Record<string, AnimationFieldConfig>> = {};

/** Returns the picker config for a field, or null if the field isn't
 *  an animation field. Pass `modelKey` to consult per-model overrides. */
export function getAnimationFieldConfig(
  fieldKey: string,
  modelKey?: string,
): AnimationFieldConfig | null {
  if (modelKey && PER_MODEL[modelKey]?.[fieldKey]) {
    return PER_MODEL[modelKey][fieldKey];
  }
  return FIELDS[fieldKey] ?? null;
}
