/**
 * localStorage save layer.
 *
 * One auto-save slot plus SAVE_SLOT_COUNT manual slots. Every
 * play-side write goes through `saveWorld`; the entire WorldSave is
 * serialised to JSON and persisted under `SAVE_STORAGE_KEY`. Manual
 * slots (`saveToSlot` / `loadSlot` / `activateSlot`) are independent
 * copies of the same shape under per-slot keys; export / import
 * round-trips the same blob through a JSON file download so a save
 * survives the browser's storage being wiped. Reads go through
 * `loadWorld` which:
 *
 *   - returns null if no save exists, or the stored blob is unreadable
 *   - dispatches on `schemaVersion` to migrate older saves forward
 *     (today's only version is 1, so the migration is the identity
 *     pass — but the seam is in place so future schema changes don't
 *     have to refactor callers)
 *
 * Sets aren't JSON-serialisable; the save shape (`SavedMapState`,
 * `SavedFloorState`) already declares the relevant fields as
 * `ReadonlyArray<string>`, so callers flatten on write + hydrate on
 * read. Those Set<->Array conversions are NOT done here — they're
 * the caller's responsibility — to keep this layer pure JSON.
 */

import {
  SAVE_PREV_STORAGE_KEY,
  SAVE_SCHEMA_VERSION,
  SAVE_SLOT_COUNT,
  SAVE_SLOT_STORAGE_PREFIX,
  SAVE_STORAGE_KEY,
  type WorldSave,
} from "./saveTypes";
import { clearAllDungeonSessions } from "@/sim/dungeon/dungeonSession";

/** True iff a save blob exists in localStorage. Safe to call during
 *  SSR — returns false when window is undefined. */
export function hasSave(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SAVE_STORAGE_KEY) != null;
  } catch {
    // Private mode + storage-disabled environments raise — treat as
    // "no save" rather than propagating.
    return false;
  }
}

/** Read and parse the current save. Returns null when:
 *   - no save exists
 *   - the blob is corrupt (parse error)
 *   - the blob's schemaVersion is unknown (older than we can migrate)
 *
 *  Successful reads are migrated forward to the current schema.
 *  Callers should treat null as "no save" and route to the new-game
 *  flow rather than trying to recover. */
export function loadWorld(): WorldSave | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return migrate(parsed);
  } catch {
    return null;
  }
}

/** Persist `save` to localStorage. Always stamps the current schema
 *  version + savedAt time so the loader can migrate / display them.
 *
 *  Returns true on success, false when storage isn't writable
 *  (private mode, quota exceeded). Callers in the save-on-link path
 *  should keep going even on false — the game continues, the next
 *  link attempt will retry. */
export function saveWorld(save: WorldSave): boolean {
  if (typeof window === "undefined") return false;
  const stamped: WorldSave = {
    ...save,
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
  };
  try {
    // Roll the previous save into the backup slot BEFORE overwriting.
    // The death screen reads this slot to offer "Continue from last
    // save" — a fatal combat overwrites the current save with a
    // wiped-party state, but the prior save is still recoverable.
    const previous = window.localStorage.getItem(SAVE_STORAGE_KEY);
    if (previous != null) {
      window.localStorage.setItem(SAVE_PREV_STORAGE_KEY, previous);
    }
    window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(stamped));
    return true;
  } catch {
    return false;
  }
}

/** Read the previous-save backup. Returns null when no backup exists
 *  (very first save of the run, or the slot was cleared). Same
 *  migration semantics as `loadWorld`. */
export function loadPrevSave(): WorldSave | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SAVE_PREV_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return migrate(parsed);
  } catch {
    return null;
  }
}

/** Promote the backup slot to the current save and clear the backup.
 *  Used by the death screen's "Continue from last save" — the player
 *  steps back to the pre-fight state, the over-the-line save is
 *  discarded, and the next link will create a fresh backup. */
export function restorePrevSave(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const prev = window.localStorage.getItem(SAVE_PREV_STORAGE_KEY);
    if (prev == null) return false;
    window.localStorage.setItem(SAVE_STORAGE_KEY, prev);
    window.localStorage.removeItem(SAVE_PREV_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Remove the current save. Used by "Start over" flows after the
 *  player accepts a death screen prompt. Safe to call when no save
 *  exists.
 *
 *  Also flushes the module-scoped in-memory dungeon session store
 *  so a brand-new game re-rolls every dungeon from scratch — without
 *  this, the prior game's rolled layouts could leak through into
 *  the next run (same tab) until the player walks back into one. */
export function clearSave(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SAVE_STORAGE_KEY);
    window.localStorage.removeItem(SAVE_PREV_STORAGE_KEY);
  } catch {
    // Best-effort: if storage is unwritable, leave the blob alone.
  }
  clearAllDungeonSessions();
}

/** localStorage key for manual save slot N (1-based). Throws on an
 *  out-of-range slot — callers iterate 1..SAVE_SLOT_COUNT, so a bad
 *  index is a programming error, not a runtime condition. */
function slotStorageKey(slot: number): string {
  if (!Number.isInteger(slot) || slot < 1 || slot > SAVE_SLOT_COUNT) {
    throw new Error(`save slot out of range: ${slot}`);
  }
  return `${SAVE_SLOT_STORAGE_PREFIX}${slot}`;
}

/** Read and parse manual save slot N. Same null semantics +
 *  migration as `loadWorld`. */
export function loadSlot(slot: number): WorldSave | null {
  const key = slotStorageKey(slot);
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    return migrate(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Persist `save` into manual slot N, stamping schema version +
 *  savedAt (the moment the player committed the slot). Unlike
 *  `saveWorld` there's no backup roll — overwriting a slot is an
 *  explicit player choice. Returns false when storage isn't
 *  writable. */
export function saveToSlot(slot: number, save: WorldSave): boolean {
  const key = slotStorageKey(slot);
  if (typeof window === "undefined") return false;
  const stamped: WorldSave = {
    ...save,
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(stamped));
    return true;
  } catch {
    return false;
  }
}

/** All manual slots in order, index 0 = slot 1. Empty / corrupt
 *  slots come back null. Used by the save menu + title screen to
 *  render the slot list. */
export function listSlotSaves(): ReadonlyArray<WorldSave | null> {
  const out: Array<WorldSave | null> = [];
  for (let slot = 1; slot <= SAVE_SLOT_COUNT; slot++) {
    out.push(loadSlot(slot));
  }
  return out;
}

/** Promote manual slot N to the active save and resume from it.
 *  The slot itself is left intact (slots are durable snapshots, not
 *  a stack). The death-screen backup is cleared — it belonged to
 *  whatever game was active before — and the in-memory dungeon
 *  session store is flushed so the loaded save's `dungeons` record
 *  rehydrates from scratch instead of leaking the prior run's
 *  rolled layouts. Returns false when the slot is empty or storage
 *  isn't writable. */
export function activateSlot(slot: number): boolean {
  const key = slotStorageKey(slot);
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return false;
    // Validate before promoting — a corrupt slot shouldn't clobber
    // a working active save.
    if (migrate(JSON.parse(raw) as unknown) == null) return false;
    window.localStorage.setItem(SAVE_STORAGE_KEY, raw);
    window.localStorage.removeItem(SAVE_PREV_STORAGE_KEY);
  } catch {
    return false;
  }
  clearAllDungeonSessions();
  return true;
}

/** Filename for an exported save download —
 *  `wilderstep-save-<moduleId>-<YYYYMMDD-HHMM>.json`. */
export function exportFileName(save: WorldSave): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const moduleId = (save.moduleId || "game").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `wilderstep-save-${moduleId}-${stamp}.json`;
}

/** Trigger a browser download of `save` as a standalone JSON file.
 *  The export IS the WorldSave blob (schemaVersion included), so an
 *  import years later still runs through the same `migrate` seam as
 *  a localStorage read. Browser-only; no-op during SSR. */
export function downloadSaveExport(save: WorldSave): void {
  if (typeof window === "undefined") return;
  const stamped: WorldSave = {
    ...save,
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: save.savedAt || new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(stamped, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(stamped);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse the text of an exported save file. Returns null when the
 *  text isn't JSON, isn't a WorldSave, or carries an unknown schema
 *  version — same trust boundary as a localStorage read, since the
 *  file may have been hand-edited or truncated. */
export function parseImportedSave(text: string): WorldSave | null {
  try {
    const migrated = migrate(JSON.parse(text) as unknown);
    if (migrated == null) return null;
    // Minimal structural sanity beyond the version stamp — the
    // loader downstream assumes these exist and would crash deep
    // inside PlayHost otherwise.
    if (!migrated.moduleId || typeof migrated.moduleId !== "string") {
      return null;
    }
    if (!migrated.party || typeof migrated.party !== "object") return null;
    if (typeof migrated.party.currentMapId !== "string") return null;
    return migrated;
  } catch {
    return null;
  }
}

/** Install an imported save as the active game. Clears the death-
 *  screen backup (it belonged to the prior game) and flushes the
 *  in-memory dungeon sessions so the import's `dungeons` record
 *  rehydrates cleanly. Returns false when storage isn't writable. */
export function installImportedSave(save: WorldSave): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(save));
    window.localStorage.removeItem(SAVE_PREV_STORAGE_KEY);
  } catch {
    return false;
  }
  clearAllDungeonSessions();
  return true;
}

/** Dispatch on schemaVersion to migrate a raw blob to the current
 *  shape. Returns null for unrecognised / unmigrateable blobs so the
 *  caller falls back to "no save".
 *
 *  Add cases here when bumping the schema. Each migration step
 *  transforms vN → vN+1; chain them through fall-through. */
function migrate(raw: unknown): WorldSave | null {
  if (!raw || typeof raw !== "object") return null;
  const blob = raw as { schemaVersion?: number };
  switch (blob.schemaVersion) {
    case 1:
      // Identity — current schema.
      return raw as WorldSave;
    default:
      return null;
  }
}
