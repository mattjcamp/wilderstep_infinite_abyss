/**
 * Soundtrack tags — organizational labels on entries in
 * /audio/index.json (`tracks: [{ path, name?, gain?, tags? }]`).
 *
 * Every track carries at least one tag. A track with no `tags` (or an
 * empty list) reads as the default "Ambient", so older index files and
 * newly dropped-in audio land in a sensible bucket without any manual
 * step. Tags are editor-only: they shape the Soundtrack editor and the
 * SoundtrackPicker (Module / Map / Dungeon properties) and play no part
 * in playback.
 */

export const DEFAULT_TRACK_TAG = "Ambient";

/** Normalise a raw `tags` value to a clean, de-duplicated list
 *  (trimmed, non-empty strings, original order). Falls back to the
 *  default tag when nothing usable is left. */
export function trackTagsOf(raw: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (typeof t !== "string") continue;
      const s = t.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out.length > 0 ? out : [DEFAULT_TRACK_TAG];
}

/** Tag ordering: the default tag first, then alphabetical
 *  (case-insensitive). */
export function compareTrackTags(a: string, b: string): number {
  if (a === b) return 0;
  if (a === DEFAULT_TRACK_TAG) return -1;
  if (b === DEFAULT_TRACK_TAG) return 1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** Every tag used by any track, in compareTrackTags order. */
export function allTrackTags(
  tracks: ReadonlyArray<{ tags?: unknown }>,
): string[] {
  const set = new Set<string>();
  for (const t of tracks) for (const tag of trackTagsOf(t.tags)) set.add(tag);
  return [...set].sort(compareTrackTags);
}

/** Group tracks by tag. A track with several tags appears under each
 *  of them (same convention as the editor's map tag tree). Groups come
 *  back in compareTrackTags order; tracks keep their incoming order
 *  within a group. */
export function groupTracksByTag<T extends { tags?: unknown }>(
  tracks: ReadonlyArray<T>,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const t of tracks) {
    for (const tag of trackTagsOf(t.tags)) {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(t);
    }
  }
  return [...groups.keys()]
    .sort(compareTrackTags)
    .map((k) => [k, groups.get(k)!]);
}
