/**
 * ModuleSource — the contract for "where do modules come from?"
 *
 * The day-one implementation (StaticModuleSource) reads from the static
 * deployed files under /modules/<id>/. A future implementation could
 * read from a remote catalog, an in-memory draft store, or a
 * server-backed source without the rest of the editor or game changing.
 *
 * Modules form a single-inheritance chain via `extends`. The base
 * `default` module owns the canonical records; child modules declare
 * `extends: "default"` (or another module id) in their module.json and
 * override records by id. Loading a module resolves the full chain and
 * returns the merged view.
 *
 * See docs/dev_guides/game_architecture_plan.md ("Forward-compatibility
 * seams") for the design rationale.
 */

export interface ModuleSummary {
  id: string;
  title: string;
  description: string;
  author: string;
  version: string;
  /** Role this module plays in the catalog. Conventions:
   *   - "core"      → the base everyone inherits from (typically `default`).
   *                   Editable, but not surfaced in the play picker.
   *   - "library"   → importable add-on. Editable, not playable on its own.
   *   - "playable"  → a runnable adventure. Shown in the play picker.
   *  Omitted == playable. */
  role?: string;
  /** Parent module id to inherit from. Records in this module override
   *  records in the parent by id; missing files fall through to the
   *  parent. Omit on the root module. */
  extends?: string;
  /** Library modules whose content should be available to this module
   *  as an import palette. `uses` does NOT compose library records
   *  into your resolved view — instead, the editor surfaces each
   *  library's records as a catalog, and the author imports records
   *  they want into the module's own file (where they become regular
   *  "new" records, decoupled from the library going forward).
   *  `uses` declarations are inherited via the extends chain so a
   *  child picks up its parent's library list automatically. */
  uses?: string[];
}

/** A loaded module, including its metadata plus a fully resolved
 *  snapshot of every model after walking the extends chain and merging
 *  records by id. */
export interface LoadedModule {
  summary: ModuleSummary;
  /** Resolved per-model data, keyed by model key (e.g. "effects",
   *  "spells", "character_classes"). Values are the parsed JSON of
   *  each file's collection, merged across the inheritance chain. */
  data: Record<string, unknown>;
}

/** Two-layer view of a single model for one module: what's inherited
 *  from the extends chain (already merged root-first) and what this
 *  module's own file declares. Library content from `uses` is NOT
 *  included here — it's surfaced separately via listLibraryRecords
 *  so the editor can present it as an import palette.
 *  Returned by ModuleSource.loadModelLayers — the editor uses this
 *  to show per-row provenance and to write copy-on-write overrides
 *  into the module's own file. */
export interface ModelLayers {
  /** Merged data from the extends chain, applied root-first. null if
   *  this module is the root or no ancestor defines the model. */
  inherited: unknown;
  /** This module's own file content (the overlay), or null if the
   *  module doesn't have a file for this model. */
  ownFile: unknown;
  /** Immediate parent id from `extends`, if any. Convenience for UI
   *  labels like "inherits from <parent>". */
  parentId?: string;
  /** Library ids declared via `uses` (deduped, also gathered from
   *  the extends chain). Used by the editor to label the catalog
   *  source and to know which libraries to query. */
  usedLibraryIds: string[];
}

/** A library's contribution to the model's catalog: each used library
 *  is one entry, with the records it declares in its own file.
 *  Returned by ModuleSource.listLibraryRecords. The editor filters
 *  out records whose id already appears in the module's inherited
 *  or own view, then renders the remainder as importable rows. */
export interface LibraryCatalogEntry {
  libraryId: string;
  records: Array<Record<string, unknown>>;
}

export interface ModuleSource {
  /** List every module known to this source (core + library + playable).
   *  The editor surfaces all; a future play picker filters to
   *  role === "playable" (or omitted). */
  list(): Promise<ModuleSummary[]>;

  /** Load a single module's resolved data by id, walking the extends
   *  chain and merging records. Library `uses` are NOT auto-merged;
   *  they're only an import palette. */
  load(moduleId: string): Promise<LoadedModule>;
}
