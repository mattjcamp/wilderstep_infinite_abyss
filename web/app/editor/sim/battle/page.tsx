/**
 * /editor/sim/battle?m=<id> — Battle simulation testbed. Query-param
 * route (was `/editor/[moduleId]/sim/battle`).
 */
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { BattleSimLauncher } from "@/editor/sim/BattleSimLauncher";
import { EditorShell, useEditorModuleId } from "@/editor/editorShell";
import { editorModuleHref } from "@/editor/moduleRoutes";

function BattleSim() {
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
          <span className="text-parchment/80">Battle</span>
        </nav>
        <BattleSimLauncher moduleId={moduleId} />
      </div>
    </EditorShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BattleSim />
    </Suspense>
  );
}
