/**
 * /play/new — "Choose a New Adventure".
 *
 * Reached from the /play title screen. Picking an adventure makes it
 * the player's current adventure (remembered in this browser — see
 * src/play/currentAdventure.ts) and returns to /play, which now shows
 * it; New Game there starts a party for it.
 *
 * The list itself is client-rendered through the configured module
 * source (see ModulePickerList), so in remote mode player-published
 * modules from the hosted catalog appear alongside the shipped ones.
 * Modules with role "core" / "library" are excluded — they're not
 * meant to be played directly.
 *
 * Ids are passed around as `?m=` query params so hosted `@handle/slug`
 * ids, unknown at build time, aren't 404'd by the static export — see
 * src/play/playRoutes.ts.
 */

import Link from "next/link";
import { ModulePickerList } from "./ModulePickerList";

export default function NewGameModulePicker() {
  return (
    <main className="flex flex-1 flex-col items-center gap-8 p-8">
      <header className="text-center">
        <h1 className="font-display text-4xl text-parchment">
          Choose a New Adventure
        </h1>
        <p className="mt-2 text-parchment/60">
          Each adventure has its own maps, its own enemies, its own
          story. The one you choose is waiting on the title screen.
        </p>
      </header>

      <ModulePickerList />

      <Link
        href="/play"
        className="mt-4 text-sm text-parchment/55 underline hover:text-parchment/80"
      >
        Back to title
      </Link>
    </main>
  );
}
