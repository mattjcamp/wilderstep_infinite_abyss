/**
 * /editor/model?m=<id>&k=<modelKey> — per-model browse/edit view.
 *
 * Query-param route (was `/editor/[moduleId]/[modelKey]`). Renders the
 * model-specific browser (maps/dungeons/quests/characters/party) or the
 * generic ModelView. Unknown keys show an inline not-found instead of
 * the old server `notFound()`.
 */
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CharactersBrowse } from "@/editor/CharactersBrowse";
import { DungeonsBrowse } from "@/editor/DungeonsBrowse";
import { MapsBrowse } from "@/editor/MapsBrowse";
import { ModelView } from "@/editor/ModelView";
import { PartyBrowse } from "@/editor/PartyBrowse";
import { QuestsBrowse } from "@/editor/QuestsBrowse";
import { getModel, type ModelKey } from "@/data_model/models";
import { EditorShell, useEditorModuleId } from "@/editor/editorShell";
import { editorModuleHref } from "@/editor/moduleRoutes";

function ModelContent({
  moduleId,
  modelKey,
}: {
  moduleId: string;
  modelKey: string;
}) {
  const def = getModel(modelKey);
  if (!def) {
    return (
      <div className="p-4 text-parchment/70">
        Unknown model: <span className="font-mono">{modelKey || "(none)"}</span>.{" "}
        <Link href={editorModuleHref(moduleId)} className="text-ember underline">
          Back to module
        </Link>
      </div>
    );
  }
  return (
    <div>
      <nav className="border-b border-parchment/10 bg-ink/40 px-4 py-2 text-xs text-parchment/50">
        <Link
          href={editorModuleHref(moduleId)}
          className="hover:text-parchment/80"
        >
          {moduleId}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-parchment/80">{def.label}</span>
        <span className="ml-3 text-parchment/40">
          ({def.fileName} · /modules/{moduleId}/)
        </span>
      </nav>
      {modelKey === "maps" ? (
        // MapsBrowse calls useSearchParams() (the `?tag=` deep-link),
        // which bails static prerendering unless wrapped in Suspense.
        <Suspense
          fallback={<p className="p-4 text-parchment/60">Loading maps…</p>}
        >
          <MapsBrowse moduleId={moduleId} />
        </Suspense>
      ) : modelKey === "dungeons" ? (
        <DungeonsBrowse moduleId={moduleId} />
      ) : modelKey === "quests" ? (
        <QuestsBrowse moduleId={moduleId} />
      ) : modelKey === "characters" ? (
        <CharactersBrowse moduleId={moduleId} />
      ) : modelKey === "party" ? (
        <PartyBrowse moduleId={moduleId} />
      ) : (
        <ModelView moduleId={moduleId} modelKey={modelKey as ModelKey} />
      )}
    </div>
  );
}

function ModelBrowse() {
  const moduleId = useEditorModuleId();
  const modelKey = useSearchParams().get("k") ?? "";
  if (!moduleId) return null;
  return (
    <EditorShell moduleId={moduleId}>
      <ModelContent moduleId={moduleId} modelKey={modelKey} />
    </EditorShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ModelBrowse />
    </Suspense>
  );
}
