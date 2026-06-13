/**
 * /editor/map?m=<id>&map=<mapId> — visual Phaser map editor.
 *
 * Query-param route (was `/editor/[moduleId]/maps/[mapId]`). The map id
 * is read from `?map=`; MapEditor also reads the other query params it
 * already used (sim, entryCol, entryRow, boat, …) off the same string.
 */
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MapEditor } from "@/editor/MapEditor";
import { EditorShell, useEditorModuleId } from "@/editor/editorShell";
import { editorModuleHref, editorModelHref } from "@/editor/moduleRoutes";

function MapEditorContent({ moduleId }: { moduleId: string }) {
  const mapId = useSearchParams().get("map") ?? "";
  if (!mapId) {
    return (
      <div className="p-4 text-parchment/70">
        No map specified.{" "}
        <Link
          href={editorModelHref(moduleId, "maps")}
          className="text-ember underline"
        >
          Back to maps
        </Link>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <nav className="border-b border-parchment/10 bg-ink/40 px-4 py-2 text-xs text-parchment/50">
        <Link
          href={editorModuleHref(moduleId)}
          className="hover:text-parchment/80"
        >
          {moduleId}
        </Link>
        <span className="mx-1">/</span>
        <Link
          href={editorModelHref(moduleId, "maps")}
          className="hover:text-parchment/80"
        >
          Maps
        </Link>
        <span className="mx-1">/</span>
        <span className="text-parchment/80">{mapId}</span>
      </nav>
      {/* MapEditor reads useSearchParams() for sim-mode auto-entry —
          already inside the page-root Suspense boundary below. */}
      <MapEditor moduleId={moduleId} mapId={mapId} />
    </div>
  );
}

function MapEditorRoute() {
  const moduleId = useEditorModuleId();
  if (!moduleId) return null;
  return (
    <EditorShell moduleId={moduleId}>
      <MapEditorContent moduleId={moduleId} />
    </EditorShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="p-4 text-parchment/60">Loading map…</p>}>
      <MapEditorRoute />
    </Suspense>
  );
}
