/**
 * WorldSave — serialisable snapshot of an in-progress playthrough.
 *
 * The save is a forked image of the module: the static catalogs
 * (characters, monsters, encounters, etc.) are not duplicated —
 * those still come from `public/modules/<id>/...` at load time. What
 * the save DOES capture is everything the world has mutated since
 * the player started: party position, per-character stats, inventory,
 * the cleared/unlocked/destroyed state of every map they've visited,
 * and the rolled state of every dungeon they've entered.
 *
 * Stored as JSON in localStorage under a single key. Single auto-save
 * slot for now — multi-slot can layer on top later by treating the
 * existing key as one of many keyed by save id.
 *
 * Schema is versioned. The loader runs `migrate(raw)` which dispatches
 * on the version stamp; today's only migration is the identity pass
 * for v1 saves. Future schema changes bump the version and add a
 * migration step.
 */

/** Schema version stamped into every save. Bump on breaking changes
 *  to the WorldSave shape and add a migration in `loadWorld`. */
export const SAVE_SCHEMA_VERSION = 1;
/** localStorage key the save layer reads/writes. Single auto-slot. */
export const SAVE_STORAGE_KEY = "wsia.save.v1";
/** Backup slot — `saveWorld` copies the CURRENT save here BEFORE
 *  overwriting it. Used by the death screen's "Continue from last
 *  save" path so a fatal combat doesn't permanently overwrite the
 *  pre-fight state. One-deep — successive saves keep rolling the
 *  most-recent prior state into this slot. */
export const SAVE_PREV_STORAGE_KEY = "wsia.save.v1.prev";

/** One character's mutable in-play state. The character's static
 *  identity (name/race/class/sprite) still comes from the module's
 *  characters.json at load time — these fields are only the runtime
 *  deltas the player accumulated. */
export interface SavedCharacterState {
  /** Character id matching the module's characters.json (or a synthetic
   *  id for player-created characters, prefixed `__custom_`). */
  id: string;
  /** Full character record IF this is a player-created custom character
   *  (not in characters.json). Persisted so the save is self-contained
   *  across reloads — the module doesn't know about custom characters.
   *  Null for module-supplied characters. */
  custom: unknown | null;
  hp: number;
  mp: number;
  /** Carried items + charges. Pattern matches v1's per-character
   *  inventory (separate from the shared party stash). */
  inventory: ReadonlyArray<{ item: string; charges?: number }>;
  /** Active effects (buffs/debuffs/curses) with remaining durations.
   *  Same structure used by the simulator's effect tick. */
  effects: ReadonlyArray<{
    id: string;
    duration: number | "permanent" | "instant" | "until_save";
  }>;
}

/** The party's whole-team state — separate from each character's own
 *  state. Mirrors the shape of party.json so the loader can hand it
 *  to the sim with minimal massaging. */
export interface SavedPartyState {
  /** Map the party is currently standing on. The save loader uses this
   *  + start_position.col/row to mount the right scene + drop them on
   *  the right cell. */
  currentMapId: string;
  col: number;
  row: number;
  avatar: string;
  gold: number;
  /** Shared party stash (same shape as party.json inventory). */
  inventory: ReadonlyArray<{ item: string; charges?: number }>;
  /** Party-wide effects (Galadriel's Light step counter, Detect Traps,
   *  infravision-active toggle, etc.). */
  torch_steps: number;
  galadriels_light_steps: number;
  infravision_active: boolean;
  /** Roster — ordered list of character ids. Identity stays in
   *  `members` keyed by id; this is just the turn order. */
  roster: ReadonlyArray<string>;
  /** Per-character state, keyed by character id. Tuple form keeps the
   *  serialised JSON readable and avoids any-as-object problems. */
  members: ReadonlyArray<SavedCharacterState>;
}

/** Mutation deltas for one visited map. Sets are serialised as
 *  arrays in JSON; the load step rebuilds them. Same key shape as
 *  the in-memory MapSimulation state (`"col,row"`). */
export interface SavedMapState {
  /** Locked-tile cells the party has picked / knocked open. */
  unlockedCells: ReadonlyArray<string>;
  /** Source cells of placed encounters the party has defeated. The
   *  sim filters its placed-encounter seed pass against this on
   *  re-entry so already-killed enemies don't respawn. */
  defeatedEncounters: ReadonlyArray<string>;
  /** Monster Spawn cells whose boss has been killed. Same filtering
   *  semantics as defeatedEncounters. */
  destroyedLairs: ReadonlyArray<string>;
}

/** One floor inside a saved dungeon — same fields as
 *  `FloorMutationState` but with Sets flattened to arrays. */
export interface SavedFloorState {
  unlockedCells: ReadonlyArray<string>;
  defeatedEncounters: ReadonlyArray<string>;
  destroyedLairs: ReadonlyArray<string>;
}

/** One full dungeon session. The generated `levels` array is a deep
 *  copy of the in-memory DungeonLevel[] — Sets inside (openedChests,
 *  triggeredTraps, etc.) are flattened to arrays at write time and
 *  hydrated at read time. */
export interface SavedDungeonSession {
  dungeonId: string;
  seed: number;
  /** DungeonLevel[] structure, with internal Sets serialised as
   *  arrays. Typed as `unknown` here to keep the save module from
   *  pulling in the v1 Dungeon types directly; the loader narrows. */
  levels: unknown[];
  floors: ReadonlyArray<{ floorIdx: number; state: SavedFloorState }>;
}

/** The complete save. Versioned + timestamped so we can show "last
 *  played 5 minutes ago" in the picker later, and migrate forward. */
export interface WorldSave {
  schemaVersion: number;
  /** ISO timestamp of the most recent write. */
  savedAt: string;
  /** Module id this save belongs to. Save is locked to one module —
   *  starting a new game in a different module overwrites. */
  moduleId: string;
  party: SavedPartyState;
  /** Per-map mutation deltas keyed by map id. Maps the party has
   *  never visited are absent — `loadMapState` treats absence as
   *  empty Sets. */
  maps: Record<string, SavedMapState>;
  /** Per-dungeon session keyed by dungeon id. Same absence-=-empty
   *  semantics: a dungeon the party hasn't entered isn't in the map. */
  dungeons: Record<string, SavedDungeonSession>;
}
