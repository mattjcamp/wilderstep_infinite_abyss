/**
 * Editor route helpers.
 *
 * The editor uses flat QUERY-PARAM routes (`/editor/module?m=<id>`,
 * `/editor/model?m=<id>&k=<key>`, …) rather than a `/editor/[moduleId]/…`
 * dynamic subtree, because a static export only generates pages for the
 * module ids known at build time — so a hosted `@handle/slug` module
 * 404'd. A query-param route is one exported page that works for ANY id
 * (read client-side), mirroring the play routes (src/play/playRoutes.ts).
 *
 * The id is `encodeURIComponent`-encoded into the `m` value (`@` and `/`
 * become %40/%2F) and read back with `decodeModuleIdParam`. Bare ids
 * round-trip unchanged. Use the `editor*Href` helpers below — they're
 * the single place the route + encoding rules live.
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

// ── Query-param editor routes ──────────────────────────────────────
//
// The editor used to be a `/editor/[moduleId]/…` dynamic subtree, but a
// static export only emits pages for the module ids known at build time
// (the LOCAL tree) — so editing a hosted `@handle/slug` module 404'd.
// These helpers build flat query-param routes (one exported page each,
// id read client-side) so ANY id works, mirroring the play routes
// (src/play/playRoutes.ts). `m` carries the encoded module id; `k` the
// model key; `map` the map id. Auxiliary params (sim, entryCol, tag, …)
// ride alongside via the optional `extra` arg.

/** Append `&key=value` pairs (encoded), skipping empty/undefined. */
function extraQuery(extra?: Record<string, string | number | undefined>): string {
  if (!extra) return "";
  return Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(
      ([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join("");
}

/** Module landing — `/editor/module?m=<id>`. */
export function editorModuleHref(moduleId: string): string {
  return `/editor/module?m=${encodeModuleId(moduleId)}`;
}

/** One model's browse/edit view — `/editor/model?m=<id>&k=<modelKey>`. */
export function editorModelHref(
  moduleId: string,
  modelKey: string,
  extra?: Record<string, string | number | undefined>,
): string {
  return `/editor/model?m=${encodeModuleId(moduleId)}&k=${encodeURIComponent(
    modelKey,
  )}${extraQuery(extra)}`;
}

/** Map editor — `/editor/map?m=<id>&map=<mapId>`. */
export function editorMapHref(
  moduleId: string,
  mapId: string,
  extra?: Record<string, string | number | undefined>,
): string {
  return `/editor/map?m=${encodeModuleId(moduleId)}&map=${encodeURIComponent(
    mapId,
  )}${extraQuery(extra)}`;
}

/** Sprite editor — `/editor/sprites?m=<id>`. */
export function editorSpritesHref(moduleId: string): string {
  return `/editor/sprites?m=${encodeModuleId(moduleId)}`;
}

/** Soundtrack editor — `/editor/soundtrack?m=<id>`. */
export function editorSoundtrackHref(moduleId: string): string {
  return `/editor/soundtrack?m=${encodeModuleId(moduleId)}`;
}

/** Battle simulator — `/editor/sim/battle?m=<id>`. */
export function editorBattleSimHref(moduleId: string): string {
  return `/editor/sim/battle?m=${encodeModuleId(moduleId)}`;
}

/** Dungeon simulator — `/editor/sim/dungeon?m=<id>`. */
export function editorDungeonSimHref(
  moduleId: string,
  extra?: Record<string, string | number | undefined>,
): string {
  return `/editor/sim/dungeon?m=${encodeModuleId(moduleId)}${extraQuery(extra)}`;
}
