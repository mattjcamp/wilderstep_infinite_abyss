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
  /** Peak HP / MP at the member's current level. Optional so legacy
   *  saves still parse; PlayHost's load path backfills them from
   *  the catalog (and combat's post-fight sync writes them back) so
   *  every running save eventually carries real peak values. Without
   *  these fields the Party screen's heal-to-full path has to scrape
   *  max from the live characters.json — which breaks for custom
   *  characters (no catalog entry) and for any future per-member
   *  max changes (level-up bonuses, equipment-granted +HP, etc.). */
  max_hp?: number;
  max_mp?: number;
  /** Current level + accumulated XP. Both optional so legacy saves
   *  (predating the XP-persistence layer) keep parsing; PlayHost's
   *  load path backfills `level` from the catalog character (default
   *  1) and `exp` to 0 when missing. Mutated from two sources:
   *
   *    1. Combat — CombatScene's post-fight `awardXp` bumps the live
   *       PartyMember's exp/level, and `applyCombatResultToSave`
   *       reads those deltas back here.
   *    2. Quest turn-in — `PlayHost.onQuestDecline` banks the quest's
   *       `xp` reward into every alive member's `exp`. Level-ups
   *       triggered by banked XP don't fire at turn-in time; they
   *       catch up the next time the kernel calls `awardXp` (i.e.
   *       the next combat that awards any XP at all — the while
   *       loop processes every pending threshold in one pass).
   *
   *  Both fields are read by `PlayPartyScreenOverlay` to display the
   *  current level + XP bar on the Party screen and Character sheet,
   *  and honoured by `seedBattleCaches.buildPartyFromSave` so the
   *  next combat starts the live PartyMember at the player's real
   *  progress instead of resetting to the catalog's level 1. */
  level?: number;
  exp?: number;
  /** Carried items + charges + per-instance durability. Pattern matches
   *  v1's per-character inventory (separate from the shared party
   *  stash). `durability` rides on a per-row basis so two copies of the
   *  same weapon can wear independently; absent means "fresh" (catalog
   *  max) on next equip. */
  inventory: ReadonlyArray<{
    item: string;
    charges?: number;
    durability?: number;
  }>;
  /** Active effects (buffs/debuffs/curses) with remaining durations.
   *  Same structure used by the simulator's effect tick. */
  effects: ReadonlyArray<{
    id: string;
    duration: number | "permanent" | "instant" | "until_save";
  }>;
  /** Equipped items keyed by slot id ("hands", "body"). Persisted so
   *  a player who swapped from their starting weapon to a +2 sword
   *  finds the swap survives reload. Absent in legacy saves; the
   *  loader treats absence as "fall back to the catalog character's
   *  authored equipment loadout" — preserves the starting kit. */
  equipped?: Record<string, string>;
  /** Per-slot remaining durability for whatever's in `equipped`.
   *  Mirrors the runtime `PartyMember.equipped_durability` tracker so
   *  wear survives a reload-mid-adventure without going through an
   *  unequip cycle. `null` means "indestructible or fresh"; absent
   *  whole-object means a legacy save — the loader will lazy-init to
   *  max on first hit, matching the v1 semantics. */
  equipped_durability?: {
    hands?: number | null;
    body?: number | null;
  };
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
  /** Shared party stash (same shape as party.json inventory). Entries
   *  may carry per-instance `durability` for non-stackable gear that
   *  has been worn — wear travels with the item between stash and
   *  character inventories. */
  inventory: ReadonlyArray<{
    item: string;
    charges?: number;
    durability?: number;
  }>;
  /** Party-wide effects (torch step counter, Detect Traps,
   *  infravision-active toggle, etc.). */
  torch_steps: number;
  infravision_active: boolean;
  /** Step countdown for the Cleric's Light spell. Contributes to
   *  the party's emitted light radius via Math.max() in the sim.
   *  Absent in legacy saves; the loader treats absence as 0. */
  magic_light_steps?: number;
  /** Ability ids the player has toggled on from the Party screen's
   *  Effects panel. Persisted across reloads so a party who flagged
   *  Detect Traps, Infravision, etc. keeps the effect engaged when
   *  they reopen the game.
   *
   *  Absent in legacy saves; treated as empty. */
  party_effects?: ReadonlyArray<string>;
  /** True when the party is currently riding a boat. Pairs with
   *  `currentBoatSprite`. Persisted so a reload mid-voyage drops
   *  the player back into the boat at the saved cell rather than
   *  on foot. Absent in legacy saves; treated as false. */
  onBoat?: boolean;
  /** Sprite key of the boat the party is riding. Null / absent when
   *  on foot. Restored to the kernel via `initialCurrentBoatSprite`
   *  so the boat overlay re-renders with the right art. */
  currentBoatSprite?: string | null;
  /** NPC ids the party has already pickpocketed this run. The
   *  Halfling's race ability is once-per-NPC for the lifetime of
   *  the save, so we persist the per-NPC marker here rather than
   *  in the v1 `gameState.pickpocketedNpcs` sandbox set (which
   *  doesn't survive a reload). Absent in legacy saves; treated
   *  as the empty set. */
  pickpocketedNpcs?: ReadonlyArray<string>;
  /** In-game `dayIndex` (from GameTime) of the most recent Gnome
   *  Tinker use. The ability gates on `currentDay !== last_tinker_day`
   *  so the party can craft once per in-game day. Absent in legacy
   *  saves; treated as "never used" so the first attempt succeeds
   *  regardless of when the save was loaded. */
  last_tinker_day?: number;
  /** Generic "last in-game day this ability was used" map, keyed by
   *  ability id. Used by per-day class abilities (Ranger's Craft
   *  Arrows / Craft Fire Arrows) so each ability ticks against its
   *  own counter — a Ranger can craft regular arrows AND fire arrows
   *  on the same day, but not the same ability twice. Tinker stayed
   *  on its dedicated `last_tinker_day` field above for legacy save
   *  compat; new once-per-day abilities slot into this record. */
  last_ability_day?: Record<string, number>;
  /** Roster — ordered list of character ids. Identity stays in
   *  `members` keyed by id; this is just the turn order. */
  roster: ReadonlyArray<string>;
  /** Per-character state, keyed by character id. Tuple form keeps the
   *  serialised JSON readable and avoids any-as-object problems. */
  members: ReadonlyArray<SavedCharacterState>;
  /** Where the party is inside a dungeon, when applicable. Absent
   *  on the overworld. When set, the play loader re-mounts the
   *  matching dungeon floor (regenerated deterministically from the
   *  saved seed in `save.dungeons[dungeonId]`) at `(col, row)`
   *  instead of the overworld map referenced by `currentMapId`.
   *  `returnTo` records where on the overworld to drop the party
   *  when they leave the dungeon. */
  currentDungeon?: {
    dungeonId: string;
    floorIdx: number;
    col: number;
    row: number;
    returnTo: { mapId: string; col: number; row: number };
  };
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
  /** Loose boats parked on this map — `"col,row"` → sprite key.
   *  Object form (not array) so JSON round-trip preserves the
   *  key/value pairing without an array of tuples. Excludes the
   *  boat the party is currently riding (tracked on party state).
   *  Absent for legacy saves; the loader treats absence as
   *  "scan the grid for boat:true cells", matching the kernel's
   *  default boot path. */
  boatPositions?: Record<string, string>;
  /** Per-cell tile overrides — populated when a turned-in quest's
   *  `rewards.tile_add` / `rewards.tile_remove` op paints this map.
   *  Each entry is `{ col, row, tileId }`; `tileId` is a palette
   *  id (map_tiles.json) that the load step copies into the map's
   *  grid before the scene mounts. An empty `tileId` means "clear
   *  to a passable default" (tile_remove semantics) — applied as
   *  the first walkable palette tile at apply time. Absent on
   *  legacy saves; the loader treats absence as the empty list. */
  tileOverrides?: ReadonlyArray<{
    col: number;
    row: number;
    tileId: string;
  }>;
  /** Fog-of-war memory — `"col,row"` keys of every cell the party
   *  has ever seen on this map. Used by the renderer's relight pass
   *  (`sim/lighting.ts` → `rememberedCells`) to paint previously-
   *  visited cells at a dim grayscale instead of collapsing them to
   *  ambient darkness once the party walks out of LOS. Grown in
   *  place by the renderer on every relight from the lighting
   *  helper's `currentlyVisible` output; flushed to this field by
   *  the host on the same save sites that persist the other map
   *  deltas. Absent on legacy saves — the loader treats absence as
   *  the empty list, so first-time entry to a map after upgrading
   *  starts with no fog memory and the player rebuilds it
   *  organically as they explore. */
  visitedCells?: ReadonlyArray<string>;
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
  /** Game clock — total elapsed in-world minutes since the module's
   *  epoch (year 1, Jan 1 SUN 12:00 AM). Advanced MINUTES_PER_STEP
   *  per successful party step. Seeded from the module's
   *  `settings.start_time` on New Game; defaults to 0 when absent.
   *  Drives time-of-day lighting + moon phase + the HUD readout. */
  clockMinutes: number;
  party: SavedPartyState;
  /** Per-map mutation deltas keyed by map id. Maps the party has
   *  never visited are absent — `loadMapState` treats absence as
   *  empty Sets. */
  maps: Record<string, SavedMapState>;
  /** Per-dungeon session keyed by dungeon id. Same absence-=-empty
   *  semantics: a dungeon the party hasn't entered isn't in the map. */
  dungeons: Record<string, SavedDungeonSession>;
  /** Quest ids the party has accepted. Stops the quest-tile trigger
   *  from re-offering an already-accepted quest. Absent on legacy
   *  saves; the loader treats absence as an empty list. */
  acceptedQuests?: ReadonlyArray<string>;
  /** Per-quest step progress. Value is the index of the next
   *  incomplete step (0 = first step pending, N = all N steps done).
   *  Each combat win against a kill-step's target monster on the
   *  matching dungeon + level bumps the entry by 1. Absent quests
   *  are treated as 0 (first step pending). Used by the quest
   *  dialog and quest log to switch between offer / in-progress /
   *  complete states. */
  questStepProgress?: Record<string, number>;
  /** Quest ids the party has already turned in and claimed rewards
   *  for. Distinct from `acceptedQuests` (which only tracks "yes I
   *  took this") and `questStepProgress` (which tracks step
   *  progress but can't distinguish "all steps done, rewards
   *  pending" from "all steps done, rewards already claimed").
   *
   *  Without this field a reload-mid-turn-in would let the player
   *  re-bump the quest giver and re-grant gold / items on every
   *  Close. Absent in legacy saves; the loader treats absence as
   *  an empty list (so an existing playthrough where the player
   *  has already claimed rewards before this field shipped would
   *  unfortunately let them re-claim once — acceptable migration
   *  cost given how new the feature is). */
  turnedInQuests?: ReadonlyArray<string>;
  /** Per-counter live stock, keyed by counter id.
   *
   *  Counters now own a persistent inventory: items bought disappear
   *  from the row, items sold land in the counter and stick around
   *  (with their current per-instance durability) so the player can
   *  re-buy a worn-in dagger as the same worn-in dagger. The catalog
   *  `counter.items` field is only the SEED — the first time a
   *  counter is opened on a save without an entry here, the seed is
   *  expanded into one row per id and stamped into this record. From
   *  then on, every buy/sell mutates the saved array; no restocking,
   *  no per-session reset.
   *
   *  Absent in legacy saves; treated as "use the catalog seed". A
   *  counter with an explicit empty array `[]` is meaningfully
   *  different — "the player cleared it out" — and stays empty until
   *  the player sells something back. */
  counters?: Record<
    string,
    ReadonlyArray<{ item: string; charges?: number; durability?: number }>
  >;
}
