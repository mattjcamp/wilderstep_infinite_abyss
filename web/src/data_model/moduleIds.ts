/**
 * Module-id namespacing — groundwork for player-published modules
 * (docs/dev_guides/ugc_publishing_plan.md §4, the "one design-
 * sensitive piece").
 *
 * Two id forms coexist:
 *
 *   bare:       `default`, `tavern`         (shipped/system modules)
 *   qualified:  `@matt/sunken-keep`         (player modules: @handle/slug)
 *
 * Rules this module is the single source of truth for:
 *
 *   - SYNTAX. Bare ids keep the publish server's historical grammar
 *     (`^[a-z][a-z0-9-]*$`). Qualified ids are `@handle/slug` with
 *     conservative grammars for both parts (object-storage-key and
 *     URL-path safe by construction; no encoding needed).
 *   - ALIASING. `@core/<x>` is the qualified spelling of a shipped
 *     bare module — `resolveModuleIdAlias("@core/tavern")` → `tavern`.
 *     Forward-compat: player modules may write
 *     `extends: "@core/default"` today and it resolves against the
 *     same static tree; when shipped content moves into a real
 *     `@core` namespace later, the alias flips direction in ONE
 *     place without touching saves or resolver call sites.
 *   - OWNERSHIP + POLICY. `ownerHandleOf` and `canExtendModule`
 *     express the v1 cross-author policy: you may extend system
 *     modules and your own; `uses` (copy-on-import) may reference
 *     any public module, so it is not restricted here.
 *
 * Everything is pure string logic — shared verbatim between the
 * front-end resolver and the hosted publish API port.
 */

/** Reserved namespace handle for shipped/system content. */
export const CORE_HANDLE = "core";

/** Bare-id grammar — identical to the local publish server's
 *  MODULE_ID_RE so every existing module id stays valid. */
export const BARE_MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;

/** Author handle grammar: 2–30 chars, letter/digit start. */
export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/;

/** Module slug grammar: 1–64 chars, letter/digit start. */
export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface ParsedModuleId {
  /** True for `@handle/slug`, false for a bare id. */
  qualified: boolean;
  /** Owner handle without the `@` — null for bare ids. */
  handle: string | null;
  /** The slug (qualified) or the whole id (bare). */
  slug: string;
}

/** Parse + validate a module id in either form. Returns null for
 *  anything that doesn't match the grammars — callers treat null as
 *  "reject", same posture as the publish server's regex checks. */
export function parseModuleId(id: string): ParsedModuleId | null {
  if (typeof id !== "string" || id.length === 0) return null;
  if (id.startsWith("@")) {
    const slash = id.indexOf("/");
    if (slash < 0) return null;
    const handle = id.slice(1, slash);
    const slug = id.slice(slash + 1);
    if (!HANDLE_RE.test(handle)) return null;
    if (!SLUG_RE.test(slug)) return null;
    return { qualified: true, handle, slug };
  }
  if (!BARE_MODULE_ID_RE.test(id)) return null;
  return { qualified: false, handle: null, slug: id };
}

/** True when `id` is a syntactically valid module id (either form). */
export function isValidModuleId(id: string): boolean {
  return parseModuleId(id) !== null;
}

/** Resolve the `@core/<x>` alias to the bare id shipped content is
 *  actually stored under. Non-core ids (bare or player-qualified)
 *  pass through unchanged. Invalid ids also pass through — syntax
 *  errors are surfaced by validation at the boundary, not here. */
export function resolveModuleIdAlias(id: string): string {
  const parsed = parseModuleId(id);
  if (parsed?.qualified && parsed.handle === CORE_HANDLE) {
    return parsed.slug;
  }
  return id;
}

/** True when two module ids refer to the same module once aliasing
 *  is applied (`"@core/default"` ≡ `"default"`). Use anywhere ids
 *  are compared for identity (extends-cycle checks, uses dedup). */
export function moduleIdsEqual(a: string, b: string): boolean {
  return resolveModuleIdAlias(a) === resolveModuleIdAlias(b);
}

/** Owner handle of a module id, or null for system/bare modules
 *  (and `@core/...`, which is system by definition). */
export function ownerHandleOf(id: string): string | null {
  const parsed = parseModuleId(id);
  if (!parsed?.qualified) return null;
  return parsed.handle === CORE_HANDLE ? null : parsed.handle;
}

/** Storage/URL path segment for a module id. Both forms are path-
 *  safe by grammar (`@` is legal in URL paths and object keys; the
 *  qualified form's `/` simply nests one level), so this is the
 *  identity for valid ids — it exists to give the layout rule a
 *  name and a single place to change. Throws on invalid ids so a
 *  bad id can never become a path. */
export function moduleStorageSegment(id: string): string {
  if (!isValidModuleId(id)) {
    throw new Error(`invalid module id: ${JSON.stringify(id)}`);
  }
  return resolveModuleIdAlias(id);
}

/** v1 cross-author inheritance policy (ugc_publishing_plan.md §4):
 *  a module may `extends` system modules (bare / @core) or modules
 *  owned by the same handle. Anything else — including invalid
 *  target ids — is rejected. `uses` is deliberately NOT gated by
 *  this (import-palette copies records, so deleting the source
 *  can't break dependents). */
export function canExtendModule(
  targetId: string,
  ownerHandle: string,
): boolean {
  const parsed = parseModuleId(targetId);
  if (!parsed) return false;
  if (!parsed.qualified) return true; // shipped/system module
  if (parsed.handle === CORE_HANDLE) return true; // system, qualified spelling
  return parsed.handle === ownerHandle;
}
