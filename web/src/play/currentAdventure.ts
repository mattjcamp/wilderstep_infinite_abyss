/**
 * Current adventure — the module the /play title screen is "connected"
 * to. The title screen shows its name and description, and New Game
 * starts a party for it directly. The player changes it with
 * "Choose a New Adventure" (the /play/new picker), and the choice is
 * remembered in this browser.
 *
 * Stored as a module id in localStorage. Every read and write is
 * guarded — private windows / blocked storage just fall back to the
 * default adventure.
 */

import type { ModuleSummary } from "@/data_model/ModuleSource";

/** Adventure a fresh browser starts connected to. */
export const DEFAULT_ADVENTURE_ID = "the-crystal-skull";

export const CURRENT_ADVENTURE_STORAGE_KEY = "wsia.play.currentAdventure";

/** The remembered adventure id, or the default when none is stored. */
export function loadCurrentAdventureId(): string {
  if (typeof window === "undefined") return DEFAULT_ADVENTURE_ID;
  try {
    const v = window.localStorage.getItem(CURRENT_ADVENTURE_STORAGE_KEY);
    return v && v.trim() ? v : DEFAULT_ADVENTURE_ID;
  } catch {
    return DEFAULT_ADVENTURE_ID;
  }
}

/** Remember `id` as the adventure the title screen opens on. */
export function saveCurrentAdventureId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CURRENT_ADVENTURE_STORAGE_KEY, id);
  } catch {
    /* storage unavailable — the choice just won't stick */
  }
}

/** Pick the adventure to show from the playable catalog: the
 *  remembered one if it's still installed, else the default, else the
 *  first playable module (e.g. a hosted catalog without the default).
 *  Null only when nothing is playable. */
export function resolveCurrentAdventure(
  playable: ReadonlyArray<ModuleSummary>,
  preferredId: string,
): ModuleSummary | null {
  return (
    playable.find((m) => m.id === preferredId) ??
    playable.find((m) => m.id === DEFAULT_ADVENTURE_ID) ??
    playable[0] ??
    null
  );
}
