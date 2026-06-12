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

import { baseDamageLabel, baseAcLabel, type ItemStatLike } from "./itemStats";

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
  | "traps"
  | "character_classes"
  | "races"
  | "map_tiles"
  | "maps"
  | "dungeons"
  | "quests"
  | "animations"
  | "npcs";

export interface ColumnDef {
  /** Object path on the record. Supports a single key for now; nested
   *  paths would need a getter. Still used for sorting even when a
   *  `compute` accessor drives the displayed text (so a Base Damage
   *  column can sort by the underlying numeric `power`). */
  field: string;
  /** Display label for the column header. */
  label: string;
  /** Optional formatter — receives the raw value, returns a display string. */
  format?: (value: unknown) => string;
  /** Optional row-level accessor — receives the WHOLE record and
   *  returns the display string. Use when the cell needs more than
   *  one field (e.g. Base Damage reads both `power` and `ranged`).
   *  Takes precedence over `format` for display + search; `field`
   *  still governs sort order. */
  compute?: (record: Record<string, unknown>) => string;
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

/** Difficulty tiers in ascending order — drives the encounter browse
 *  column label and the difficulty dropdown filter. */
export const DIFFICULTY_TIERS = ["Easy", "Normal", "Hard", "Deadly"] as const;

/** Map an encounter's 1–8 `level` to its difficulty tier name, or "" when
 *  the level isn't a finite number. Single source of truth shared by the
 *  browse column and the dropdown filter so they never drift. */
export function encounterDifficultyTier(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  if (n <= 2) return "Easy";
  if (n <= 4) return "Normal";
  if (n <= 6) return "Hard";
  return "Deadly";
}

/** Friendly proxy for the raw level number in the browse table, e.g.
 *  "Normal (3)". Sorting still keys off the underlying numeric `level`,
 *  so the tiers order correctly (Easy → Deadly). */
function levelToDifficulty(v: unknown): string {
  const tier = encounterDifficultyTier(v);
  if (!tier) return "";
  const n = typeof v === "number" ? v : Number(v);
  return `${tier} (${n})`;
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
      // Grouped (collapsible) by `type` (class / race / …), so Type
      // isn't its own column. Name leads.
      { field: "name", label: "Name" },
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
    columns: [      { field: "name", label: "Name" },
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
      // Grouped (collapsible) by `casting_type` catalog (sorcerer /
      // priest / …), so Catalog isn't its own column. Name leads.
      { field: "name", label: "Name" },
      { field: "action", label: "Action" },
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
    columns: [      { field: "name", label: "Name" },
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
      // Name leads next to the sprite; the table is grouped by
      // `category` (collapsible) so Cat isn't a column, and the raw id
      // stays in the form + JSON view. Mirrors Monsters / Encounters.
      { field: "name", label: "Name" },
      { field: "item_type", label: "Type" },
      // Base Damage / Base AC — derived, player-meaningful stats shown
      // in place of the raw `power` / `evasion` authoring fields (which
      // aren't intuitive). `field` is kept so the column still sorts by
      // the underlying number; `compute` drives the displayed text.
      {
        field: "power",
        label: "Base Damage",
        compute: (r) => baseDamageLabel(r as ItemStatLike),
      },
      {
        field: "evasion",
        label: "Base AC",
        compute: (r) => baseAcLabel(r as ItemStatLike),
      },
    ],
  },
  counters: {
    key: "counters",
    label: "Counters",
    fileName: "counters.json",
    collectionKey: "counters",
    docKey: "counter",
    blurb: "Shops and service counters",
    columns: [      { field: "name", label: "Name" },
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
      // Name leads next to the sprite thumbnail (the leading column);
      // the raw id stays editable in the form + visible in the JSON
      // view. Theme isn't a column because the table is grouped by
      // theme already — mirrors the Encounters list.
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
    columns: [      { field: "name", label: "Name" },
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
    columns: [      { field: "name", label: "Name" },
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
      // Sprite thumbnail renders as a separate leading column (the lead
      // monster's monster_party_tile). Name leads the data columns; the
      // raw id is still editable in the form + shown in the JSON view.
      { field: "name", label: "Name" },
      // "Difficulty" is a friendly proxy for level (sortable by the raw
      // numeric level underneath). Weight stays editable in the form.
      { field: "level", label: "Difficulty", format: levelToDifficulty },
      // Theme, derived from the encounter's monsters — helps pick
      // rosters that fit a themed map at a glance.
      { field: "theme", label: "Theme" },
      {
        field: "tags",
        label: "Tags",
        format: (v) => (Array.isArray(v) ? v.join(", ") : ""),
      },
    ],
  },
  traps: {
    key: "traps",
    label: "Traps",
    fileName: "traps.json",
    collectionKey: "traps",
    docKey: "trap",
    blurb: "Trap definitions — damage, status effects, teleports (placed via tile.trap_id)",
    columns: [
      { field: "name", label: "Name" },
      { field: "trap_type", label: "Type" },
      {
        field: "damage_type",
        label: "Damage",
        // "fire 6–12" at a glance; effect-only / teleport traps show
        // just the flavour type since they roll no dice.
        compute: (rec) => {
          const dt = asString(rec["damage_type"]);
          const range = rec["damage_range"] as
            | { min?: number; max?: number }
            | null
            | undefined;
          if (!range || typeof range !== "object") return dt;
          const { min, max } = range;
          if (typeof min !== "number" || typeof max !== "number") return dt;
          return dt ? `${dt} ${min}–${max}` : `${min}–${max}`;
        },
      },
      { field: "effect", label: "Effect", format: asString },
    ],
  },
  character_classes: {
    key: "character_classes",
    label: "Character Classes",
    fileName: "character_classes.json",
    collectionKey: "character_classes",
    docKey: "character_class",
    blurb: "The eight playable classes",
    columns: [      { field: "name", label: "Name" },
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
    columns: [      { field: "name", label: "Name" },
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
    columns: [      { field: "name", label: "Name" },
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
    columns: [      { field: "name", label: "Name" },
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
    columns: [      { field: "name", label: "Name" },
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
    columns: [      { field: "name", label: "Name" },
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
    columns: [      { field: "name", label: "Name" },
      { field: "visual", label: "Visual" },
      { field: "cast_sfx", label: "Cast SFX" },
      { field: "hit_sfx", label: "Hit SFX" },
    ],
  },
  npcs: {
    key: "npcs",
    label: "NPCs",
    fileName: "npcs.json",
    collectionKey: "npcs",
    docKey: "npc",
    blurb: "Non-player characters — name, sprite, backstory, and a list of dialogs",
    columns: [      { field: "name", label: "Name" },
      { field: "sprite", label: "Sprite" },
      { field: "dialogs", label: "Dialogs", format: countItems },
    ],
  },
};

export const MODELS = DEFS;

export const ALL_MODEL_KEYS: ModelKey[] = Object.keys(DEFS) as ModelKey[];

export function getModel(key: string): ModelDef | undefined {
  return key in DEFS ? DEFS[key as ModelKey] : undefined;
}
