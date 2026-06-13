/**
 * /editor/sim/dungeon?m=<id> — Dungeon simulation testbed. Query-param
 * route (was `/editor/[moduleId]/sim/dungeon`).
 *
 * Extra query params honoured by DungeonSimLauncher (all optional):
 *   id, seed, return, col, row — set by the MapEditor when the party
 *   steps onto an entrance cell. They ride on the same query string.
 */
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { DungeonSimLauncher } from "@/editor/sim/DungeonSimLauncher";
import { EditorShell, useEditorModuleId } from "@/editor/editorShell";
import { editorModuleHref } from "@/editor/moduleRoutes";

function DungeonSim() {
  const moduleId = useEditorModuleId();
  if (!moduleId) return null;
  return (
    <EditorShell moduleId={moduleId}>
      <div>
        <nav className="border-b border-parchment/10 bg-ink/40 px-4 py-2 text-xs text-parchment/50">
          <Link
            href={editorModuleHref(moduleId)}
            className="hover:text-parchment/80"
          >
            {moduleId}
          </Link>
          <span className="mx-1">/</span>
          <span className="text-parchment/65">Simulations</span>
          <span className="mx-1">/</span>
          <span className="text-parchment/80">Dungeon</span>
        </nav>
        <DungeonSimLauncher moduleId={moduleId} />
      </div>
    </EditorShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-parchment/55">Loading…</p>}>
      <DungeonSim />
    </Suspense>
  );
}
