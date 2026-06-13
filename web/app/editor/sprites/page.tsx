/**
 * /editor/sprites?m=<id> — sprite browser (assets surfaced through the
 * editor). Query-param route (was `/editor/[moduleId]/sprites`).
 */
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { SpriteView } from "@/editor/SpriteView";
import { EditorShell, useEditorModuleId } from "@/editor/editorShell";
import { editorModuleHref } from "@/editor/moduleRoutes";

function SpriteBrowse() {
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
          <span className="text-parchment/80">Sprites</span>
          <span className="ml-3 text-parchment/40">(/sprites/)</span>
        </nav>
        <SpriteView />
      </div>
    </EditorShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SpriteBrowse />
    </Suspense>
  );
}
