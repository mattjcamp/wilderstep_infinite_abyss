/**
 * Sprite draft storage — the pixel editor's counterpart to `draft.ts`.
 *
 * Drafts land in localStorage as base64 PNG data URLs keyed by the
 * sprite's path relative to /sprites/ (e.g. "map/grass.png"). The
 * runtime (Phaser preload steps + the editor's sprite browser)
 * preferentially reads from the draft when present, so authors see
 * their edits live in-game without a server round-trip.
 *
 * Storage key shape:
 *   sprite_drafts/<moduleId>/<spritePath>   →  "data:image/png;base64,…"
 *
 * Each entry is a self-contained data URL — no compression layer
 * because PNGs are already compressed. localStorage's per-origin
 * quota (typically 5–10 MB) easily fits dozens of 32×32 sprites
 * (~1–2 KB each), with the larger person sprites still landing
 * under 5 KB apiece.
 *
 * Unlike the JSON drafts in {@link draft.ts}, sprite drafts are
 * intentionally per-asset (one localStorage entry per sprite) instead
 * of bundled. That makes copy / rename / delete operations atomic
 * without an O(N) read-modify-write of the whole sprite catalog, and
 * keeps the editor's UI logic simple — each PixelEditor instance
 * owns exactly one key.
 *
 * The companion "module-scoped" path means an edit to `map/grass.png`
 * in module A doesn't bleed into module B; switching modules in the
 * editor shows the right drafts.
 *
 * Export pipeline — out of scope here, but the natural follow-on:
 * a "Download as PNG" button on the editor decodes the data URL
 * and triggers a file save so the author can drop the edited PNG
 * back into the module folder for permanent storage.
 */

const DRAFT_PREFIX = "sprite_drafts";

function key(moduleId: string, spritePath: string): string {
  // Normalise the sprite path: strip any leading "/sprites/" and any
  // leading slash so callers can pass either form ("map/grass.png" or
  // "/sprites/map/grass.png") and land on the same key.
  const trimmed = spritePath
    .replace(/^\/?sprites\//, "")
    .replace(/^\/+/, "");
  return `${DRAFT_PREFIX}/${moduleId}/${trimmed}`;
}

/** Read the draft data URL for a sprite, or null if none /
 *  unavailable. Returns null on any storage failure so callers can
 *  treat "no draft" and "draft is corrupt" identically (fall back to
 *  the on-disk PNG). */
export function loadSpriteDraft(
  moduleId: string,
  spritePath: string,
): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key(moduleId, spritePath));
  } catch {
    return null;
  }
}

/** Write a base64 PNG data URL as the draft for this sprite. The
 *  caller is responsible for producing a valid `data:image/png;base64,…`
 *  string — typically via a canvas's `toDataURL("image/png")` call.
 *  Returns true on success, false when storage is unavailable / the
 *  quota was exceeded. */
export function saveSpriteDraft(
  moduleId: string,
  spritePath: string,
  dataUrl: string,
): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(key(moduleId, spritePath), dataUrl);
    return true;
  } catch {
    return false;
  }
}

/** Clear the draft for a sprite. Idempotent — calling on a sprite
 *  that has no draft is a silent no-op. The on-disk PNG is untouched;
 *  the next runtime load falls back to the source. */
export function discardSpriteDraft(
  moduleId: string,
  spritePath: string,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key(moduleId, spritePath));
  } catch {
    /* ignore */
  }
}

/** List every sprite path that currently carries a draft for this
 *  module. Returned as a sorted array of un-prefixed paths
 *  ("map/grass.png", "item/sword.png", …) so the editor can render a
 *  "Drafts" badge without reaching for storage keys. */
export function listSpriteDrafts(moduleId: string): ReadonlyArray<string> {
  if (typeof localStorage === "undefined") return [];
  const prefix = `${DRAFT_PREFIX}/${moduleId}/`;
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        out.push(k.slice(prefix.length));
      }
    }
  } catch {
    return [];
  }
  out.sort();
  return out;
}

/** Copy a draft (or the source-of-record if no draft exists yet for
 *  `fromPath`) into `toPath`. When `fromPath` has no draft and the
 *  caller hasn't pre-loaded the source PNG into a data URL via
 *  `sourceDataUrl`, returns false — the caller is expected to fetch
 *  the source PNG, convert it to a data URL, and pass it here so the
 *  copy can land in storage. This keeps the storage module pure (no
 *  network) while still supporting "duplicate this sprite under a
 *  new name" in the UI. */
export function copySpriteDraft(
  moduleId: string,
  fromPath: string,
  toPath: string,
  sourceDataUrl?: string | null,
): boolean {
  const existing = loadSpriteDraft(moduleId, fromPath);
  const payload = existing ?? sourceDataUrl ?? null;
  if (!payload) return false;
  return saveSpriteDraft(moduleId, toPath, payload);
}

/** True when a draft exists for this sprite. Cheap — does a single
 *  storage probe, no decode. Used by the sprite browser to show a
 *  "modified" pip next to the thumbnail. */
export function hasSpriteDraft(
  moduleId: string,
  spritePath: string,
): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(key(moduleId, spritePath)) !== null;
  } catch {
    return false;
  }
}
