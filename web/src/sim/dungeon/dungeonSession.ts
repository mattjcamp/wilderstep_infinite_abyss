/**
 * In-memory dungeon session store.
 *
 * Dungeons are generated once per game and their state mutates in
 * place as the party explores: encounters defeated, doors picked,
 * stair tiles travelled. None of those mutations should reset when
 * the party walks back upstairs, ascends to the overworld, or
 * re-enters via the same entrance cell. Until the broader
 * save/load system lands this lives entirely in-memory; once it
 * does, this module is the natural serialisation target — its
 * shape is deliberately plain (Maps + Sets) so a save pass is
 * straight JSON.
 *
 * Keyed by *instance id* — a per-placement key, not the bare
 * dungeon record id. The same dungeon record planted at two
 * separate map entrances yields two independent instances (each
 * its own rolled layout + explored/cleared state). The instance
 * key folds the entrance's map id + cell coords into the dungeon
 * id (see `dungeonInstanceKey`). Callers that don't care about
 * per-placement instancing (the editor's dungeon tester) pass the
 * bare dungeon id as the instance id — one instance, as before.
 */

import type { DungeonLevel } from "@/battle/world/Dungeon";

/** Build the per-placement session key for a dungeon entrance.
 *
 *  A single dungeon record (`grotto`) placed at two separate map
 *  entrances should generate two distinct dungeons — same record,
 *  independent layouts + state. We achieve that by keying the
 *  session store on the *entrance* (map id + the entrance cell's
 *  coords) folded into the dungeon id, rather than on the dungeon
 *  id alone. Mirrors the per-physical-counter `counterStockKey`
 *  pattern.
 *
 *  Pure + stable: the same entrance always yields the same key, so
 *  re-entering a dungeon via the same mouth resumes its instance. */
export function dungeonInstanceKey(args: {
  dungeonId: string;
  mapId: string;
  col: number;
  row: number;
}): string {
  return `${args.dungeonId}@${args.mapId}:${args.col},${args.row}`;
}

/** Mutation state for a single floor — the bits a re-mount of the
 *  same grid needs in order to resume. Cell-coordinate keys
 *  (`"col,row"`). Cloneable into the simulator's option struct. */
export interface FloorMutationState {
  unlockedCells: Set<string>;
  defeatedEncounters: Set<string>;
  destroyedLairs: Set<string>;
}

/** One dungeon's full session — the generated floor data + each
 *  floor's mutation state. `levels` is generated exactly once;
 *  every subsequent mount of any floor reads the same grid +
 *  the floor's accumulated mutations. */
export interface DungeonSession {
  /** Store key — the per-placement instance id (see
   *  `dungeonInstanceKey`). For the editor tester this equals
   *  `dungeonId`. */
  instanceId: string;
  /** The dungeon *record* id this instance was generated from.
   *  Used for catalog lookups (encounter tables, soundtrack, the
   *  synthetic floor map ids) and persisted to the save so a
   *  reload can re-resolve the record. */
  dungeonId: string;
  /** Seed used to generate `levels`. Stored so the editor can
   *  display it / a future "save with seed" flow can reproduce
   *  the layout. */
  seed: number;
  levels: DungeonLevel[];
  floors: Map<number, FloorMutationState>;
}

/** Module-scoped store. Survives React re-renders + component
 *  remounts. Cleared when the browser tab unloads. Page navigation
 *  WITHIN the editor (e.g. router.push) doesn't reset the module
 *  — sessions persist across overworld ↔ dungeon hops. */
const sessions = new Map<string, DungeonSession>();

/** Fetch the session for a dungeon, OR create + seed it.
 *
 *  `generateLevels` is the caller's deferred work — only invoked
 *  on a miss, so the v1 generator doesn't run for every re-entry.
 *  The returned session is the LIVE entry in the store: mutating
 *  its `floors` map updates the canonical state.
 *
 *  Callers should generally use this rather than poking the store
 *  directly — it keeps the "generated once" invariant in one
 *  place. */
export function getOrCreateDungeonSession(
  instanceId: string,
  seed: number,
  generateLevels: () => DungeonLevel[],
  /** Dungeon *record* id. Defaults to `instanceId` for callers
   *  (the editor tester) that don't instance per-placement. */
  dungeonId: string = instanceId,
): DungeonSession {
  const existing = sessions.get(instanceId);
  // Treat a different seed for the same instance as a fresh roll —
  // the launcher's manual seed override should rebuild the dungeon.
  if (existing && existing.seed === seed) return existing;
  const session: DungeonSession = {
    instanceId,
    dungeonId,
    seed,
    levels: generateLevels(),
    floors: new Map(),
  };
  sessions.set(instanceId, session);
  return session;
}

/** Drop a dungeon's session. Used by the launcher's "Regenerate"
 *  flow + the eventual "new game" reset. */
export function clearDungeonSession(instanceId: string): void {
  sessions.delete(instanceId);
}

/** Drop every session — invoked when a new game starts. */
export function clearAllDungeonSessions(): void {
  sessions.clear();
}

/** Read-only peek at a session for tests / UI; returns undefined
 *  when no session has been created for this dungeon. */
export function peekDungeonSession(
  instanceId: string,
): DungeonSession | undefined {
  return sessions.get(instanceId);
}

/** Get the mutation state for a floor, creating an empty entry if
 *  the floor has never been visited. The returned Sets are
 *  references — the caller's writes flow into the store. */
export function getFloorMutations(
  session: DungeonSession,
  floorIdx: number,
): FloorMutationState {
  const existing = session.floors.get(floorIdx);
  if (existing) return existing;
  const fresh: FloorMutationState = {
    unlockedCells: new Set(),
    defeatedEncounters: new Set(),
    destroyedLairs: new Set(),
  };
  session.floors.set(floorIdx, fresh);
  return fresh;
}

/** Replace a floor's mutation state wholesale. Used by the
 *  dungeon mount after a `state` event so the store reflects the
 *  simulator's current snapshot. Cloning happens in the caller
 *  if needed — `next` lands as-is. */
export function writeFloorMutations(
  session: DungeonSession,
  floorIdx: number,
  next: FloorMutationState,
): void {
  session.floors.set(floorIdx, next);
}

// ── JSON serialisation (for WorldSave persistence) ────────────────
//
// DungeonLevel carries five Set<string> fields (openedChests,
// triggeredTraps, detectedTraps, exploredTiles, overworldExits).
// These don't survive a JSON.stringify round-trip — they'd land as
// "{}" without a custom replacer. The two helpers here flatten the
// Sets to arrays on write and rebuild them on read, leaving every
// other field untouched.
//
// The save schema declares `SavedDungeonSession.levels: unknown[]`
// for exactly this reason — the play side picks the precise shape;
// the save layer stays JSON-only.

interface SerialisedDungeonLevel {
  // Everything that's not a Set survives the round-trip as-is, so
  // the type opens with an index signature.
  [k: string]: unknown;
  openedChests: string[];
  triggeredTraps: string[];
  detectedTraps: string[];
  exploredTiles: string[];
  overworldExits: string[];
}

/** Flatten a DungeonLevel's Sets to plain string arrays so the
 *  whole structure JSON-stringifies. The `unknown` cast lets the
 *  helper stay decoupled from the v1 Dungeon type; callers cast
 *  the result back to DungeonLevel-shape at the boundary. */
export function serialiseDungeonLevels(levels: unknown[]): unknown[] {
  return levels.map((raw) => {
    const lvl = raw as Record<string, unknown>;
    const out: SerialisedDungeonLevel = {
      ...lvl,
      openedChests: Array.from((lvl.openedChests as Set<string>) ?? []),
      triggeredTraps: Array.from((lvl.triggeredTraps as Set<string>) ?? []),
      detectedTraps: Array.from((lvl.detectedTraps as Set<string>) ?? []),
      exploredTiles: Array.from((lvl.exploredTiles as Set<string>) ?? []),
      overworldExits: Array.from((lvl.overworldExits as Set<string>) ?? []),
    };
    return out;
  });
}

/** Reverse of `serialiseDungeonLevels` — rebuild the Sets so the
 *  in-memory DungeonLevel shape is fully restored. Tolerates
 *  legacy/partial payloads (missing fields land as empty Sets). */
export function hydrateDungeonLevels(serialised: unknown[]): unknown[] {
  return serialised.map((raw) => {
    const lvl = raw as Record<string, unknown>;
    return {
      ...lvl,
      openedChests: new Set<string>(
        (lvl.openedChests as ReadonlyArray<string>) ?? [],
      ),
      triggeredTraps: new Set<string>(
        (lvl.triggeredTraps as ReadonlyArray<string>) ?? [],
      ),
      detectedTraps: new Set<string>(
        (lvl.detectedTraps as ReadonlyArray<string>) ?? [],
      ),
      exploredTiles: new Set<string>(
        (lvl.exploredTiles as ReadonlyArray<string>) ?? [],
      ),
      overworldExits: new Set<string>(
        (lvl.overworldExits as ReadonlyArray<string>) ?? [],
      ),
    };
  });
}
