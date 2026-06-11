"use client";

/**
 * Save menu modal — opens with ⌘S / Ctrl-S from the play screen.
 *
 * Three manual save slots plus an "Export Save File" download. The
 * host snapshots the live sim into `saveRef.current` (via
 * `saveCurrent`) BEFORE opening this menu, so whatever the player
 * commits to a slot is the exact moment they pressed save.
 *
 * Slot writes go through the host's `onSaveToSlot` callback; the
 * host refreshes the `slots` prop on success so the row's timestamp
 * updates in place, and this component flashes a transient "Saved ✓"
 * on the committed row.
 *
 * ESC and ⌘S close. Movement keys are swallowed (capture phase) so
 * the party doesn't wander under the modal — same pattern as
 * PlayLogOverlay.
 */

import { useEffect, useRef, useState } from "react";
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

export function PlaySaveMenuOverlay({
  slots,
  onSaveToSlot,
  onExport,
  onClose,
}: {
  /** Slot contents, index 0 = slot 1. Null = empty slot. */
  slots: ReadonlyArray<WorldSave | null>;
  /** Commit the current game to slot N (1-based). Returns true on
   *  success — the component flashes confirmation on that row. */
  onSaveToSlot: (slot: number) => boolean;
  /** Download the current game as a JSON file. */
  onExport: () => void;
  onClose: () => void;
}) {
  // Which row just saved — drives the transient "Saved ✓" flash.
  const [savedFlash, setSavedFlash] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const commit = (slot: number) => {
    if (!onSaveToSlot(slot)) return;
    setSavedFlash(slot);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(null), 1500);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" ||
        ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S"))
      ) {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      // Number keys map straight to slots — 1/2/3 saves without
      // reaching for the mouse.
      if (e.key === "1" || e.key === "2" || e.key === "3") {
        const slot = Number(e.key);
        if (slot <= slots.length) {
          e.stopPropagation();
          e.preventDefault();
          commit(slot);
        }
        return;
      }
      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key.toLowerCase() === "w" ||
        e.key.toLowerCase() === "a" ||
        e.key.toLowerCase() === "s" ||
        e.key.toLowerCase() === "d"
      ) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, slots.length, onSaveToSlot]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h2 className="font-display text-base text-parchment">Save Game</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
            title="Close (ESC or ⌘S)"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-2 px-3 py-3">
          {slots.map((slot, i) => {
            const n = i + 1;
            const when = formatWhen(slot?.savedAt);
            const justSaved = savedFlash === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => commit(n)}
                className="flex items-baseline justify-between gap-3 rounded-md border border-parchment/25 bg-ink/40 px-4 py-2.5 text-left transition hover:border-parchment/50 hover:bg-ink/20"
                title={
                  slot
                    ? `Overwrite slot ${n} (key ${n})`
                    : `Save to slot ${n} (key ${n})`
                }
              >
                <span className="text-parchment">
                  Slot {n}
                  {justSaved ? (
                    <span className="ml-2 text-xs text-emerald-300">
                      Saved ✓
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-parchment/55">
                  {slot
                    ? `${slot.moduleId}${when ? ` · ${when}` : ""}`
                    : "Empty"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-parchment/15 px-3 py-2.5">
          <button
            type="button"
            onClick={onExport}
            className="w-full rounded-md border border-parchment/25 bg-ink/40 px-4 py-2 text-sm text-parchment/85 transition hover:border-parchment/50 hover:bg-ink/20"
            title="Download the current game as a JSON file"
          >
            Export Save File…
          </button>
          <p className="mt-1.5 text-center text-[11px] leading-snug text-parchment/45">
            Exports survive cleared browser data — restore them from
            the title screen via Import Save.
          </p>
        </div>
      </div>
    </div>
  );
}
