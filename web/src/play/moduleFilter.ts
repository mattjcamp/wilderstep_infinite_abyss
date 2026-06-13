/**
 * Pure catalog filtering for the play/browse surfaces — search text and
 * author-handle filter. Kept React-free so it's unit-testable and shared
 * by the picker (/play/new) and the author page (/play/author).
 *
 * Note on "author": the manifest `author` field is free text (display
 * only). The canonical owner is the HANDLE parsed from the id
 * (`@matt/slug` → "matt"), which is what author pages group by — a bare
 * or `@core` id has no owner handle.
 */

import type { ModuleSummary } from "@/data_model/ModuleSource";
import { ownerHandleOf } from "@/data_model/moduleIds";

export interface ModuleFilter {
  /** Case-insensitive substring matched against title/author/description/id. */
  search?: string;
  /** Restrict to modules owned by this handle (no leading `@`). */
  handle?: string;
}

/** Apply a search + handle filter to a module list, preserving order. */
export function filterModules(
  modules: ModuleSummary[],
  opts: ModuleFilter,
): ModuleSummary[] {
  let out = modules;

  if (opts.handle) {
    out = out.filter((m) => ownerHandleOf(m.id) === opts.handle);
  }

  const q = opts.search?.trim().toLowerCase();
  if (q) {
    out = out.filter((m) =>
      [m.title, m.author, m.description, m.id]
        .filter((s): s is string => typeof s === "string")
        .some((s) => s.toLowerCase().includes(q)),
    );
  }

  return out;
}
