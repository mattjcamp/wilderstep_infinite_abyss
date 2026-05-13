/**
 * Landing page — the first thing a visitor sees. Two buttons:
 *
 *   • Play   → /play   (the game)
 *   • Editor → /editor (the module editor)
 *
 * Stub only. No save detection, no module picker, no content. Those
 * arrive in later passes per docs/dev_guides/game_architecture_plan.md.
 */
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-12 p-8">
      <header className="text-center">
        <h1 className="font-display text-5xl text-parchment">
          Wilderstep: Infinite Abyss
        </h1>
        <p className="mt-3 text-parchment/70">
          Workflow stub. No game content yet.
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
      </nav>
    </main>
  );
}
