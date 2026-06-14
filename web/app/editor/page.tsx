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
        <h1 className="font-display text-4xl text-parchment">Dungeon Master Mode</h1>
        <p className="mt-1 text-parchment/60">
          Each card below connects you to a module. Default Module is where the bulk of the game is coded, you can view that module buy any edits you make will not be saved. Other modules like "Side Quests", "Maps and Buildings" are libraries that you can import into your own modules. The only modules you can edit or delete are the modules that you create. Other players can view and play your modules.
        </p>
      </header>

      <ModulePicker />
    </main>
  );
}
