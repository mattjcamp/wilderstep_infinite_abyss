/**
 * localStorage save layer.
 *
 * Single-slot auto-save. Every play-side write goes through `saveWorld`;
 * the entire WorldSave is serialised to JSON and persisted under
 * `SAVE_STORAGE_KEY`. Reads go through `loadWorld` which:
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
  SAVE_STORAGE_KEY,
  type WorldSave,
} from "./saveTypes";

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
 *  exists. */
export function clearSave(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SAVE_STORAGE_KEY);
    window.localStorage.removeItem(SAVE_PREV_STORAGE_KEY);
  } catch {
    // Best-effort: if storage is unwritable, leave the blob alone.
  }
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
