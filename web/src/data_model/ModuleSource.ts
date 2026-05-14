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
  /** Library modules whose overlay this module wants to pull in. Each
   *  listed library contributes its own file (not its ancestors) on
   *  top of the extends chain, applied in declared order. Used to
   *  share content (bestiaries, spell packs, tilesets) across many
   *  playable modules. `uses` declarations are also inherited via the
   *  extends chain, so a child picks up its parent's libraries.
   *  Order: parent's uses first, then child's uses, deduplicated. */
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
 *  (already merged) and what this module's own file declares (or null
 *  if the module doesn't override this model at all). "Inherited" here
 *  is the combined result of (a) the extends chain root-first and
 *  (b) the `uses` libraries applied on top in declared order — i.e.
 *  everything except this module's own file.
 *  Returned by ModuleSource.loadModelLayers — the editor uses this
 *  to show per-row provenance and to write copy-on-write overrides
 *  into the module's own file. */
export interface ModelLayers {
  /** Merged data from everything below this module: the extends chain
   *  applied root-first, then `uses` libraries applied in declared
   *  order. null if nothing below the module defines the model. */
  inherited: unknown;
  /** This module's own file content (the overlay), or null if the
   *  module doesn't have a file for this model. */
  ownFile: unknown;
  /** Immediate parent id from `extends`, if any. Convenience for UI
   *  labels like "inherits from <parent>". */
  parentId?: string;
  /** Library ids pulled in via `uses` (the resolved set, deduped,
   *  including those inherited from the extends chain), in the order
   *  they were applied. Convenience for UI labels like
   *  "uses <lib1>, <lib2>". */
  usedLibraryIds: string[];
}

export interface ModuleSource {
  /** List every module known to this source (core + library + playable).
   *  The editor surfaces all; a future play picker filters to
   *  role === "playable" (or omitted). */
  list(): Promise<ModuleSummary[]>;

  /** Load a single module's resolved data by id, walking the extends
   *  chain and merging records. */
  load(moduleId: string): Promise<LoadedModule>;
}
