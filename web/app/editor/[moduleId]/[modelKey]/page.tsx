/**
 * /editor/[moduleId]/[modelKey] — per-model browse view. Renders a
 * <ModelView> client component that fetches the model's JSON at runtime
 * and shows a table (collections) or a single-record dump (singletons).
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { MapsBrowse } from "@/editor/MapsBrowse";
import { ModelView } from "@/editor/ModelView";
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
  const def = getModel(params.modelKey);
  if (!def) notFound();

  return (
    <div>
      <nav className="border-b border-parchment/10 bg-ink/40 px-4 py-2 text-xs text-parchment/50">
        <Link href={`/editor/${params.moduleId}`} className="hover:text-parchment/80">
          {params.moduleId}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-parchment/80">{def.label}</span>
        <span className="ml-3 text-parchment/40">
          ({def.fileName} · /modules/{params.moduleId}/)
        </span>
      </nav>
      {params.modelKey === "maps" ? (
        <MapsBrowse moduleId={params.moduleId} />
      ) : (
        <ModelView
          moduleId={params.moduleId}
          modelKey={params.modelKey as ModelKey}
        />
      )}
    </div>
  );
}
