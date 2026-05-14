/**
 * /editor/[moduleId]/soundtrack — soundtrack browser.
 *
 * Audio assets, surfaced through the editor so authors can see what
 * music is available when wiring up data fields that reference a
 * track (future Map.music, Encounter.theme, etc.). The data lives at
 * web/public/soundtrack/<category>/<filename> with a generated
 * index.json cataloging the set — same pattern as /sprites/.
 */

import Link from "next/link";
import { SoundtrackView } from "@/editor/SoundtrackView";
import { listModuleIds } from "@/data_model/moduleIndex";

export async function generateStaticParams() {
  const ids = await listModuleIds();
  return ids.map((moduleId) => ({ moduleId }));
}

export default function SoundtrackBrowsePage({
  params,
}: {
  params: { moduleId: string };
}) {
  return (
    <div>
      <nav className="border-b border-parchment/10 bg-ink/40 px-4 py-2 text-xs text-parchment/50">
        <Link
          href={`/editor/${params.moduleId}`}
          className="hover:text-parchment/80"
        >
          {params.moduleId}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-parchment/80">Soundtrack</span>
        <span className="ml-3 text-parchment/40">(/soundtrack/)</span>
      </nav>
      <SoundtrackView />
    </div>
  );
}
