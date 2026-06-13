/**
 * Play-route helpers — query-param routing for the play flow.
 *
 * Hosted modules have qualified ids (`@handle/slug`) that can't be a
 * static `[moduleId]` path segment in an `output: "export"` build: the
 * exporter only emits HTML for the ids `generateStaticParams` knows at
 * build time (the LOCAL module tree), so a hosted id 404s. Passing the
 * id as a `?m=` query param instead means ONE exported HTML page per
 * screen serves ANY id — local or hosted — read client-side via
 * `useSearchParams`.
 *
 * These helpers are the single place the play-route URL shape lives.
 * The id is `encodeURIComponent`-encoded (qualified ids contain `@`
 * and `/`); read it back with `decodeModuleIdParam`.
 */

import { encodeModuleId } from "@/editor/moduleRoutes";

/** Party-formation screen for `moduleId`. */
export function playPartyHref(moduleId: string): string {
  return `/play/new/party?m=${encodeModuleId(moduleId)}`;
}

/** Beginning (description) screen for `moduleId`. */
export function playBeginHref(moduleId: string): string {
  return `/play/new/begin?m=${encodeModuleId(moduleId)}`;
}
