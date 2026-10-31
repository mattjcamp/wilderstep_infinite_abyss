/**
 * spriteUrl — resolve a bare sprite reference to a fetchable URL,
 * routing an author's CUSTOM published sprites to the hosted worker
 * while leaving STOCK sprites on the static origin.
 *
 * Module records reference sprites bare/category-relative
 * ("person/hero.png") whether the art is a shipped stock sprite (lives
 * in a module's `sprites/` folder on the origin — the base art in
 * `/modules/default/sprites/person/hero.png` — bundled into the static
 * export; see "Module sprite layers" below) or an author upload (lives in R2 at
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
import spriteAliasData from "./spriteAliases.json";

/** Legacy sprite path → current path (sprites were moved into folders
 *  mirroring the Tile Palette tag hierarchy). Applied only when the
 *  path as written isn't found anywhere, so a module that still ships
 *  or uploads an override at an old path keeps winning. */
const SPRITE_ALIASES: Record<string, string> =
  (spriteAliasData as { aliases: Record<string, string> }).aliases;

/** Current path for a (possibly legacy) "<cat>/<file>" sprite ref. */
export function canonicalSpritePath(raw: string): string {
  const clean = normalizeSpritePath(raw);
  return SPRITE_ALIASES[clean] ?? clean;
}

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
  const written = normalizeSpritePath(raw);
  const aliased = SPRITE_ALIASES[written];
  // Try the path as written first, then (for a legacy flat path) its
  // new home, so an override still published at the old path wins.
  for (const clean of aliased ? [written, aliased] : [written]) {
    if (_ownerHandle && _readHost && ownerIndexHas(clean)) {
      return `${_readHost}/sprites/@${_ownerHandle}/${clean}`;
    }
    // Module layers, nearest first (the module, its parents, …). The
    // first module whose sprite index lists the file supplies it.
    for (const layer of _layers) {
      if (layer.files.has(clean)) return moduleSpriteUrl(layer.moduleId, clean);
    }
  }
  // Base art always lives in the Default module.
  return moduleSpriteUrl(BASE_SPRITE_MODULE, aliased ?? written);
}

// ── Module sprite layers ────────────────────────────────────────────
//
// Every module may ship its own art in `modules/<id>/sprites/<cat>/…`
// with a generated `sprites/index.json`. The base art lives in the
// Default module. A sprite reference ("map/grass.png") resolves to the
// nearest module in the active module's chain that has the file, so a
// module (or later, its art theme) can override any subset of the base
// art and fall back to it for the rest.

/** Module that holds the base art every chain falls back to. */
export const BASE_SPRITE_MODULE = "default";

interface SpriteLayer {
  moduleId: string;
  /** "<category>/<file>" entries from the module's sprite index. */
  files: Set<string>;
  categories: Record<string, string[]>;
}

let _layers: SpriteLayer[] = [];

function moduleSpriteUrl(moduleId: string, clean: string): string {
  return withBasePath(`/modules/${moduleId}/sprites/${clean}`);
}

/** Read one module's sprite index; null when it has no sprites. */
async function fetchModuleSpriteIndex(
  moduleId: string,
): Promise<Record<string, string[]> | null> {
  try {
    const res = await fetch(spriteIndexUrl(moduleId), { cache: "no-store" });
    if (!res.ok) return null;
    const raw = (await res.json()) as { categories?: Record<string, unknown> };
    const out: Record<string, string[]> = {};
    for (const [cat, files] of Object.entries(raw.categories ?? {})) {
      if (Array.isArray(files)) {
        out[cat] = files.filter((f): f is string => typeof f === "string");
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** One module in a chain, as far as sprite layering cares. */
export interface SpriteChainEntry {
  id: string;
  extends?: string;
  theme?: string;
}

/** The module's `extends` chain, nearest first, read from the static
 *  module.json files (published content — what the game plays). Stops
 *  quietly at anything it can't read (hosted ids, a missing manifest);
 *  the Default fallback still applies. */
async function staticModuleChain(moduleId: string): Promise<SpriteChainEntry[]> {
  const chain: SpriteChainEntry[] = [];
  let current: string | undefined = moduleId;
  while (current && !chain.some((c) => c.id === current) && chain.length < 16) {
    if (ownerHandleOf(current)) break; // hosted: not on the static tree
    const entry: SpriteChainEntry = { id: current };
    chain.push(entry);
    try {
      const res = await fetch(withBasePath(`/modules/${current}/module.json`), {
        cache: "no-store",
      });
      if (!res.ok) break;
      const meta = (await res.json()) as { extends?: unknown; theme?: unknown };
      if (typeof meta.theme === "string" && meta.theme.trim()) {
        entry.theme = meta.theme.trim();
      }
      current =
        typeof meta.extends === "string" && meta.extends
          ? meta.extends
          : current === BASE_SPRITE_MODULE
            ? undefined
            : BASE_SPRITE_MODULE;
    } catch {
      break;
    }
  }
  return chain;
}

/** Same chain, built from already-loaded module summaries (the editor
 *  passes its draft-aware list so an unpublished theme pick applies). */
function chainFromSummaries(
  moduleId: string,
  summaries: ReadonlyArray<SpriteChainEntry>,
): SpriteChainEntry[] {
  const byId = new Map(summaries.map((m) => [m.id, m]));
  const chain: SpriteChainEntry[] = [];
  let current: string | undefined = moduleId;
  while (current && !chain.some((c) => c.id === current) && chain.length < 16) {
    const m: SpriteChainEntry = byId.get(current) ?? { id: current };
    chain.push(m);
    current = m.extends ?? (current === BASE_SPRITE_MODULE ? undefined : BASE_SPRITE_MODULE);
  }
  return chain;
}

/** Module ids whose `sprites/` folders a module draws from, nearest
 *  first: the module itself, its art theme (the nearest theme declared
 *  along the chain), each parent, then Default. Pure — exported for
 *  tests. */
export function spriteLayerOrder(chain: ReadonlyArray<SpriteChainEntry>): string[] {
  const out: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !out.includes(id)) out.push(id);
  };
  add(chain[0]?.id);
  add(chain.find((c) => c.theme)?.theme);
  for (const c of chain.slice(1)) add(c.id);
  add(BASE_SPRITE_MODULE);
  return out;
}

/** Load the sprite layers for `moduleId`: its own sprites, its art
 *  theme's, each parent's, then Default's. Called by
 *  `seedSpriteRouting` at play boot (published manifests) and by the
 *  editor shell (pass its draft-aware module list as `summaries`),
 *  before any sprite is resolved. */
export async function seedSpriteLayers(
  moduleId: string,
  summaries?: ReadonlyArray<SpriteChainEntry>,
): Promise<void> {
  const chain = summaries
    ? chainFromSummaries(moduleId, summaries)
    : await staticModuleChain(moduleId);
  const order = spriteLayerOrder(chain);
  const indexes = await Promise.all(order.map(fetchModuleSpriteIndex));
  _layers = [];
  order.forEach((id, i) => {
    const categories = indexes[i];
    if (!categories) return;
    const files = new Set<string>();
    for (const [cat, list] of Object.entries(categories)) {
      for (const f of list) files.add(`${cat}/${f}`);
    }
    _layers.push({ moduleId: id, files, categories });
  });
}

/** Module ids of the currently seeded layers, nearest first. */
export function seededSpriteLayers(): string[] {
  return _layers.map((l) => l.moduleId);
}

/** Merged sprite catalog for the seeded module chain: every
 *  category → filenames any layer provides, plus which module supplies
 *  each "<cat>/<file>". Falls back to the base module's index when no
 *  layers are seeded (pages that resolve sprites without a module). */
export async function fetchSpriteCatalog(): Promise<{
  categories: Record<string, string[]>;
  origin: Record<string, string>;
}> {
  let layers = _layers;
  if (layers.length === 0) {
    const base = await fetchModuleSpriteIndex(BASE_SPRITE_MODULE);
    layers = base
      ? [{ moduleId: BASE_SPRITE_MODULE, files: new Set(), categories: base }]
      : [];
  }
  const categories: Record<string, string[]> = {};
  const origin: Record<string, string> = {};
  for (const layer of layers) {
    for (const [cat, list] of Object.entries(layer.categories)) {
      const bucket = (categories[cat] ??= []);
      for (const f of list) {
        const key = `${cat}/${f}`;
        if (key in origin) continue; // nearer layer already supplies it
        origin[key] = layer.moduleId;
        bucket.push(f);
      }
    }
  }
  for (const list of Object.values(categories)) list.sort();
  return { categories, origin };
}

/** Seed the sprite-routing cache for a play session. No-op (clears to
 *  stock-only) for local/static mode, bare ids, and `@core/*`. Fetches
 *  the owner index; any failure (incl. the common "no custom sprites →
 *  404") fails open, leaving every sprite on the stock origin. Call
 *  once at each play boot BEFORE sprites are resolved. */
export async function seedSpriteRouting(
  moduleId: string,
  summaries?: ReadonlyArray<SpriteChainEntry>,
): Promise<void> {
  clearSpriteRouting();
  await seedSpriteLayers(moduleId, summaries);
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
  _layers = [];
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

/** Test-only: install sprite layers directly (bypasses the fetches).
 *  Entries are nearest-first: [moduleId, category → filenames]. */
export function __setSpriteLayersForTests(
  layers: Array<[string, Record<string, string[]>]>,
): void {
  _layers = layers.map(([moduleId, categories]) => {
    const files = new Set<string>();
    for (const [cat, list] of Object.entries(categories)) {
      for (const f of list) files.add(`${cat}/${f}`);
    }
    return { moduleId, files, categories };
  });
}

/** URL of a module's generated sprite index (category → filenames). */
export function spriteIndexUrl(moduleId: string = BASE_SPRITE_MODULE): string {
  return withBasePath(`/modules/${moduleId}/sprites/index.json`);
}
