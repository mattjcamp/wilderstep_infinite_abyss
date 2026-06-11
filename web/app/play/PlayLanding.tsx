"use client";

/**
 * PlayLanding — title-screen client component.
 *
 * Detects saves on mount (localStorage is browser-only):
 *
 *   - "Return to Game" resumes the auto-save (the running game).
 *   - Three manual slots (written in-game via ⌘S) each offer Load —
 *     loading promotes the slot to the active save and jumps in.
 *   - "Import Save" restores a previously exported .json file as the
 *     active game — the escape hatch for wiped browser data.
 *   - "Export" downloads the current auto-save as a .json file.
 *
 * Save metadata (module id, last-played time) is shown on every row
 * so the player knows what they'd be resuming.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  activateSlot,
  downloadSaveExport,
  installImportedSave,
  listSlotSaves,
  loadWorld,
  parseImportedSave,
} from "@/play/save";
import { Soundtrack } from "@/audio/SoundtrackPlayer";
import type { WorldSave } from "@/play/saveTypes";

function formatWhen(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function PlayLanding() {
  const router = useRouter();
  // Tri-state to distinguish "still checking" from "no save" — without
  // it the Return button would flash on for a frame in the no-save
  // case as React hydrates the component.
  const [save, setSave] = useState<WorldSave | null | "loading">("loading");
  const [slots, setSlots] = useState<ReadonlyArray<WorldSave | null>>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSave(loadWorld());
    setSlots(listSlotSaves());
    // Title screen sits OUTSIDE an active session — kill whatever
    // music a previous play-through (or the intro screen) left
    // streaming on the singleton. Music starts again when the
    // player commits a new module on the begin screen, or when the
    // active host mounts.
    Soundtrack.stop();
  }, []);

  const activeSave = save === "loading" ? null : save;

  const onLoadSlot = (slotNumber: number) => {
    // Loading replaces the running auto-save — warn when one exists
    // so a player doesn't silently lose an unslotted game.
    if (
      activeSave &&
      !window.confirm(
        "Loading this slot will replace your current game. " +
          "Save it to a slot first (⌘S in game) if you want to keep it. Continue?",
      )
    ) {
      return;
    }
    if (activateSlot(slotNumber)) router.push("/play/active");
  };

  const onImportFile = async (file: File) => {
    setImportError(null);
    const text = await file.text();
    const imported = parseImportedSave(text);
    if (!imported) {
      setImportError(
        "That file doesn't look like a Wilderstep save — import cancelled.",
      );
      return;
    }
    if (
      activeSave &&
      !window.confirm(
        "Importing will replace your current game. " +
          "Save it to a slot first (⌘S in game) if you want to keep it. Continue?",
      )
    ) {
      return;
    }
    if (installImportedSave(imported)) router.push("/play/active");
    else setImportError("Couldn't write the save — storage unavailable.");
  };

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

      <nav className="flex flex-col items-stretch gap-3 sm:min-w-[380px]">
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

        {/* Manual save slots — written in-game with ⌘S. Occupied
            slots load; empty slots render greyed out. */}
        <section className="mt-2 flex flex-col gap-2">
          <h2 className="text-center text-xs uppercase tracking-widest text-parchment/45">
            Save Slots
          </h2>
          {slots.map((slot, i) => {
            const n = i + 1;
            const when = formatWhen(slot?.savedAt);
            if (!slot) {
              return (
                <div
                  key={n}
                  className="flex items-baseline justify-between rounded-md border border-parchment/15 bg-ink/50 px-5 py-2 text-parchment/30"
                >
                  <span>Slot {n}</span>
                  <span className="text-xs">Empty</span>
                </div>
              );
            }
            return (
              <button
                key={n}
                type="button"
                onClick={() => onLoadSlot(n)}
                className="flex items-baseline justify-between gap-3 rounded-md border border-parchment/40 bg-ink/40 px-5 py-2 text-left text-parchment shadow transition hover:bg-ink/20"
              >
                <span>Slot {n}</span>
                <span className="text-xs text-parchment/55">
                  {slot.moduleId}
                  {when ? ` · ${when}` : ""}
                </span>
              </button>
            );
          })}
        </section>

        {/* Export / Import — file-based saves that survive cleared
            browser data. Export downloads the current auto-save;
            import restores a previously exported file. */}
        <div className="mt-1 flex items-stretch gap-2">
          <button
            type="button"
            disabled={!activeSave}
            onClick={() => {
              if (activeSave) downloadSaveExport(activeSave);
            }}
            title={
              activeSave
                ? "Download the current game as a JSON file"
                : "No current game to export"
            }
            className="flex-1 rounded-md border border-parchment/25 bg-ink/40 px-4 py-2 text-sm text-parchment/85 transition enabled:hover:bg-ink/20 disabled:border-parchment/15 disabled:text-parchment/30"
          >
            Export Save
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Restore a previously exported save file"
            className="flex-1 rounded-md border border-parchment/25 bg-ink/40 px-4 py-2 text-sm text-parchment/85 transition hover:bg-ink/20"
          >
            Import Save…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so picking the same file twice re-fires change.
              e.target.value = "";
              if (file) void onImportFile(file);
            }}
          />
        </div>
        {importError ? (
          <p className="text-center text-xs text-red-300">{importError}</p>
        ) : null}

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
  const when = formatWhen(save.savedAt);
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
