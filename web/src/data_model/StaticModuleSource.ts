/**
 * StaticModuleSource — reads modules from the static site's served
 * files under /modules/<id>/.
 *
 * URLs are passed through withBasePath() so GH Pages's repo prefix is
 * applied automatically when the env var is set at build time.
 *
 * The list of modules lives in /modules/index.json. Each module
 * declares its own metadata in /modules/<id>/module.json, including
 * optional `extends` (single parent — your base) and `uses` (an
 * import palette of library modules).
 *
 * Resolution layers the data in this order:
 *   1. extends chain, root-first (default → ... → parent)
 *   2. the requested module's own file
 *
 * Library content from `uses` is NOT in the resolved view — it's
 * surfaced separately via listLibraryRecords as a catalog. The
 * editor renders an Import button per library record; importing
 * copies the record into the module's own file as a regular new
 * record, decoupled from the library.
 *
 * Merge semantics:
 *   - collections (records under a collectionKey, addressed by id)
 *     are merged by id — later records override earlier records of
 *     the same id; new ids are appended.
 *   - singletons (collectionKey === null, e.g. party) are replaced
 *     wholesale by the later layer.
 *   - files missing at a level fall through.
 */

import { withBasePath } from "@/util/basePath";
import { loadDraft, loadIndexDraft, MANIFEST_KEY } from "./draft";
import { moduleIdsEqual, moduleStorageSegment } from "./moduleIds";
import { extractRecords, mergeModel } from "./merge";
import { ALL_MODEL_KEYS, MODELS, type ModelKey } from "./models";
import type {
  LibraryCatalogEntry,
  LoadedModule,
  ModelLayers,
  ModuleSource,
  ModuleSummary,
} from "./ModuleSource";

interface IndexEntry {
  id: string;
  title?: string;
  role?: string;
}

interface IndexFile {
  modules?: IndexEntry[];
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function tryFetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Where module files live. StaticModuleSource defaults to the
 *  deployed static tree; RemoteModuleSource swaps in a hosted Read
 *  API origin with the SAME path layout (the UGC plan keeps the
 *  on-disk tree as the storage key layout, so one locator shape
 *  covers both). `moduleStorageSegment` applies @core aliasing +
 *  validity, so callers pass ids in either form. */
export interface ModuleFileLocator {
  /** URL of `<module>/<fileName>` (e.g. "tavern", "races.json"). */
  moduleFile(moduleId: string, fileName: string): string;
  /** URL of the catalog/index listing. */
  index(): string;
}

/** Default locator — the static export under /modules/. */
export function staticLocator(): ModuleFileLocator {
  return {
    moduleFile: (moduleId, fileName) =>
      withBasePath(`/modules/${moduleStorageSegment(moduleId)}/${fileName}`),
    index: () => withBasePath("/modules/index.json"),
  };
}

/** Read a module's manifest, preferring a localStorage draft when
 *  present. Returns null if neither exists (e.g., a brand-new module
 *  whose draft hasn't been saved yet — caller should treat as
 *  missing). */
async function loadModuleManifest(
  moduleId: string,
  locator: ModuleFileLocator,
  preferDrafts: boolean,
): Promise<(Partial<ModuleSummary> & { id?: string }) | null> {
  if (preferDrafts) {
    const draft = await loadDraft<Partial<ModuleSummary> & { id?: string }>(
      moduleId,
      MANIFEST_KEY,
    );
    if (draft) return draft;
  }
  return tryFetchJson(
    locator.moduleFile(moduleId, "module.json"),
  ) as Promise<(Partial<ModuleSummary> & { id?: string }) | null>;
}

function toSummary(
  meta: Partial<ModuleSummary> & {
    id?: string;
    extends?: string;
    uses?: string[];
    soundtrack?: string[];
    settings?: { sight_radius?: Record<string, unknown> };
  },
  fallback: { id: string; title?: string; role?: string },
): ModuleSummary {
  return {
    id: meta.id ?? fallback.id,
    title: meta.title ?? fallback.title ?? fallback.id,
    description: meta.description ?? "",
    author: meta.author ?? "",
    version: meta.version ?? "0.0.0",
    role: meta.role ?? fallback.role,
    extends: meta.extends,
    uses: meta.uses,
    // Carry the default soundtrack through so the Module Properties
    // dialog re-opens with the current playlist instead of an empty
    // picker. Filter to strings + drop blanks so a stale manifest
    // with junk entries doesn't surface a misleading row.
    soundtrack: Array.isArray(meta.soundtrack)
      ? meta.soundtrack.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : undefined,
    // Surface the manifest's own `settings.sight_radius` (NOT the
    // inheritance-resolved value — the dialog edits THIS module's
    // file, so it must show only what this file declares). Sanitised
    // to finite non-negative numbers per mode; unknown / junk entries
    // are dropped so the dialog never shows a bogus row.
    sightRadius: sanitizeSightRadius(meta.settings?.sight_radius),
  };
}

/** Pull a clean `{ day?, twilight?, night? }` radius map out of a raw
 *  manifest `settings.sight_radius` blob. Returns `undefined` when the
 *  input is absent or contributes no valid entries, so callers can
 *  treat "no overrides" uniformly. */
function sanitizeSightRadius(
  raw: unknown,
): Partial<Record<"day" | "twilight" | "night", number>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const byMode = raw as Record<string, unknown>;
  const out: Partial<Record<"day" | "twilight" | "night", number>> = {};
  for (const mode of ["day", "twilight", "night"] as const) {
    const v = byMode[mode];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[mode] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Gather library ids from an extends chain. Walks root-first so that
 *  parent-declared uses come before child-declared uses, mirroring
 *  the merge order. Deduplicates: the first declaration wins. */
function collectUsedLibraryIds(chain: ModuleSummary[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const uses = chain[i].uses ?? [];
    for (const libId of uses) {
      if (seen.has(libId)) continue;
      // Don't apply a library that's already in the extends chain —
      // it would double-merge its own file. Alias-aware so
      // "@core/tavern" and "tavern" count as the same module.
      if (chain.some((c) => moduleIdsEqual(c.id, libId))) continue;
      seen.add(libId);
      out.push(libId);
    }
  }
  return out;
}

/** Walk a module's extends chain from the requested module up to the
 *  root. Returns an array ordered leaf-to-root (so the requested
 *  module is at index 0). Prefers localStorage manifest drafts over
 *  on-disk module.json so unexported edits to `extends`/`uses` take
 *  effect immediately. */
async function walkExtendsChain(
  moduleId: string,
  locator: ModuleFileLocator,
  preferDrafts: boolean,
): Promise<ModuleSummary[]> {
  const visited = new Set<string>();
  const chain: ModuleSummary[] = [];
  let currentId: string | undefined = moduleId;
  while (currentId) {
    // Cycle detection keys off the ALIAS-RESOLVED id so a chain
    // that mixes "@core/default" and "default" spellings is still
    // recognised as revisiting the same module.
    const key = moduleStorageSegment(currentId);
    if (visited.has(key)) {
      throw new Error(
        `Module extends cycle detected at ${currentId} while resolving ${moduleId}`,
      );
    }
    visited.add(key);
    const meta = await loadModuleManifest(currentId, locator, preferDrafts);
    if (!meta) {
      throw new Error(
        `Module ${currentId} has no manifest (no draft, no /modules/${currentId}/module.json) while resolving ${moduleId}`,
      );
    }
    const summary = toSummary(meta, { id: currentId });
    chain.push(summary);
    currentId = summary.extends;
  }
  return chain;
}

export class StaticModuleSource implements ModuleSource {
  /** File locations — static tree by default; RemoteModuleSource
   *  passes a hosted-origin locator and inherits everything else
   *  (extends/uses resolution, merge) unchanged. */
  protected readonly locator: ModuleFileLocator;
  /** Whether localStorage drafts shadow published files. TRUE for
   *  the editor (drafts are the working copy); FALSE for the game
   *  (published-only — see sourceConfig). Without this split, a
   *  leftover index/manifest draft silently shadowed the HOSTED
   *  catalog in remote play mode. */
  protected readonly preferDrafts: boolean;

  constructor(
    locator: ModuleFileLocator = staticLocator(),
    opts?: { preferDrafts?: boolean },
  ) {
    this.locator = locator;
    this.preferDrafts = opts?.preferDrafts ?? true;
  }

  async list(): Promise<ModuleSummary[]> {
    // Editor mode prefers the localStorage index draft so newly-
    // created modules show up in the picker before publishing;
    // game mode (preferDrafts false) always reads the real index.
    const draftIndex = this.preferDrafts
      ? await loadIndexDraft<IndexFile>()
      : null;
    // The catalog index is the freshness-critical resource — a stale
    // copy hides newly published modules entirely (and module rows
    // are only attempted for ids the index lists, so the failure is
    // silent). Bypass every HTTP cache layer for it.
    const index = draftIndex ?? ((await fetchJson(
      this.locator.index(),
      { cache: "no-store" },
    )) as IndexFile);
    const entries = index.modules ?? [];
    const out: ModuleSummary[] = [];
    for (const entry of entries) {
      try {
        const meta = await loadModuleManifest(entry.id, this.locator, this.preferDrafts);
        if (!meta) throw new Error(`no manifest`);
        out.push(toSummary(meta, entry));
      } catch (e) {
        // Module unreachable — skip with a console warning so the picker
        // still renders rather than throwing.
        // eslint-disable-next-line no-console
        console.warn(`Module ${entry.id} failed to load:`, e);
      }
    }
    return out;
  }

  async load(moduleId: string): Promise<LoadedModule> {
    const chain = await walkExtendsChain(moduleId, this.locator, this.preferDrafts);
    const summary = chain[0];

    const data: Record<string, unknown> = {};
    // Apply ancestors root-first; the requested module's own file is
    // applied last. Library content (from `uses`) is intentionally
    // NOT merged here — it's surfaced via listLibraryRecords instead
    // so authors can opt records in explicitly.
    for (let i = chain.length - 1; i >= 1; i--) {
      const s = chain[i];
      for (const key of ALL_MODEL_KEYS) {
        const def = MODELS[key];
        const levelData = await tryFetchJson(
          this.locator.moduleFile(s.id, def.fileName),
        );
        if (levelData === null) continue;
        data[key] = mergeModel(def.collectionKey, data[key], levelData);
      }
    }
    for (const key of ALL_MODEL_KEYS) {
      const def = MODELS[key];
      const ownLevel = await tryFetchJson(
        this.locator.moduleFile(moduleId, def.fileName),
      );
      if (ownLevel === null) continue;
      data[key] = mergeModel(def.collectionKey, data[key], ownLevel);
    }

    return { summary, data };
  }

  /** Convenience: load one model's resolved data without pulling the
   *  whole module. Walks the extends chain for just this model.
   *  Used by the per-model browse page to keep network traffic
   *  minimal. */
  async loadModel(moduleId: string, key: ModelKey): Promise<unknown> {
    const layers = await this.loadModelLayers(moduleId, key);
    return mergeModel(MODELS[key].collectionKey, layers.inherited, layers.ownFile);
  }

  /** Layered loader: returns the inherited data (extends chain only)
   *  and the current module's own file separately. The editor uses
   *  this to compute per-row provenance (inherited vs overridden vs
   *  new), to support copy-on-write editing, and to export just the
   *  overlay rather than the resolved view. Library content lives
   *  in the catalog returned by listLibraryRecords, not here. */
  async loadModelLayers(
    moduleId: string,
    key: ModelKey,
  ): Promise<ModelLayers> {
    const def = MODELS[key];
    const chain = await walkExtendsChain(moduleId, this.locator, this.preferDrafts);
    const usedLibraryIds = collectUsedLibraryIds(chain);

    // Inherited = the extends chain above this module, root-first.
    let inherited: unknown = null;
    for (let i = chain.length - 1; i >= 1; i--) {
      const id = chain[i].id;
      const levelData = await tryFetchJson(
        this.locator.moduleFile(id, def.fileName),
      );
      if (levelData === null) continue;
      inherited = mergeModel(def.collectionKey, inherited, levelData);
    }

    // ownFile = the requested module's own JSON, or null if absent.
    const ownFile = await tryFetchJson(
      this.locator.moduleFile(moduleId, def.fileName),
    );

    return {
      inherited,
      ownFile,
      parentId: chain[1]?.id,
      usedLibraryIds,
    };
  }

  /** Read a module's raw manifest (the full module.json blob),
   *  preferring a localStorage draft over the on-disk file. The
   *  editor uses this when editing the manifest so it can preserve
   *  fields the typed ModuleSummary view doesn't carry (`_comment`,
   *  unknown fields a contributor added, etc.). Returns null if the
   *  module is unknown. */
  async loadRawManifest(
    moduleId: string,
  ): Promise<Record<string, unknown> | null> {
    const meta = await loadModuleManifest(moduleId, this.locator, this.preferDrafts);
    if (!meta) return null;
    return meta as Record<string, unknown>;
  }

  /** Resolve the default soundtrack playlist for `moduleId`, walking
   *  the extends chain leaf-first and returning the first ancestor's
   *  list that's non-empty. Returns `[]` when nothing along the chain
   *  defines a soundtrack.
   *
   *  Inheritance design: declaring a soundtrack on `default` means
   *  every child module (test3, test4, …) inherits it for free,
   *  matching how every other catalog (maps.json, monsters.json,
   *  etc.) propagates down the chain. A child can still override by
   *  setting its own soundtrack — leaf wins. */
  async resolveModuleSoundtrack(moduleId: string): Promise<string[]> {
    const chain = await walkExtendsChain(moduleId, this.locator, this.preferDrafts);
    // walkExtendsChain returns leaf-first (index 0 = the requested
    // module, end = root). Walk in that order; first non-empty list
    // wins, so a leaf override beats a parent definition.
    for (const summary of chain) {
      const meta = await loadModuleManifest(summary.id, this.locator, this.preferDrafts);
      if (!meta) continue;
      const list = (meta as { soundtrack?: unknown }).soundtrack;
      if (Array.isArray(list)) {
        const clean = list.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        );
        if (clean.length > 0) return clean;
      }
    }
    return [];
  }

  /** Resolve the per-lighting-mode exploration sight radius for
   *  `moduleId` from `settings.sight_radius` in module.json, walking
   *  the extends chain leaf-first. Returns a partial map (only the
   *  modes the chain actually specifies); the engine fills the rest
   *  from `DEFAULT_SIGHT_RADIUS`. Same inheritance contract as the
   *  soundtrack: a leaf module's value for a given mode wins over an
   *  ancestor's, resolved mode-by-mode so a child can widen just
   *  `day` while inheriting the parent's `night`. Non-numeric / out-
   *  of-range entries are dropped. */
  async resolveModuleSightRadius(
    moduleId: string,
  ): Promise<Partial<Record<"day" | "twilight" | "night", number>>> {
    const chain = await walkExtendsChain(moduleId, this.locator, this.preferDrafts);
    const out: Partial<Record<"day" | "twilight" | "night", number>> = {};
    const modes = ["day", "twilight", "night"] as const;
    // Leaf-first walk: the first ancestor to define a given mode wins,
    // so we only write a mode the first time we see it.
    for (const summary of chain) {
      const meta = await loadModuleManifest(summary.id, this.locator, this.preferDrafts);
      if (!meta) continue;
      const settings = (meta as { settings?: { sight_radius?: unknown } })
        .settings;
      const raw = settings?.sight_radius;
      if (!raw || typeof raw !== "object") continue;
      const byMode = raw as Record<string, unknown>;
      for (const mode of modes) {
        if (out[mode] !== undefined) continue;
        const v = byMode[mode];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
          out[mode] = v;
        }
      }
    }
    return out;
  }

  /** Catalog of records available for import from the libraries this
   *  module `uses`. Each entry is one library + the records it
   *  declares in its own file. Singletons (collectionKey === null)
   *  return an empty catalog — they can't be opted-in piecewise.
   *  The editor filters out records whose id already appears in the
   *  module's resolved view (inherited or own) before rendering. */
  async listLibraryRecords(
    moduleId: string,
    key: ModelKey,
  ): Promise<LibraryCatalogEntry[]> {
    const def = MODELS[key];
    if (def.collectionKey === null) return [];
    const chain = await walkExtendsChain(moduleId, this.locator, this.preferDrafts);
    const usedLibraryIds = collectUsedLibraryIds(chain);
    const out: LibraryCatalogEntry[] = [];
    for (const libId of usedLibraryIds) {
      const libData = await tryFetchJson(
        this.locator.moduleFile(libId, def.fileName),
      );
      if (libData === null) continue;
      const records = extractRecords(def.collectionKey, libData);
      if (records.length === 0) continue;
      out.push({ libraryId: libId, records });
    }
    return out;
  }
}
