"use client";

/**
 * Shared browse pieces for the play surfaces:
 *
 *   - useCatalog()  — loads the configured catalog once, filtered to
 *     playable modules (core/library excluded; blank role = playable).
 *   - ModuleGrid    — renders module cards. Each card links to play;
 *     the owner handle (parsed from the id) links to that author's page.
 *
 * Used by both /play/new (picker + search) and /play/author.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ModuleSummary } from "@/data_model/ModuleSource";
import { getModuleSource } from "@/data_model/sourceConfig";
import { ownerHandleOf } from "@/data_model/moduleIds";
import { playPartyHref, authorHref } from "@/play/playRoutes";

function isPlayable(m: ModuleSummary): boolean {
  return m.role !== "core" && m.role !== "library";
}

export type CatalogState =
  | { kind: "loading" }
  | { kind: "ok"; modules: ModuleSummary[] }
  | { kind: "error"; message: string };

/** Load the playable catalog from the configured source, once. */
export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    getModuleSource()
      .list()
      .then((all) => {
        if (!cancelled) {
          setState({ kind: "ok", modules: all.filter(isPlayable) });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** A single playable-module card. */
function ModuleCard({ m }: { m: ModuleSummary }) {
  const handle = ownerHandleOf(m.id);
  return (
    <div className="rounded-md border border-parchment/20 bg-ink/40 p-4 transition hover:border-parchment/40 hover:bg-ink/30">
      <Link href={playPartyHref(m.id)} className="block">
        <div className="font-display text-xl text-parchment">
          {m.title ?? m.id}
        </div>
        {m.description ? (
          <div className="mt-1 text-sm text-parchment/70">{m.description}</div>
        ) : null}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-parchment/45">
        {handle ? (
          // Owner handle (from the id) → author page.
          <Link
            href={authorHref(handle)}
            className="text-parchment/60 underline decoration-dotted hover:text-parchment"
          >
            by @{handle}
          </Link>
        ) : m.author ? (
          <span>by {m.author}</span>
        ) : null}
        {m.version ? <span>v{m.version}</span> : null}
        <span className="font-mono">{m.id}</span>
      </div>
    </div>
  );
}

/** Grid of module cards. Renders an empty-state message when the list
 *  is empty (caller decides the message via `emptyMessage`). */
export function ModuleGrid({
  modules,
  emptyMessage,
}: {
  modules: ModuleSummary[];
  emptyMessage: React.ReactNode;
}) {
  if (modules.length === 0) {
    return <div className="text-parchment/65">{emptyMessage}</div>;
  }
  return (
    <ul className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      {modules.map((m) => (
        <li key={m.id}>
          <ModuleCard m={m} />
        </li>
      ))}
    </ul>
  );
}
