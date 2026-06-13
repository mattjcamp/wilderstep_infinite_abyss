/**
 * spriteUrl — resolve a bare sprite reference to a fetchable URL,
 * routing an author's CUSTOM published sprites to the hosted worker
 * while leaving STOCK sprites on the static origin.
 *
 * Module records reference sprites bare/category-relative
 * ("person/hero.png") whether the art is a shipped stock sprite (lives
 * at the origin `/sprites/person/hero.png`, bundled into the static
 * export) or an author upload (lives in R2 at
 * `sprites/@<handle>/person/hero.png`, written by the publish API).
 * The ONLY way to tell them apart is the owner's sprite index
 * `sprites/@<handle>/index.json`.
 *
 * So at play boot we pre-seed the active hosted module's owner index
 * into a module-scoped cache (mirroring src/play/seedBattleCaches.ts),
 * making the per-sprite membership check a synchronous Set lookup — the
 * resolvers run deep inside Phaser and can't await a fetch per call.
 *
 * STRICT NO-OP off the remote/hosted path: `ownerHandleOf` is null for
 * bare and `@core/*` ids, and `getReadHost()` is null unless
 * `NEXT_PUBLIC_MODULE_SOURCE === "remote"`. Either null → every sprite
 * takes the stock branch, byte-identical to the prior
 * `withBasePath("/sprites/" + path)` behavior (local dev + github.io
 * unchanged).
 */

import { withBasePath } from "@/util/basePath";
import { getReadHost } from "./sourceConfig";
import { ownerHandleOf } from "./moduleIds";

interface OwnerSpriteIndex {
  /** category → set of bare PNG filenames the owner uploaded. */
  categories: Record<string, Set<string>>;
}

// Module-scoped routing state, seeded once per play boot. Null state
// (the default, and after clearSpriteRouting) means "route everything
// to the stock origin".
let _ownerHandle: string | null = null;
let _readHost: string | null = null;
let _ownerIndex: OwnerSpriteIndex | null = null;

/** Normalise a raw ref to "<category>/<file>": drop a leading slash and
 *  an accidental "sprites/" prefix. Mirrors spriteDraft.key() and the
 *  resolution in Party.ts so callers can pass either form. */
function normalizeSpritePath(raw: string): string {
  return raw.replace(/^\/?sprites\//, "").replace(/^\/+/, "");
}

/** True when the active owner's index lists `clean` ("<cat>/<file>") as
 *  one of their custom uploads. False (→ stock) when no index is
 *  seeded, the path has no category segment, or the file isn't listed. */
export function ownerIndexHas(clean: string): boolean {
  if (!_ownerIndex) return false;
  const slash = clean.indexOf("/");
  if (slash < 0) return false;
  const cat = clean.slice(0, slash);
  const file = clean.slice(slash + 1);
  return _ownerIndex.categories[cat]?.has(file) ?? false;
}

/** Resolve a bare (or already-resolved) sprite ref to a URL. Custom
 *  uploads of the active hosted module route to the worker under the
 *  owner prefix; everything else stays on the static origin. */
export function spriteUrl(raw: string): string {
  if (!raw) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const clean = normalizeSpritePath(raw);
  if (_ownerHandle && _readHost && ownerIndexHas(clean)) {
    return `${_readHost}/sprites/@${_ownerHandle}/${clean}`;
  }
  return withBasePath(`/sprites/${clean}`);
}

/** Seed the sprite-routing cache for a play session. No-op (clears to
 *  stock-only) for local/static mode, bare ids, and `@core/*`. Fetches
 *  the owner index; any failure (incl. the common "no custom sprites →
 *  404") fails open, leaving every sprite on the stock origin. Call
 *  once at each play boot BEFORE sprites are resolved. */
export async function seedSpriteRouting(moduleId: string): Promise<void> {
  clearSpriteRouting();
  const handle = ownerHandleOf(moduleId);
  const host = getReadHost();
  if (!handle || !host) return;
  _ownerHandle = handle;
  _readHost = host;
  try {
    const res = await fetch(`${host}/sprites/@${handle}/index.json`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const raw = (await res.json()) as {
      categories?: Record<string, unknown>;
    };
    const categories: Record<string, Set<string>> = {};
    for (const [cat, files] of Object.entries(raw.categories ?? {})) {
      if (Array.isArray(files)) {
        categories[cat] = new Set(files.filter((f): f is string => typeof f === "string"));
      }
    }
    _ownerIndex = { categories };
  } catch {
    _ownerIndex = null;
  }
}

/** Reset routing to stock-only. Pairs with the cache resets in
 *  seedBattleCaches so a different play session can't reuse the prior
 *  owner's index. */
export function clearSpriteRouting(): void {
  _ownerHandle = null;
  _readHost = null;
  _ownerIndex = null;
}

/** Test-only state injector (bypasses the fetch). */
export function __setSpriteRoutingForTests(
  handle: string | null,
  host: string | null,
  index: Record<string, string[]> | null,
): void {
  _ownerHandle = handle;
  _readHost = host;
  _ownerIndex = index
    ? {
        categories: Object.fromEntries(
          Object.entries(index).map(([c, f]) => [c, new Set(f)]),
        ),
      }
    : null;
}
