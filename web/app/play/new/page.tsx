/**
 * /play/new — module picker.
 *
 * Lists every module under `public/modules/` whose role is "playable".
 * Modules with role "core" (the base canonical record set) and
 * "library" (asset packs other modules extend) don't appear — they're
 * not meant to be played directly.
 *
 * Per ModuleSummary.role's contract, an omitted/blank role ALSO
 * counts as playable (it's the conventional default). So the filter
 * is "exclude core + library", not "must equal playable" — the
 * latter would drop hand-authored manifests that just left the
 * field out.
 *
 * Click → /play/new/[moduleId]/party.
 */

import Link from "next/link";
import { isPlayableModule, readAllModules } from "@/data_model/moduleIndex";

export default function NewGameModulePicker() {
  const modules = readAllModules().filter(isPlayableModule);

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-8">
      <header className="text-center">
        <h1 className="font-display text-4xl text-parchment">Choose a Module</h1>
        <p className="mt-2 text-parchment/60">
          Each module is its own adventure — its own maps, its own
          enemies, its own story.
        </p>
      </header>

      {modules.length === 0 ? (
        <p className="text-parchment/65">
          No playable modules are installed. Add a module under
          <code className="mx-1 rounded bg-ink/60 px-1 py-0.5 text-xs">
            public/modules/&lt;id&gt;/module.json
          </code>
          with{" "}
          <code className="mx-1 rounded bg-ink/60 px-1 py-0.5 text-xs">
            role: "playable"
          </code>
          and refresh.
        </p>
      ) : (
        <ul className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          {modules.map((m) => (
            <li key={m.id}>
              <Link
                href={`/play/new/${m.id}/party`}
                className="block rounded-md border border-parchment/20 bg-ink/40 p-4 transition hover:border-parchment/40 hover:bg-ink/30"
              >
                <div className="font-display text-xl text-parchment">
                  {m.title ?? m.id}
                </div>
                {m.description ? (
                  <div className="mt-1 text-sm text-parchment/70">
                    {m.description}
                  </div>
                ) : null}
                <div className="mt-2 flex gap-3 text-xs text-parchment/45">
                  {m.author ? <span>by {m.author}</span> : null}
                  {m.version ? <span>v{m.version}</span> : null}
                  <span className="font-mono">{m.id}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/play"
        className="mt-4 text-sm text-parchment/55 underline hover:text-parchment/80"
      >
        Back
      </Link>
    </main>
  );
}
