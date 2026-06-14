/**
 * Landing page — the first thing a visitor sees. Three buttons:
 *
 *   • Play            → /play        (the game)
 *   • Editor          → /editor      (the module editor)
 *   • Player's Manual → /manual.pdf  (the PDF, opened in a new tab)
 *
 * The manual is a static asset shipped from web/public/manual.pdf
 * (kept in sync by docs/manual/build_manual.py). Opening it in a new
 * tab hands the browser's native PDF viewer the file directly — a
 * full-page, chrome-free read, unlike the cluttered GitHub blob view.
 */
import Link from "next/link";
import { withBasePath } from "@/util/basePath";
import { AccountNav } from "@/play/AccountNav";
import { EditorButton } from "./EditorButton";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-12 p-8">
      {/* Account controls (Sign in / @handle · My Modules · Sign out).
          Self-contained — renders nothing on builds where publishing
          isn't reachable (e.g. the static github.io build). */}
      <div className="absolute right-4 top-4">
        <AccountNav />
      </div>
      <header className="text-center">
        <h1 className="font-display text-5xl text-parchment">
          Wilderstep: Infinite Abyss
        </h1>
        <div className="mx-auto mt-4 max-w-2xl space-y-3 text-parchment/75">
          <p>
            Wilderstep: Infinite Abyss is a turn-based RPG built with
            TypeScript and Phaser for your browser. Lead a party of four
            adventurers through an open world of overworld exploration, town
            visits, dungeon delving, and turn-based tactical combat.
          </p>
          <p>
            Sign in with your account to unlock Dungeon Master mode. You can
            create your own adventures using Wilderstep&apos;s full-featured
            game development kit. This includes custom maps, new monsters,
            quests, and more.
          </p>
        </div>
      </header>
      <nav className="flex flex-col gap-4 sm:flex-row">
        <Link
          href="/play"
          className="rounded-md border border-parchment/40 bg-ember px-8 py-3 text-lg text-parchment shadow transition hover:bg-ember/80"
        >
          Play
        </Link>
        {/* Editor (Dungeon Master mode) — only shown when signed in. */}
        <EditorButton />
        {/* Static PDF — not a Next route, so basePath isn't auto-applied
            (it is for <Link>); prepend it by hand and open in a new tab
            so the browser renders the PDF full-page on its own. */}
        <a
          href={withBasePath("/manual.pdf")}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-parchment/40 bg-ink/60 px-8 py-3 text-lg text-parchment shadow transition hover:bg-ink/40"
        >
          Player&apos;s Manual
        </a>
      </nav>
    </main>
  );
}
