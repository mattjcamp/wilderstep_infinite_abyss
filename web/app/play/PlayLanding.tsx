"use client";

/**
 * PlayLanding — title-screen client component.
 *
 * Detects a save on mount (localStorage is browser-only) and enables
 * the "Return to Game" button when one exists. Otherwise only "New
 * Game" is offered.
 *
 * The save metadata (module title, last-played time) is shown when a
 * save is available so the player knows what they'd be resuming.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadWorld } from "@/play/save";
import type { WorldSave } from "@/play/saveTypes";

export function PlayLanding() {
  // Tri-state to distinguish "still checking" from "no save" — without
  // it the Return button would flash on for a frame in the no-save
  // case as React hydrates the component.
  const [save, setSave] = useState<WorldSave | null | "loading">("loading");

  useEffect(() => {
    setSave(loadWorld());
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 p-8">
      <header className="text-center">
        <h1 className="font-display text-5xl text-parchment">
          Wilderstep: Infinite Abyss
        </h1>
        <p className="mt-3 text-parchment/60">
          The lantern flickers. The path ahead is yours to choose.
        </p>
      </header>

      <nav className="flex flex-col items-stretch gap-3 sm:min-w-[320px]">
        {/* Return to Game — only enabled when a save exists. While we
            * haven't checked yet ("loading"), render the button greyed
            * out so the layout doesn't shift after the effect runs. */}
        <ReturnButton save={save} />
        <Link
          href="/play/new"
          className="rounded-md border border-parchment/40 bg-ember/90 px-8 py-3 text-center text-lg text-parchment shadow transition hover:bg-ember"
        >
          New Game
        </Link>
        <Link
          href="/"
          className="mt-2 text-center text-sm text-parchment/55 underline hover:text-parchment/80"
        >
          Back to landing
        </Link>
      </nav>
    </main>
  );
}

function ReturnButton({ save }: { save: WorldSave | null | "loading" }) {
  if (save === "loading") {
    return (
      <button
        type="button"
        disabled
        className="rounded-md border border-parchment/20 bg-ink/60 px-8 py-3 text-lg text-parchment/30"
      >
        Return to Game
      </button>
    );
  }
  if (save == null) {
    return (
      <button
        type="button"
        disabled
        title="No save found"
        className="rounded-md border border-parchment/20 bg-ink/60 px-8 py-3 text-lg text-parchment/30"
      >
        Return to Game
      </button>
    );
  }
  // Live save — link straight into the active game.
  const when = save.savedAt
    ? new Date(save.savedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  return (
    <Link
      href="/play/active"
      className="rounded-md border border-parchment/40 bg-ink/40 px-8 py-3 text-center text-lg text-parchment shadow transition hover:bg-ink/20"
    >
      <div>Return to Game</div>
      <div className="mt-1 text-xs text-parchment/55">
        {save.moduleId}
        {when ? ` · ${when}` : null}
      </div>
    </Link>
  );
}
