/**
 * /editor/[moduleId]/sim/battle — Battle simulation testbed.
 *
 * Self-contained Phaser scene that mounts when the user picks an
 * encounter + a map. Lives outside the map editor so combat doesn't
 * fight the editor's right rail, lighting, or keyboard handlers.
 */

import Link from "next/link";
import { listModuleIds } from "@/data_model/moduleIndex";
import { BattleSimLauncher } from "@/editor/sim/BattleSimLauncher";

export async function generateStaticParams() {
  const ids = await listModuleIds();
  return ids.map((moduleId) => ({ moduleId }));
}

export default function BattleSimPage({
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
        <span className="text-parchment/80">Battle</span>
      </nav>
      <BattleSimLauncher moduleId={params.moduleId} />
    </div>
  );
}
