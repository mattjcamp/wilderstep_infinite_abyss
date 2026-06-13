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

// Two caches because the game and the editor want the SAME static/
// remote selection but OPPOSITE draft semantics (preferDrafts), so
// they can't share an instance.
let _cachedGame: StaticModuleSource | null = null;
let _cachedEditor: StaticModuleSource | null = null;

/** The GAME's module source per build-time env. Cached — sources
 *  are stateless, so one instance serves every caller.
 *
 *  preferDrafts is false: the game plays published content only, so
 *  a leftover editor draft must never shadow the hosted catalog.
 *
 *  Typed as StaticModuleSource (which RemoteModuleSource extends):
 *  the extended surface — loadModelLayers, resolveModuleSoundtrack,
 *  listLibraryRecords, … — is the contract real callers use; the
 *  slim ModuleSource interface is the subset for future thin
 *  implementations. */
export function getModuleSource(): StaticModuleSource {
  if (_cachedGame) return _cachedGame;
  _cachedGame = createModuleSource(
    process.env.NEXT_PUBLIC_MODULE_SOURCE,
    process.env.NEXT_PUBLIC_READ_HOST,
    { preferDrafts: false },
  );
  return _cachedGame;
}

/** The EDITOR's module source per build-time env. Same static/remote
 *  selection as getModuleSource(), but preferDrafts is true: drafts
 *  are the editor's working copy and must shadow published files.
 *
 *  This is what lets remote-mode authoring close the loop — the
 *  editor now browses the HOSTED catalog (not just local modules),
 *  so a published @handle module can be reopened, edited as drafts,
 *  and republished even after its drafts were cleared on publish
 *  (ugc_publishing_plan.md "Next session plan" item 1). */
export function getEditorModuleSource(): StaticModuleSource {
  if (_cachedEditor) return _cachedEditor;
  _cachedEditor = createModuleSource(
    process.env.NEXT_PUBLIC_MODULE_SOURCE,
    process.env.NEXT_PUBLIC_READ_HOST,
    { preferDrafts: true },
  );
  return _cachedEditor;
}

/** Pure factory — exported for tests. `preferDrafts` defaults to
 *  false (game semantics) so existing callers are unaffected. */
export function createModuleSource(
  mode: string | undefined,
  readHost: string | undefined,
  opts?: { preferDrafts?: boolean },
): StaticModuleSource {
  const preferDrafts = opts?.preferDrafts ?? false;
  if (mode === "remote") {
    if (readHost && readHost.trim().length > 0) {
      return new RemoteModuleSource(readHost.trim(), { preferDrafts });
    }
    // eslint-disable-next-line no-console
    console.warn(
      "NEXT_PUBLIC_MODULE_SOURCE=remote but NEXT_PUBLIC_READ_HOST is unset — falling back to the static source.",
    );
  }
  return new StaticModuleSource(undefined, { preferDrafts });
}

/** The hosted Read API origin when the app is in remote mode, else
 *  null (local/static — including github.io). Normalised with no
 *  trailing slash. Sprite routing uses this to point an author's
 *  custom-art URLs at the worker; null keeps every caller on the
 *  static origin, so non-remote builds are unaffected. */
export function getReadHost(): string | null {
  if (process.env.NEXT_PUBLIC_MODULE_SOURCE !== "remote") return null;
  const host = process.env.NEXT_PUBLIC_READ_HOST?.trim();
  return host && host.length > 0 ? host.replace(/\/+$/, "") : null;
}

/** Test-only escape hatch. */
export function __resetModuleSourceForTests(): void {
  _cachedGame = null;
  _cachedEditor = null;
}
