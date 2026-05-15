/**
 * Sprite-field config — which record fields the editor treats as
 * "pointers into the sprite library" and how their values are saved.
 *
 * Two save formats exist because the legacy data is inconsistent:
 *
 *   "path"  → value is a folder-relative path under /sprites/
 *              (e.g., "monster/goblin.png"). The runtime resolves it
 *              as `/sprites/${value}`. Used by `sprite` (Character,
 *              Monster, Tile Palette) and `avatar` (Party).
 *   "stem"  → value is just the filename stem with no extension or
 *              folder (e.g., "club"). The runtime resolves it as
 *              `/sprites/<category>/${value}.png`. Used by `icon`.
 *
 * The picker saves canonical values for either format. Legacy values
 * (e.g., "game/monsters/giant_rat.png") still parse via best-effort
 * resolution so existing thumbnails don't all go blank on load — but
 * any new pick produces a canonical path.
 *
 * Adding sprite-field support to a new record field is one entry
 * here plus making sure the sprite folder exists under web/public/sprites/.
 */

import { withBasePath } from "@/util/basePath";

export interface SpriteFieldConfig {
  /** Sprite category to default to in the picker (the group expanded
   *  first). The picker shows all categories regardless. */
  category: string;
  /** How the saved value is shaped. See file header. */
  format: "path" | "stem";
}

/** Global field-name → config map. Used when no model-specific
 *  override applies. */
const FIELDS: Record<string, SpriteFieldConfig> = {
  sprite: { category: "person", format: "path" },
  icon: { category: "item", format: "stem" },
  monster_party_tile: { category: "monster", format: "path" },
  // Party's overworld representation. Distinct from Character.sprite
  // (per-character portrait) — the party avatar is what's drawn on
  // the world map for the group as a whole.
  avatar: { category: "person", format: "path" },
  // Quest.quest_giver.npc_sprite — the NPC the player talks to to
  // offer/complete a quest. Always a person sprite.
  npc_sprite: { category: "person", format: "path" },
};

/** Per-model overrides — when the same field name means different
 *  things in different models. The shared `sprite` field defaults to
 *  the person/ folder (Characters); Monsters and Tile Palette
 *  records redirect it to their own folders. */
const PER_MODEL: Record<string, Record<string, SpriteFieldConfig>> = {
  map_tiles: {
    sprite: { category: "map", format: "path" },
  },
  monsters: {
    sprite: { category: "monster", format: "path" },
  },
};

/** Returns the picker config for a field, or null if the field isn't
 *  a known sprite field (and should be rendered as a plain input).
 *  Pass `modelKey` to pick up any per-model override (so the picker's
 *  default category matches the record's natural sprite folder). */
export function getSpriteFieldConfig(
  fieldKey: string,
  modelKey?: string,
): SpriteFieldConfig | null {
  if (modelKey && PER_MODEL[modelKey]?.[fieldKey]) {
    return PER_MODEL[modelKey][fieldKey];
  }
  return FIELDS[fieldKey] ?? null;
}

/** Resolve a stored value into a /sprites/ URL we can use for a
 *  thumbnail preview. Tolerant of legacy paths so existing data
 *  doesn't all render as broken images:
 *
 *   - empty/null → null (caller should render an empty slot)
 *   - "category/file.png" → /sprites/category/file.png
 *   - "weird/legacy/file.png" → /sprites/weird/legacy/file.png
 *     (we trust the path as-is; if the file doesn't exist, the <img>
 *     onError handler in SpritePicker hides the broken thumb)
 *   - "stem" (no slash, no extension) → uses config.category +
 *     adds .png suffix
 */
export function resolveSpritePath(
  value: string,
  config: SpriteFieldConfig,
): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("/")) {
    return withBasePath(`/sprites/${trimmed}`);
  }
  // Stem form: <category>/<stem>.png
  const withExt = /\.[a-z]+$/i.test(trimmed) ? trimmed : `${trimmed}.png`;
  return withBasePath(`/sprites/${config.category}/${withExt}`);
}

/** Format the value to store given a picked (category, filename) pair
 *  from the sprite browser. */
export function formatPickedValue(
  category: string,
  filename: string,
  config: SpriteFieldConfig,
): string {
  if (config.format === "stem") {
    return filename.replace(/\.[a-z]+$/i, "");
  }
  return `${category}/${filename}`;
}
