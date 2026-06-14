/**
 * /play/author?h=<handle> — an author's public modules.
 *
 * Query-param route (not a `[handle]` segment) so the static export
 * serves one page for any runtime handle — same reasoning as the play
 * routes (src/play/playRoutes.ts `authorHref`). Reuses the shared
 * catalog loader + grid; filters to the handle parsed from each id.
 *
 * `useSearchParams` needs a Suspense boundary under `output: "export"`.
 */
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCatalog, ModuleGrid } from "@/play/ModuleGrid";
import { filterModules } from "@/play/moduleFilter";

function AuthorModules() {
  const handle = (useSearchParams().get("h") ?? "").trim();
  const state = useCatalog();
  const all = state.kind === "ok" ? state.modules : [];
  const modules = filterModules(all, { handle });

  return (
    <main className="flex flex-1 flex-col items-center gap-8 p-8">
      <header className="text-center">
        <h1 className="font-display text-4xl text-parchment">
          Modules by @{handle || "…"}
        </h1>
        <p className="mt-2 text-parchment/60">
          Adventures published by this author.
        </p>
      </header>

      <div className="flex w-full max-w-3xl flex-col items-center gap-3">
        {state.kind === "loading" ? (
          <p className="text-parchment/55">Loading modules…</p>
        ) : state.kind === "error" ? (
          <p className="text-ember/85">
            Couldn&apos;t load the module catalog: {state.message}
          </p>
        ) : !handle ? (
          <p className="text-parchment/65">No author specified.</p>
        ) : (
          <ModuleGrid
            modules={modules}
            emptyMessage={<span>@{handle} has no public modules yet.</span>}
          />
        )}
      </div>

      <Link
        href="/play/new"
        className="mt-4 text-sm text-parchment/55 underline hover:text-parchment/80"
      >
        ← All modules
      </Link>
    </main>
  );
}

export default function AuthorPage() {
  return (
    <Suspense fallback={null}>
      <AuthorModules />
    </Suspense>
  );
}
