/**
 * Landing page — the first thing a visitor sees:
 *
 *   • Play            → /play           (the game)
 *   • Editor          → /editor         (the module editor)
 *   • Player's Manual → /manual.pdf     (the PDF, opened in a new tab)
 *   • DM's Manual     → /dm_manual.pdf  (the authoring guide PDF)
 *
 * Both manuals are static assets shipped from web/public/manual.pdf and
 * web/public/dm_manual.pdf (kept in sync by docs/manual/build_manual.py
 * and build_dm_manual.py). Opening in a new tab hands the browser's
 * native PDF viewer the file directly — a full-page, chrome-free read,
 * unlike the cluttered GitHub blob view.
 */
import Link from "next/link";
import { withBasePath } from "@/util/basePath";
import { EditorButton } from "./EditorButton";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-12 p-8">
      <header className="text-center">
        <h1 className="font-display text-5xl text-parchment">
          Wilderstep: Infinite Abyss
        </h1>
        <div className="mx-auto mt-4 max-w-2xl space-y-3 text-parchment/75">
          <p>
            Wilderstep: Infinite Abyss is a turn-based RPG featuring turn-based chessboard-like 
            combat and sprawling overview maps inspired by the 1980s game Ultima 3.
            Lead a party of four adventurers through an open world of overworld exploration, 
            town
            visits, dungeon delving, and turn-based tactical combat.
          </p>
          <p>
            Sign in with your account to unlock Dungeon Master mode. You can
            create your own adventures using Wilderstep&apos;s full-featured
            game development kit. You can make new maps, new monsters,
            quests, and more.
          </p>
        </div>
      </header>
      <div className="flex flex-col items-center gap-10">
        <nav className="flex flex-col items-center gap-4 sm:flex-row">
          <Link
            href="/play"
            className="rounded-md border border-parchment/40 bg-ember px-8 py-3 text-lg text-parchment shadow transition hover:bg-ember/80"
          >
            Play
          </Link>
          {/* Dungeon Master mode (the editor) — only shown when signed in. */}
          <EditorButton />
        </nav>

        {/* Manuals, each as a "book" — its own cover page (rendered from
            the PDF) with a spine + drop shadow. Opens the PDF in a new
            tab. Static assets aren't auto-basePath'd the way <Link> is,
            so prepend it by hand. */}
        <div className="flex flex-wrap items-start justify-center gap-10">
          {[
            {
              href: "/manual.pdf",
              cover: "/manual-cover.png",
              title: "Open the Player's Manual (PDF)",
              alt: "Player's Manual",
              label: "Player's Manual",
            },
            {
              href: "/dm_manual.pdf",
              cover: "/dm_manual-cover.png",
              title: "Open the Dungeon Master's Manual (PDF)",
              alt: "Dungeon Master's Manual",
              label: "DM's Manual",
            },
          ].map((book) => (
            <a
              key={book.href}
              href={withBasePath(book.href)}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center gap-3"
              title={book.title}
            >
              <span className="relative block w-40 overflow-hidden rounded-l-sm rounded-r-md shadow-xl shadow-black/50 ring-1 ring-parchment/15 transition duration-200 group-hover:-translate-y-1 group-hover:shadow-2xl">
                {/* book spine */}
                <span className="pointer-events-none absolute inset-y-0 left-0 z-10 w-2 bg-gradient-to-r from-black/45 via-black/15 to-transparent" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={withBasePath(book.cover)}
                  alt={book.alt}
                  className="block w-full"
                />
              </span>
              <span className="text-sm uppercase tracking-wide text-parchment/65 transition group-hover:text-parchment">
                {book.label}
              </span>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
