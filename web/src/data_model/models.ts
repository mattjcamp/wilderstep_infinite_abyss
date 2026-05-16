/**
 * Model registry — the single source of truth for which data models
 * the editor knows about. Each entry describes:
 *
 *   - what filename it loads from (relative to the module folder)
 *   - what top-level key holds the records (or null for singletons)
 *   - which columns the browse table shows
 *   - which dictionary doc it cross-links to
 *
 * Adding a new model is one entry here plus its JSON file. Removing one
 * keeps the docs in place — the editor sidebar just stops showing it.
 *
 * Every model lives per-module. There is no separate "shared" scope —
 * the base `default` module owns the canonical records, and other modules
 * extend it and override by record id. See StaticModuleSource.load().
 */

export type ModelKey =
  | "abilities"
  | "effects"
  | "spells"
  | "recipes"
  | "items"
  | "counters"
  | "monsters"
  | "characters"
  | "party"
  | "spawns"
  | "encounters"
  | "character_classes"
  | "races"
  | "map_tiles"
  | "maps"
  | "dungeons"
  | "quests"
  | "animations";

export interface ColumnDef {
  /** Object path on the record. Supports a single key for now; nested
   *  paths would need a getter. */
  field: string;
  /** Display label for the column header. */
  label: string;
  /** Optional formatter — receives the raw value, returns a display string. */
  format?: (value: unknown) => string;
}

export interface ModelDef {
  key: ModelKey;
  /** Sidebar label, e.g. "Effects", "Character Classes". */
  label: string;
  /** File name within the module folder (e.g. "effects.json"). */
  fileName: string;
  /** Top-level key under which records live in the JSON file, or null
   *  for singleton files (Party). Singletons can't be merged by id and
   *  are replaced wholesale when a child module defines the file. */
  collectionKey: string | null;
  /** Columns shown in the browse table. Ignored when collectionKey is null. */
  columns: ColumnDef[];
  /** Dictionary doc base name (without .md), e.g. "effect". */
  docKey: string;
  /** Short one-line description shown on the module landing page. */
  blurb: string;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function countItems(v: unknown): string {
  if (Array.isArray(v)) return `${v.length}`;
  if (v && typeof v === "object") return `${Object.keys(v).length}`;
  return "";
}

const DEFS: Record<ModelKey, ModelDef> = {
  abilities: {
    key: "abilities",
    label: "Abilities",
    fileName: "abilities.json",
    collectionKey: "abilities",
    docKey: "ability",
    blurb: "Named character capabilities — race / class / other (the catalog half of v1's effects)",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "type", label: "Type" },
      { field: "duration", label: "Duration", format: asString },
      { field: "description", label: "Description" },
    ],
  },
  effects: {
    key: "effects",
    label: "Effects",
    fileName: "effects.json",
    collectionKey: "effects",
    docKey: "effect",
    blurb: "Status effects, abilities, passives, on-hit triggers",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "duration", label: "Duration", format: asString },
      { field: "description", label: "Description" },
    ],
  },
  spells: {
    key: "spells",
    label: "Spells",
    fileName: "spells.json",
    collectionKey: "spells",
    docKey: "spell",
    blurb: "Castable spell-actions",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "action", label: "Action" },
      { field: "casting_type", label: "Catalog", format: asString },
      { field: "mp_cost", label: "MP", format: asString },
      { field: "min_level", label: "Min Lvl", format: asString },
    ],
  },
  recipes: {
    key: "recipes",
    label: "Recipes",
    fileName: "recipes.json",
    collectionKey: "recipes",
    docKey: "recipe",
    blurb: "Crafting / brew options",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "result_item", label: "Produces" },
      { field: "reagents", label: "Reagents", format: (v) => (v && typeof v === "object" ? Object.entries(v).map(([k, n]) => `${k}×${n}`).join(", ") : "") },
    ],
  },
  items: {
    key: "items",
    label: "Items",
    fileName: "items.json",
    collectionKey: "items",
    docKey: "item",
    blurb: "Weapons, armor, consumables, reagents, keys",
    columns: [
      { field: "id", label: "ID" },
      { field: "category", label: "Cat" },
      { field: "name", label: "Name" },
      { field: "item_type", label: "Type" },
      { field: "power", label: "Power", format: asString },
      { field: "evasion", label: "Evasion", format: asString },
    ],
  },
  counters: {
    key: "counters",
    label: "Counters",
    fileName: "counters.json",
    collectionKey: "counters",
    docKey: "counter",
    blurb: "Shops and service counters",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "kind", label: "Kind", format: (v) => (v ? asString(v) : "shop") },
      { field: "items", label: "Stock", format: countItems },
    ],
  },
  monsters: {
    key: "monsters",
    label: "Monsters",
    fileName: "monsters.json",
    collectionKey: "monsters",
    docKey: "monster",
    blurb: "Monster catalog",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "hp", label: "HP", format: asString },
      { field: "ac", label: "AC", format: asString },
      { field: "difficulty", label: "Difficulty" },
    ],
  },
  characters: {
    key: "characters",
    label: "Characters",
    fileName: "characters.json",
    collectionKey: "characters",
    docKey: "character",
    blurb: "Recruitable / starting characters",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "class", label: "Class" },
      { field: "race", label: "Race" },
      { field: "level", label: "Lvl", format: asString },
    ],
  },
  party: {
    key: "party",
    label: "Party",
    fileName: "party.json",
    collectionKey: null,
    docKey: "party",
    blurb: "Starting party seed (singleton)",
    columns: [],
  },
  spawns: {
    key: "spawns",
    label: "Spawns",
    fileName: "spawns.json",
    collectionKey: "spawns",
    docKey: "spawn",
    blurb: "Monster-lair behavior (triggered by map cells via tile.spawn)",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "spawn_chance", label: "Chance %", format: asString },
      { field: "max_spawned", label: "Max", format: asString },
    ],
  },
  encounters: {
    key: "encounters",
    label: "Encounters",
    fileName: "encounters.json",
    collectionKey: "encounters",
    docKey: "encounter",
    blurb: "Random-encounter rosters",
    columns: [
      { field: "id", label: "ID" },
      { field: "area", label: "Area" },
      { field: "name", label: "Name" },
      { field: "level", label: "Lvl", format: asString },
      { field: "weight", label: "Weight", format: asString },
    ],
  },
  character_classes: {
    key: "character_classes",
    label: "Character Classes",
    fileName: "character_classes.json",
    collectionKey: "character_classes",
    docKey: "character_class",
    blurb: "The eight playable classes",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "range", label: "Range", format: asString },
      {
        field: "casting_type",
        label: "Casting",
        format: (v) =>
          Array.isArray(v) ? v.join(", ") : asString(v ?? "none"),
      },
    ],
  },
  races: {
    key: "races",
    label: "Races",
    fileName: "races.json",
    collectionKey: "races",
    docKey: "race",
    blurb: "Playable races",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "exp_per_level", label: "XP/Lvl", format: asString },
      { field: "effects", label: "Effects", format: (v) => (Array.isArray(v) ? v.join(", ") : "") },
    ],
  },
  map_tiles: {
    key: "map_tiles",
    label: "Tile Palette",
    fileName: "map_tiles.json",
    collectionKey: "map_tiles",
    docKey: "map_tile",
    blurb: "Reusable tile types used to paint maps",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "walkable", label: "Walk", format: asString },
    ],
  },
  maps: {
    key: "maps",
    label: "Maps",
    fileName: "maps.json",
    collectionKey: "maps",
    docKey: "map",
    blurb: "Painted world geometry — tile grids with links and items",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      {
        field: "tags",
        label: "Tags",
        format: (v) => (Array.isArray(v) ? v.join(", ") : ""),
      },
    ],
  },
  dungeons: {
    key: "dungeons",
    label: "Dungeons",
    fileName: "dungeons.json",
    collectionKey: "dungeons",
    docKey: "dungeon",
    blurb: "Authored multi-level dungeons (ordered list of dungeon_levels)",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      {
        field: "tags",
        label: "Tags",
        format: (v) => (Array.isArray(v) ? v.join(", ") : ""),
      },
      {
        field: "levels",
        label: "Levels",
        format: (v) => (Array.isArray(v) ? `${v.length}` : ""),
      },
    ],
  },
  quests: {
    key: "quests",
    label: "Quests",
    fileName: "quests.json",
    collectionKey: "quests",
    docKey: "quest",
    blurb: "Authored adventure threads (ordered list of quest_steps)",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      {
        field: "tags",
        label: "Tags",
        format: (v) => (Array.isArray(v) ? v.join(", ") : ""),
      },
      {
        field: "steps",
        label: "Steps",
        format: (v) => (Array.isArray(v) ? `${v.length}` : ""),
      },
    ],
  },
  animations: {
    key: "animations",
    label: "Animations",
    fileName: "animations.json",
    collectionKey: "animations",
    docKey: "animation",
    blurb: "Visual + audio bundles that spells / abilities / items / effects reference by id",
    columns: [
      { field: "id", label: "ID" },
      { field: "name", label: "Name" },
      { field: "visual", label: "Visual" },
      { field: "cast_sfx", label: "Cast SFX" },
      { field: "hit_sfx", label: "Hit SFX" },
    ],
  },
};

export const MODELS = DEFS;

export const ALL_MODEL_KEYS: ModelKey[] = Object.keys(DEFS) as ModelKey[];

export function getModel(key: string): ModelDef | undefined {
  return key in DEFS ? DEFS[key as ModelKey] : undefined;
}
