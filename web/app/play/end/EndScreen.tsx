"use client";

/**
 * EndScreen — grim presentation shown after a party wipe.
 *
 * The aesthetic intent: low, slow, heavy. Not a game-over arcade
 * screen. The party is dead; the player is given the option to
 * roll back to the previous save (read from the SAVE_PREV slot) or
 * begin again from scratch.
 *
 * Continue path: `restorePrevSave` promotes the backup slot to the
 * current save and clears the backup. The player then routes back to
 * `/play/active`, which reads the restored save and remounts the
 * world at the pre-fight state.
 *
 * New Game path: `clearSave` wipes both slots, then routes to the
 * module picker.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSave, loadPrevSave, restorePrevSave } from "@/play/save";
import { Soundtrack } from "@/audio/SoundtrackPlayer";
import type { WorldSave } from "@/play/saveTypes";

export function EndScreen() {
  const router = useRouter();
  /** Loaded backup save (used to decide whether "Continue" is even
   *  offered + to surface its timestamp for context). */
  const [backup, setBackup] = useState<WorldSave | null | "loading">(
    "loading",
  );

  useEffect(() => {
    setBackup(loadPrevSave());
    // Party wipe ends the session — silence the adventure music so
    // the death-screen prose lands without a triumphant background
    // track contradicting it. If the player chooses Continue, the
    // active host will re-seed the playlist on remount.
    Soundtrack.stop();
  }, []);

  const onContinue = () => {
    if (!restorePrevSave()) return;
    router.push("/play/active");
  };

  const onNewGame = () => {
    clearSave();
    router.push("/play/new");
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-12 bg-ink p-8">
      <div className="text-center">
        <h1 className="font-display text-6xl tracking-wider text-red-300/90">
          They have fallen.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-parchment/60">
          The lanterns dim and the dust settles. The adventurers will
          rise no more — at least, not from where they lie now.
        </p>
      </div>

      <div className="flex flex-col items-stretch gap-3 sm:min-w-[320px]">
        {backup === "loading" ? (
          <button
            type="button"
            disabled
            className="rounded-md border border-parchment/15 bg-ink/40 px-8 py-3 text-lg text-parchment/30"
          >
            Continue from last save
          </button>
        ) : backup ? (
          <button
            type="button"
            onClick={onContinue}
            className="rounded-md border border-parchment/30 bg-ink/40 px-8 py-3 text-center text-lg text-parchment shadow transition hover:bg-ink/20"
          >
            <div>Continue from last save</div>
            <div className="mt-1 text-xs text-parchment/45">
              {backup.moduleId}
              {backup.savedAt
                ? ` · ${new Date(backup.savedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}`
                : null}
            </div>
          </button>
        ) : (
          <button
            type="button"
            disabled
            title="No earlier save exists"
            className="rounded-md border border-parchment/15 bg-ink/40 px-8 py-3 text-lg text-parchment/30"
          >
            Continue from last save
          </button>
        )}
        <button
          type="button"
          onClick={onNewGame}
          className="rounded-md border border-parchment/30 bg-ember/60 px-8 py-3 text-center text-lg text-parchment shadow transition hover:bg-ember/80"
        >
          New Game
        </button>
        <Link
          href="/play"
          className="mt-2 text-center text-sm text-parchment/45 underline hover:text-parchment/70"
        >
          Back to title
        </Link>
      </div>
    </main>
  );
}
