/**
 * StaticModuleSource — reads modules from the static site's served
 * files under /modules/<id>/.
 *
 * URLs are passed through withBasePath() so GH Pages's repo prefix is
 * applied automatically when the env var is set at build time.
 *
 * The list of modules lives in /modules/index.json. Each module
 * declares its own metadata in /modules/<id>/module.json, including
 * optional `extends` (single parent — your base) and `uses` (a list
 * of library modules to compose on top). Resolution layers the data
 * in this order:
 *
 *   1. extends chain, root-first (e.g. default → ... → parent)
 *   2. `uses` libraries (deduped + collected across the extends chain,
 *      root's uses first; each library contributes only its own file,
 *      not its ancestors)
 *   3. the requested module's own file
 *
 * Each step uses the same merge semantics:
 *   - collections (records under a collectionKey, addressed by id)
 *     are merged by id — later records override earlier records of
 *     the same id; new ids are appended.
 *   - singletons (collectionKey === null, e.g. party) are replaced
 *     wholesale by the later layer.
 *   - files missing at a level fall through.
 */

import { withBasePath } from "@/util/basePath";
import { mergeModel } from "./merge";
import { ALL_MODEL_KEYS, MODELS, type ModelKey } from "./models";
import type {
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
 *  module is at index 0). */
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
    const meta = (await fetchJson(
      withBasePath(`/modules/${currentId}/module.json`),
    )) as Partial<ModuleSummary> & { id?: string };
    const summary = toSummary(meta, { id: currentId });
    chain.push(summary);
    currentId = summary.extends;
  }
  return chain;
}

export class StaticModuleSource implements ModuleSource {
  async list(): Promise<ModuleSummary[]> {
    const index = (await fetchJson(
      withBasePath("/modules/index.json"),
    )) as IndexFile;
    const entries = index.modules ?? [];
    const out: ModuleSummary[] = [];
    for (const entry of entries) {
      try {
        const meta = (await fetchJson(
          withBasePath(`/modules/${entry.id}/module.json`),
        )) as Partial<ModuleSummary> & { id?: string };
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
    const usedLibraryIds = collectUsedLibraryIds(chain);
    const summary = chain[0];

    const data: Record<string, unknown> = {};
    // Apply root first, then each ancestor down to and including the
    // requested module, then layer uses libraries on top, then the
    // requested module's own file. Note: the requested module is at
    // chain[0]; it gets applied via its own file pass below, not as
    // part of the chain walk, so we stop at i=1 here.
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
    for (const libId of usedLibraryIds) {
      for (const key of ALL_MODEL_KEYS) {
        const def = MODELS[key];
        const levelData = await tryFetchJson(
          withBasePath(`/modules/${libId}/${def.fileName}`),
        );
        if (levelData === null) continue;
        data[key] = mergeModel(def.collectionKey, data[key], levelData);
      }
    }
    // Finally, the requesting module's own file.
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
   *  whole module. Walks the extends chain + uses libraries for just
   *  this model. Used by the per-model browse page to keep network
   *  traffic minimal. */
  async loadModel(moduleId: string, key: ModelKey): Promise<unknown> {
    const layers = await this.loadModelLayers(moduleId, key);
    return mergeModel(MODELS[key].collectionKey, layers.inherited, layers.ownFile);
  }

  /** Layered loader: returns the inherited data (extends chain + uses
   *  libraries, all merged) and the current module's own file
   *  separately. The editor uses this to compute per-row provenance
   *  (inherited vs overridden vs new), to support copy-on-write
   *  editing, and to export just the overlay rather than the resolved
   *  view. */
  async loadModelLayers(
    moduleId: string,
    key: ModelKey,
  ): Promise<ModelLayers> {
    const def = MODELS[key];
    const chain = await walkExtendsChain(moduleId);
    const usedLibraryIds = collectUsedLibraryIds(chain);

    // Inherited = (a) the extends chain above this module, applied
    // root-first; (b) uses libraries, applied in declared order, each
    // contributing only its own file.
    let inherited: unknown = null;
    for (let i = chain.length - 1; i >= 1; i--) {
      const id = chain[i].id;
      const levelData = await tryFetchJson(
        withBasePath(`/modules/${id}/${def.fileName}`),
      );
      if (levelData === null) continue;
      inherited = mergeModel(def.collectionKey, inherited, levelData);
    }
    for (const libId of usedLibraryIds) {
      const libData = await tryFetchJson(
        withBasePath(`/modules/${libId}/${def.fileName}`),
      );
      if (libData === null) continue;
      inherited = mergeModel(def.collectionKey, inherited, libData);
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
}
