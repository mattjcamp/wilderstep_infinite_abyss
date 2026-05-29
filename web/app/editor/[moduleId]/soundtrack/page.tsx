/**
 * /editor/[moduleId]/soundtrack — soundtrack browser.
 *
 * Audio assets, surfaced through the editor so authors can see what
 * music is available when wiring up data fields that reference a
 * track (module / map / dungeon `soundtrack` lists). The data lives
 * at web/public/audio/<filename> with a hand-maintained index.json
 * cataloging the set — the same catalog the SoundtrackPicker reads.
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
        <span className="ml-3 text-parchment/40">(/audio/)</span>
      </nav>
      <SoundtrackView />
    </div>
  );
}
