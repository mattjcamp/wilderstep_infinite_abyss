/**
 * /editor/module?m=<id> — module landing. Brief intro, libraries +
 * properties, then a card per editor in the same groups as the
 * sidebar (World / Enemies / Assets / Players / Simulations — see
 * editorNav.ts).
 *
 * Query-param route (not `[moduleId]`) so the static export serves one
 * page for any module id — hosted `@handle/slug` modules included. The
 * id is read client-side from `?m=`; missing → back to the picker.
 */
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { LibrariesPanel } from "@/editor/LibrariesPanel";
import { EditorShell, useEditorModuleId } from "@/editor/editorShell";
import { EDITOR_NAV_GROUPS, navEntryInfo } from "@/editor/editorNav";

const CARD =
  "block rounded-md border border-parchment/15 bg-ink/30 p-3 transition hover:border-parchment/40 hover:bg-ink/50";

function ModuleHome({ moduleId }: { moduleId: string }) {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-parchment">{moduleId}</h1>
        <p className="mt-1 text-parchment/60">
          Browse the module&apos;s data. Pick a model from the sidebar or one of
          the cards below.
        </p>
      </header>

      <LibrariesPanel moduleId={moduleId} />

      {EDITOR_NAV_GROUPS.map((group) => (
        <section key={group.label} className="mb-8">
          <h2 className="mb-3 text-xs uppercase tracking-wide text-parchment/40">
            {group.label}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.entries.map((entry) => {
              const info = navEntryInfo(entry, moduleId);
              return (
                <li key={info.id}>
                  <Link href={info.href} className={CARD}>
                    <div className="font-display text-lg text-parchment">
                      {info.label}
                    </div>
                    <p className="mt-0.5 text-sm text-parchment/60">
                      {info.blurb}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}

function ModuleEditorHome() {
  const moduleId = useEditorModuleId();
  if (!moduleId) return null;
  return (
    <EditorShell moduleId={moduleId}>
      <ModuleHome moduleId={moduleId} />
    </EditorShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ModuleEditorHome />
    </Suspense>
  );
}
