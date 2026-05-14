/**
 * ModuleSource — the contract for "where do modules come from?"
 *
 * The day-one implementation (StaticModuleSource) reads from the static
 * deployed files under /data/ and /modules/<id>/. A future implementation
 * could read from a remote catalog, an in-memory draft store, or a
 * server-backed source without the rest of the editor or game changing.
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
  /** Optional metadata flag — `"library"` modules are hidden from the play
   *  picker but shown to the editor. Omitted == playable. */
  role?: string;
}

/** A loaded module, including its metadata plus a snapshot of every
 *  per-module collection file we currently load. Shared/global data
 *  (classes, races, map tiles) lives outside the module and is fetched
 *  separately via {@link ModuleSource.loadShared}. */
export interface LoadedModule {
  summary: ModuleSummary;
  /** Per-module data, keyed by model key (e.g. "effects", "spells").
   *  Values are the parsed JSON of each file's collection. */
  data: Record<string, unknown>;
}

/** Shared/global data, keyed by model key (e.g. "character_classes",
 *  "races", "map_tiles"). */
export type SharedData = Record<string, unknown>;

export interface ModuleSource {
  /** List every module known to this source (playable + library). The
   *  editor surfaces all; the play picker filters to role !== "library". */
  list(): Promise<ModuleSummary[]>;

  /** Load a single module's per-module data by id. */
  load(moduleId: string): Promise<LoadedModule>;

  /** Load shared/global data (classes, races, map tiles, etc.). Does
   *  not depend on which module is active. */
  loadShared(): Promise<SharedData>;
}
