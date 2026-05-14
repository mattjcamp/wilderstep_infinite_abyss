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

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
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

/** Read a module's manifest, preferring a localStorage draft when
 *  present. Returns null if neither exists (e.g., a brand-new module
 *  whose draft hasn't been saved yet — caller should treat as
 *  missing). */
async function loadModuleManifest(
  moduleId: string,
): Promise<(Partial<ModuleSummary> & { id?: string }) | null> {
  const draft = loadDraft<Partial<ModuleSummary> & { id?: string }>(
    moduleId,
    MANIFEST_KEY,
  );
  if (draft) return draft;
  return tryFetchJson(
    withBasePath(`/modules/${moduleId}/module.json`),
  ) as Promise<(Partial<ModuleSummary> & { id?: string }) | null>;
}

function toSummary(
  meta: Partial<ModuleSummary> & {
    id?: string;
    extends?: string;
    uses?: string[];
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
  };
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
      // it would double-merge its own file.
      if (chain.some((c) => c.id === libId)) continue;
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
): Promise<ModuleSummary[]> {
  const visited = new Set<string>();
  const chain: ModuleSummary[] = [];
  let currentId: string | undefined = moduleId;
  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error(
        `Module extends cycle detected at ${currentId} while resolving ${moduleId}`,
      );
    }
    visited.add(currentId);
    const meta = await loadModuleManifest(currentId);
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
  async list(): Promise<ModuleSummary[]> {
    // Prefer the localStorage index draft so newly-created modules
    // show up in the picker before the user exports anything.
    const draftIndex = loadIndexDraft<IndexFile>();
    const index = draftIndex ?? ((await fetchJson(
      withBasePath("/modules/index.json"),
    )) as IndexFile);
    const entries = index.modules ?? [];
    const out: ModuleSummary[] = [];
    for (const entry of entries) {
      try {
        const meta = await loadModuleManifest(entry.id);
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
    const chain = await walkExtendsChain(moduleId);
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
          withBasePath(`/modules/${s.id}/${def.fileName}`),
        );
        if (levelData === null) continue;
        data[key] = mergeModel(def.collectionKey, data[key], levelData);
      }
    }
    for (const key of ALL_MODEL_KEYS) {
      const def = MODELS[key];
      const ownLevel = await tryFetchJson(
        withBasePath(`/modules/${moduleId}/${def.fileName}`),
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
    const chain = await walkExtendsChain(moduleId);
    const usedLibraryIds = collectUsedLibraryIds(chain);

    // Inherited = the extends chain above this module, root-first.
    let inherited: unknown = null;
    for (let i = chain.length - 1; i >= 1; i--) {
      const id = chain[i].id;
      const levelData = await tryFetchJson(
        withBasePath(`/modules/${id}/${def.fileName}`),
      );
      if (levelData === null) continue;
      inherited = mergeModel(def.collectionKey, inherited, levelData);
    }

    // ownFile = the requested module's own JSON, or null if absent.
    const ownFile = await tryFetchJson(
      withBasePath(`/modules/${moduleId}/${def.fileName}`),
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
    const meta = await loadModuleManifest(moduleId);
    if (!meta) return null;
    return meta as Record<string, unknown>;
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
    const chain = await walkExtendsChain(moduleId);
    const usedLibraryIds = collectUsedLibraryIds(chain);
    const out: LibraryCatalogEntry[] = [];
    for (const libId of usedLibraryIds) {
      const libData = await tryFetchJson(
        withBasePath(`/modules/${libId}/${def.fileName}`),
      );
      if (libData === null) continue;
      const records = extractRecords(def.collectionKey, libData);
      if (records.length === 0) continue;
      out.push({ libraryId: libId, records });
    }
    return out;
  }
}
