/**
 * Runtime loader for the Animation catalog.
 *
 * Spells (and abilities/items/effects, when those grow runtime
 * dispatch) reference `animation_id` strings; combat code needs to
 * resolve those into the underlying { visual, cast_sfx, hit_sfx }
 * bundle. This module owns that lookup.
 *
 * Why a separate loader (not reusing the AnimationPicker's cache):
 *   - The picker lives under web/src/editor/, which only ships with
 *     the editor bundles. Pulling combat code into the editor folder
 *     would invert the dependency. Putting the catalog here under
 *     /vfx/ keeps it sibling to effectRegistry.ts, where the visuals
 *     it references already live.
 *   - The picker fetches on first open; combat needs it loaded
 *     before the first cast. Easier to give each their own thin
 *     loader than to share state through a third module.
 *
 * The catalog lives at /modules/default/animations.json (the user's
 * declared canonical home). If/when per-module overrides become a
 * thing, this loader can layer a chain — the public API
 * (loadAnimations, getAnimationById) is stable across that change.
 *
 * Failure mode: a missing or malformed catalog resolves to an empty
 * map. getAnimationById returns null, callers fall back to legacy
 * dispatch. We never throw — combat shouldn't crash because the
 * animations file is unreachable.
 */

import { withBasePath } from "@/util/basePath";

export interface AnimationRecord {
  id: string;
  name: string;
  description?: string;
  /** Key into the VFX projectile registry (lightning_bolt,
   *  magic_dart, magic_arrow, …) or the literal "none" to opt out
   *  of a visual entirely. */
  visual?: string;
  /** SFX name played at cast time. Matches a generator in
   *  v1battle/audio/Sfx.ts. Empty string = silent. */
  cast_sfx?: string;
  /** SFX name played on impact. Same catalog rules as cast_sfx. */
  hit_sfx?: string;
}

interface AnimationsFile {
  _comment?: string;
  animations?: AnimationRecord[];
}

const DEFAULT_URL = "/modules/default/animations.json";

let _cache: Map<string, AnimationRecord> | null = null;
let _inflight: Promise<Map<string, AnimationRecord>> | null = null;

/** Fetch + cache the catalog. Safe to call concurrently — the in-
 *  flight promise is shared. Always resolves to a Map (possibly
 *  empty) so callers can `.get` without an existence check. */
export async function loadAnimations(
  url: string = withBasePath(DEFAULT_URL),
): Promise<Map<string, AnimationRecord>> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AnimationsFile;
      const map = new Map<string, AnimationRecord>();
      for (const a of data.animations ?? []) {
        if (a && typeof a.id === "string") map.set(a.id, a);
      }
      _cache = map;
      return map;
    } catch {
      // Empty map = "catalog unavailable" — every lookup returns
      // null and callers fall back. We log once at the console so
      // a misconfigured deploy is visible without breaking combat.
      // eslint-disable-next-line no-console
      console.warn(`[animationsCatalog] failed to load ${url}`);
      _cache = new Map();
      return _cache;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Synchronous lookup. Returns null when the id is empty, the
 *  catalog isn't loaded yet, or the id isn't in the catalog. */
export function getAnimationById(
  id: string | null | undefined,
): AnimationRecord | null {
  if (!id || !_cache) return null;
  return _cache.get(id) ?? null;
}

/** Test-only — drop the cache so a stubbed fetch can be tested
 *  cleanly. */
export function __resetAnimationsCatalogForTests(): void {
  _cache = null;
  _inflight = null;
}
