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
 * Keyed by dungeon id (the v2 record's `id`). A single in-flight
 * game session is assumed; multiple parallel runs would extend
 * this with a session-level prefix.
 */

import type { DungeonLevel } from "@/battle/world/Dungeon";

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
  dungeonId: string,
  seed: number,
  generateLevels: () => DungeonLevel[],
): DungeonSession {
  const existing = sessions.get(dungeonId);
  // Treat a different seed for the same id as a fresh roll — the
  // launcher's manual seed override should rebuild the dungeon.
  if (existing && existing.seed === seed) return existing;
  const session: DungeonSession = {
    dungeonId,
    seed,
    levels: generateLevels(),
    floors: new Map(),
  };
  sessions.set(dungeonId, session);
  return session;
}

/** Drop a dungeon's session. Used by the launcher's "Regenerate"
 *  flow + the eventual "new game" reset. */
export function clearDungeonSession(dungeonId: string): void {
  sessions.delete(dungeonId);
}

/** Drop every session — invoked when a new game starts. */
export function clearAllDungeonSessions(): void {
  sessions.clear();
}

/** Read-only peek at a session for tests / UI; returns undefined
 *  when no session has been created for this dungeon. */
export function peekDungeonSession(
  dungeonId: string,
): DungeonSession | undefined {
  return sessions.get(dungeonId);
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
