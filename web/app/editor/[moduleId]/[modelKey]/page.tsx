/**
 * /editor/[moduleId]/[modelKey] — per-model browse view. Renders a
 * <ModelView> client component that fetches the model's JSON at runtime
 * and shows a table (collections) or a single-record dump (singletons).
 */

import { decodeModuleIdParam, encodeModuleId } from "@/editor/moduleRoutes";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CharactersBrowse } from "@/editor/CharactersBrowse";
import { DungeonsBrowse } from "@/editor/DungeonsBrowse";
import { MapsBrowse } from "@/editor/MapsBrowse";
import { ModelView } from "@/editor/ModelView";
import { PartyBrowse } from "@/editor/PartyBrowse";
import { QuestsBrowse } from "@/editor/QuestsBrowse";
import {
  ALL_MODEL_KEYS,
  getModel,
  type ModelKey,
} from "@/data_model/models";
import { listModuleIds } from "@/data_model/moduleIndex";

export async function generateStaticParams() {
  // Cartesian: every known module × every known model.
  const moduleIds = await listModuleIds();
  return moduleIds.flatMap((moduleId) =>
    ALL_MODEL_KEYS.map((modelKey) => ({ moduleId, modelKey })),
  );
}

export default function ModelBrowsePage({
  params,
}: {
  params: { moduleId: string; modelKey: string };
}) {
  const moduleId = decodeModuleIdParam(params.moduleId);
  const def = getModel(params.modelKey);
  if (!def) notFound();

  return (
    <div>
      <nav className="border-b border-parchment/10 bg-ink/40 px-4 py-2 text-xs text-parchment/50">
        <Link href={`/editor/${encodeModuleId(moduleId)}`} className="hover:text-parchment/80">
          {moduleId}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-parchment/80">{def.label}</span>
        <span className="ml-3 text-parchment/40">
          ({def.fileName} · /modules/{moduleId}/)
        </span>
      </nav>
      {params.modelKey === "maps" ? (
        // MapsBrowse calls useSearchParams() (for the `?tag=` deep-link
        // from a map's tag chips), which bails static prerendering
        // unless wrapped in a Suspense boundary — same pattern the map
        // editor page uses.
        <Suspense
          fallback={<p className="p-4 text-parchment/60">Loading maps…</p>}
        >
          <MapsBrowse moduleId={moduleId} />
        </Suspense>
      ) : params.modelKey === "dungeons" ? (
        <DungeonsBrowse moduleId={moduleId} />
      ) : params.modelKey === "quests" ? (
        <QuestsBrowse moduleId={moduleId} />
      ) : params.modelKey === "characters" ? (
        <CharactersBrowse moduleId={moduleId} />
      ) : params.modelKey === "party" ? (
        <PartyBrowse moduleId={moduleId} />
      ) : (
        <ModelView
          moduleId={moduleId}
          modelKey={params.modelKey as ModelKey}
        />
      )}
    </div>
  );
}
