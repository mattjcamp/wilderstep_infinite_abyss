/**
 * /editor — module picker. Lists every module the configured source
 * knows about; clicking a card opens it in the editor.
 *
 * Navigation (sign in/out, My Modules, back to Play) lives in the
 * global SiteNav now, so this page just shows the picker.
 */

import { ModulePicker } from "@/editor/ModulePicker";

export default function EditorPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-8">
      <header className="mb-8">
        <h1 className="font-display text-4xl text-parchment">Editor</h1>
        <p className="mt-1 text-parchment/60">
          Pick a module to browse its data.
        </p>
      </header>

      <ModulePicker />
    </main>
  );
}
