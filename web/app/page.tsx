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
        <p className="mt-3 text-parchment/70">

        </p>
      </header>
      <nav className="flex flex-col gap-4 sm:flex-row">
        <Link
          href="/play"
          className="rounded-md border border-parchment/40 bg-ember px-8 py-3 text-lg text-parchment shadow transition hover:bg-ember/80"
        >
          Play
        </Link>
        <Link
          href="/editor"
          className="rounded-md border border-parchment/40 bg-ink/60 px-8 py-3 text-lg text-parchment shadow transition hover:bg-ink/40"
        >
          Editor
        </Link>
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
