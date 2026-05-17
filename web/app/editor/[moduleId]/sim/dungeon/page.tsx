/**
 * /editor/[moduleId]/sim/dungeon — Dungeon simulation testbed.
 *
 * Self-contained Phaser scene that mounts when the user picks a
 * dungeon record + floor. Generates the floor via the v1 procedural
 * generator and walks the party through the converted grid.
 */

import Link from "next/link";
import { Suspense } from "react";
import { listModuleIds } from "@/data_model/moduleIndex";
import { DungeonSimLauncher } from "@/editor/sim/DungeonSimLauncher";

export async function generateStaticParams() {
  const ids = await listModuleIds();
  return ids.map((moduleId) => ({ moduleId }));
}

/**
 * URL params honoured (all optional):
 *   - id     — auto-select this dungeon and start immediately
 *   - seed   — explicit RNG seed override
 *   - return — overworld map_id to route back to on exit
 *   - col    — column on the overworld map for the return landing
 *   - row    — row on the overworld map for the return landing
 *
 * The MapEditor uses these when the party steps onto an
 * entrance cell — see the `dungeon_entered` subscriber.
 */
export default function DungeonSimPage({
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
        <span className="text-parchment/65">Simulations</span>
        <span className="mx-1">/</span>
        <span className="text-parchment/80">Dungeon</span>
      </nav>
      {/* Suspense boundary required by Next.js — the launcher uses
          useSearchParams() which can't be evaluated at static-export
          time. Fallback is a tiny shim so the page paints something
          before the launcher hydrates. */}
      <Suspense
        fallback={
          <p className="p-4 text-sm text-parchment/55">Loading…</p>
        }
      >
        <DungeonSimLauncher moduleId={params.moduleId} />
      </Suspense>
    </div>
  );
}
