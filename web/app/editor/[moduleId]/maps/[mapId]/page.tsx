/**
 * /editor/[moduleId]/maps/[mapId] — visual map editor.
 *
 * Standalone Phaser-based canvas editor for painting on a map grid.
 * Lives at its own route (separate from the generic ModelView record
 * browser) because the canvas needs the real estate and Phaser owns
 * the rendering surface.
 *
 * Static export enumerates (moduleId, mapId) by scanning each module's
 * own maps.json on disk at build time.
 */

import { decodeModuleIdParam, encodeModuleId } from "@/editor/moduleRoutes";
import fs from "node:fs";
import path from "node:path";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapEditor } from "@/editor/MapEditor";
import { listModuleIds } from "@/data_model/moduleIndex";

export async function generateStaticParams() {
  const moduleIds = await listModuleIds();
  const params: Array<{ moduleId: string; mapId: string }> = [];
  for (const moduleId of moduleIds) {
    const mapsPath = path.join(
      process.cwd(),
      "public",
      "modules",
      moduleId,
      "maps.json",
    );
    if (!fs.existsSync(mapsPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(mapsPath, "utf8")) as {
        maps?: Array<{ id?: string }>;
      };
      for (const m of data.maps ?? []) {
        if (m.id) params.push({ moduleId, mapId: m.id });
      }
    } catch {
      // Skip malformed maps.json files; they'll surface as 404 if visited.
    }
  }
  return params;
}

export default function MapEditorPage({
  params,
}: {
  params: { moduleId: string; mapId: string };
}) {
  const moduleId = decodeModuleIdParam(params.moduleId);
  if (!moduleId || !params.mapId) notFound();
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <nav className="border-b border-parchment/10 bg-ink/40 px-4 py-2 text-xs text-parchment/50">
        <Link
          href={`/editor/${encodeModuleId(moduleId)}`}
          className="hover:text-parchment/80"
        >
          {moduleId}
        </Link>
        <span className="mx-1">/</span>
        <Link
          href={`/editor/${encodeModuleId(moduleId)}/maps`}
          className="hover:text-parchment/80"
        >
          Maps
        </Link>
        <span className="mx-1">/</span>
        <span className="text-parchment/80">{params.mapId}</span>
      </nav>
      {/* MapEditor calls useSearchParams() for sim-mode auto-entry,
          which bails out of static prerendering unless it's wrapped
          in a Suspense boundary. The fallback below is what the
          static export ships in the prerendered HTML; the real
          component hydrates on the client immediately. */}
      <Suspense
        fallback={<p className="p-4 text-parchment/60">Loading map…</p>}
      >
        <MapEditor moduleId={moduleId} mapId={params.mapId} />
      </Suspense>
    </div>
  );
}
