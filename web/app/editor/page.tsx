/**
 * /editor — module picker. Lists every module the StaticModuleSource
 * knows about; clicking a card routes to /editor/[moduleId].
 *
 * Read-only for now. Drafts and export-to-files come later.
 */

import Link from "next/link";
import { ModulePicker } from "@/editor/ModulePicker";
import { AccountNav } from "@/play/AccountNav";

export default function EditorPage() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl p-8">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-4xl text-parchment">Editor</h1>
          <p className="mt-1 text-parchment/60">
            Pick a module to browse its data.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <AccountNav />
          <Link href="/" className="text-sm text-ember underline">
            ← Landing
          </Link>
        </div>
      </header>

      <ModulePicker />
    </main>
  );
}
