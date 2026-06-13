"use client";

/**
 * Live module list for the /play/new picker. Loads through the
 * configured module source (static = shipped modules; remote = the
 * HOSTED catalog with player-published @handle/slug modules), then adds
 * a live search box over title/author/description/id. Card rendering +
 * catalog loading live in src/play/ModuleGrid so the author page shares
 * them.
 */

import { useMemo, useState } from "react";
import { useCatalog, ModuleGrid } from "@/play/ModuleGrid";
import { filterModules } from "@/play/moduleFilter";

export function ModulePickerList() {
  const state = useCatalog();
  const [search, setSearch] = useState("");

  const all = state.kind === "ok" ? state.modules : [];
  const visible = useMemo(
    () => filterModules(all, { search }),
    [all, search],
  );

  // Which catalog this build is wired to — NEXT_PUBLIC_* values are
  // inlined at compile time, so this badge reports what the BUNDLE
  // believes, useful when debugging mode switches.
  const sourceBadge =
    process.env.NEXT_PUBLIC_MODULE_SOURCE === "remote"
      ? `hosted catalog (${process.env.NEXT_PUBLIC_READ_HOST ?? "no host!"})`
      : "local modules";

  if (state.kind === "loading") {
    return <p className="text-parchment/55">Loading modules…</p>;
  }
  if (state.kind === "error") {
    return (
      <p className="text-ember/85">
        Couldn&apos;t load the module catalog: {state.message}
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-3">
      <p className="text-xs text-parchment/40">{sourceBadge}</p>
      {all.length > 0 ? (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search modules by title, author, or description…"
          aria-label="Search modules"
          className="w-full rounded-md border border-parchment/20 bg-ink/40 px-3 py-2 text-sm text-parchment placeholder:text-parchment/35 focus:border-parchment/50 focus:outline-none"
        />
      ) : null}
      <ModuleGrid
        modules={visible}
        emptyMessage={
          all.length === 0 ? (
            <span>
              No playable modules are installed. Add a module under
              <code className="mx-1 rounded bg-ink/60 px-1 py-0.5 text-xs">
                public/modules/&lt;id&gt;/module.json
              </code>
              with{" "}
              <code className="mx-1 rounded bg-ink/60 px-1 py-0.5 text-xs">
                role: &quot;playable&quot;
              </code>
              and refresh.
            </span>
          ) : (
            <span>
              No modules match “{search}”.
            </span>
          )
        }
      />
    </div>
  );
}
