/**
 * sourceConfig — picks which ModuleSource the app reads from, so the
 * local-dev static site and the hosted UGC site share one codebase
 * (ugc_publishing_plan.md §5).
 *
 * Env contract (NEXT_PUBLIC_* so the static export inlines them at
 * build time):
 *
 *   NEXT_PUBLIC_MODULE_SOURCE  "static" (default) | "remote"
 *   NEXT_PUBLIC_READ_HOST      Read API origin, required for
 *                              "remote" (e.g. https://api.example.com)
 *
 * Misconfiguration (remote without a host) falls back to static
 * with a console warning rather than throwing — a broken env var
 * shouldn't brick the whole app.
 */

import { StaticModuleSource } from "./StaticModuleSource";
import { RemoteModuleSource } from "./RemoteModuleSource";

let _cached: StaticModuleSource | null = null;

/** The app-wide module source per build-time env. Cached — sources
 *  are stateless, so one instance serves every caller.
 *
 *  Typed as StaticModuleSource (which RemoteModuleSource extends):
 *  the extended surface — loadModelLayers, resolveModuleSoundtrack,
 *  listLibraryRecords, … — is the contract real callers use; the
 *  slim ModuleSource interface is the subset for future thin
 *  implementations. */
export function getModuleSource(): StaticModuleSource {
  if (_cached) return _cached;
  _cached = createModuleSource(
    process.env.NEXT_PUBLIC_MODULE_SOURCE,
    process.env.NEXT_PUBLIC_READ_HOST,
  );
  return _cached;
}

/** Pure factory — exported for tests. */
export function createModuleSource(
  mode: string | undefined,
  readHost: string | undefined,
): StaticModuleSource {
  if (mode === "remote") {
    if (readHost && readHost.trim().length > 0) {
      // preferDrafts false: this source feeds the GAME, which plays
      // published content only — a leftover editor draft must never
      // shadow the hosted catalog.
      return new RemoteModuleSource(readHost.trim(), {
        preferDrafts: false,
      });
    }
    // eslint-disable-next-line no-console
    console.warn(
      "NEXT_PUBLIC_MODULE_SOURCE=remote but NEXT_PUBLIC_READ_HOST is unset — falling back to the static source.",
    );
  }
  return new StaticModuleSource(undefined, { preferDrafts: false });
}

/** Test-only escape hatch. */
export function __resetModuleSourceForTests(): void {
  _cached = null;
}
