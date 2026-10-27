/**
 * Merge the shipped (built-in) module list into the hosted catalog
 * index without touching player-published modules.
 *
 * The hosted catalog (r2://…/modules/index.json) lists BOTH the
 * built-in modules that ship with the game (bare ids like "default",
 * "test" — content pushed to GitHub and uploaded by CI) AND modules
 * players published through the editor ("@handle/slug"). CI owns the
 * first set, players own the second:
 *
 *   - every built-in entry is replaced by the repo's own
 *     public/modules/index.json (so pushed modules appear and removed
 *     ones drop off the list), and
 *   - every player entry ("@handle/…", except the reserved "@core")
 *     is kept exactly as it was.
 */

/** True for ids a player owns ("@handle/slug", handle !== core). */
export function isPlayerModuleId(id) {
  return typeof id === "string" && id.startsWith("@") && !id.startsWith("@core/");
}

/**
 * @param {{modules?: Array<{id: string}>} | null} hosted  current hosted index (or null)
 * @param {{modules?: Array<{id: string, title?: string, role?: string}>}} shipped  repo index
 * @returns {{modules: Array<object>}}
 */
export function mergeCatalog(hosted, shipped) {
  const builtIn = (shipped?.modules ?? [])
    .filter((e) => e && typeof e.id === "string" && !isPlayerModuleId(e.id))
    .map(({ id, title, role }) => ({
      id,
      title: typeof title === "string" && title ? title : id,
      ...(typeof role === "string" && role ? { role } : {}),
    }));
  const players = (hosted?.modules ?? []).filter((e) => e && isPlayerModuleId(e.id));
  return { modules: [...builtIn, ...players] };
}
