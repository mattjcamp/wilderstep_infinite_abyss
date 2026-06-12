/**
 * Editor route helpers for module ids.
 *
 * Qualified ids (`@matt/sunken-keep`) contain a `/`, which would
 * split into two path segments in `/editor/[moduleId]/…` routes.
 * Every editor link therefore percent-encodes the id into ONE
 * segment (`%40matt%2Fsunken-keep`), and every page decodes the
 * param back before using it. Bare ids round-trip unchanged.
 *
 * Use these helpers instead of hand-rolling `/editor/${id}` strings
 * — they're the single place the encoding rule lives.
 */

/** Module id → safe single path segment. */
export function encodeModuleId(moduleId: string): string {
  return encodeURIComponent(moduleId);
}

/** Route param → module id. Next's app router hands params through
 *  percent-ENCODED in some versions and decoded in others; decoding
 *  is idempotent for our id grammar (no literal `%` allowed), so
 *  always decoding is safe either way. */
export function decodeModuleIdParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

/** `/editor/<id>` plus optional extra segments (NOT encoded — pass
 *  pre-safe segments like "maps", a mapId, "sprites"). */
export function editorPath(moduleId: string, ...segments: string[]): string {
  const tail = segments.length > 0 ? `/${segments.join("/")}` : "";
  return `/editor/${encodeModuleId(moduleId)}${tail}`;
}
