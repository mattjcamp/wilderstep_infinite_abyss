/**
 * /editor/soundtrack?m=<id> — soundtrack browser (audio assets surfaced
 * through the editor). Query-param route (was
 * `/editor/[moduleId]/soundtrack`).
 */
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { SoundtrackView } from "@/editor/SoundtrackView";
import { EditorShell, useEditorModuleId } from "@/editor/editorShell";
import { editorModuleHref } from "@/editor/moduleRoutes";

function SoundtrackBrowse() {
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
          <span className="text-parchment/80">Soundtrack</span>
          <span className="ml-3 text-parchment/40">(/audio/)</span>
        </nav>
        <SoundtrackView />
      </div>
    </EditorShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SoundtrackBrowse />
    </Suspense>
  );
}
