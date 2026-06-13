/**
 * /play/new — module picker.
 *
 * The list itself is client-rendered through the configured module
 * source (see ModulePickerList), so in remote mode player-published
 * modules from the hosted catalog appear alongside the shipped ones.
 * Modules with role "core" / "library" are excluded — they're not
 * meant to be played directly.
 *
 * Click → /play/new/party?m=<moduleId> (query-param route so hosted
 * `@handle/slug` ids, unknown at build time, aren't 404'd by the static
 * export — see src/play/playRoutes.ts).
 */

import Link from "next/link";
import { ModulePickerList } from "./ModulePickerList";
import { AccountNav } from "@/play/AccountNav";

export default function NewGameModulePicker() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-8">
      <div className="flex w-full max-w-3xl justify-end">
        <AccountNav />
      </div>
      <header className="text-center">
        <h1 className="font-display text-4xl text-parchment">Choose a Module</h1>
        <p className="mt-2 text-parchment/60">
          Each module is its own adventure — its own maps, its own
          enemies, its own story.
        </p>
      </header>

      <ModulePickerList />

      <Link
        href="/play"
        className="mt-4 text-sm text-parchment/55 underline hover:text-parchment/80"
      >
        Back
      </Link>
    </main>
  );
}
