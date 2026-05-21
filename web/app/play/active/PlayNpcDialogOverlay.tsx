"use client";

/**
 * NPC dialog modal — opens when the party walks into an NPC tile.
 * Shows the NPC's portrait + name + the currently-displayed dialog
 * line, with prev/next navigation through the npcs.json `dialogs[]`
 * array. When the NPC carries a `counter` field, the modal also
 * shows a "Visit Counter" button that closes the dialog and routes
 * the player into the matching shop/temple overlay.
 *
 * Read-only — the modal doesn't persist any state on the NPC; it's
 * just chatter. Closing returns the player to the world map. ESC
 * and the backdrop dismiss.
 */

import { useEffect, useState } from "react";
import { withBasePath } from "@/util/basePath";

interface DialogLine {
  id: string;
  title?: string;
  text: string;
}

export function PlayNpcDialogOverlay({
  npcName,
  npcSprite,
  dialogs,
  hasCounter,
  onVisitCounter,
  onClose,
}: {
  npcName: string;
  npcSprite?: string;
  dialogs: ReadonlyArray<DialogLine>;
  hasCounter: boolean;
  onVisitCounter: () => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const total = dialogs.length;
  const current = total > 0 ? dialogs[Math.min(cursor, total - 1)] : null;

  // ESC closes. Arrow keys cycle through dialog lines so the player
  // can read at their own pace. Capture-phase so the underlying
  // sim doesn't react to the same arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.stopPropagation();
        e.preventDefault();
        if (total > 0) setCursor((i) => (i + 1) % total);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.stopPropagation();
        e.preventDefault();
        if (total > 0) setCursor((i) => (i - 1 + total) % total);
        return;
      }
      if (
        e.key === "w" ||
        e.key === "a" ||
        e.key === "s" ||
        e.key === "d" ||
        e.key === "W" ||
        e.key === "A" ||
        e.key === "S" ||
        e.key === "D"
      ) {
        // Swallow movement keys while the modal is up.
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose, total]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-parchment/15 px-3 py-2">
          {npcSprite ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={withBasePath(`/sprites/${npcSprite}`)}
              alt=""
              width={40}
              height={40}
              style={{ imageRendering: "pixelated" }}
              className="h-10 w-10 shrink-0 rounded border border-parchment/20 bg-ink/60 object-contain"
            />
          ) : (
            <span className="h-10 w-10 shrink-0 rounded border border-parchment/15 bg-ink/40" />
          )}
          <h2 className="flex-1 font-display text-lg text-parchment">
            {npcName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
            title="Close (ESC)"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-auto px-3 py-3">
          {current ? (
            <article className="space-y-2">
              {current.title ? (
                <p className="text-[11px] uppercase tracking-wide text-amber-300">
                  {current.title}
                </p>
              ) : null}
              <p className="text-sm leading-snug text-parchment/90">
                {current.text}
              </p>
              {total > 1 ? (
                <p className="font-mono text-[10px] text-parchment/45">
                  {cursor + 1} / {total}
                </p>
              ) : null}
            </article>
          ) : (
            <p className="text-sm text-parchment/55">
              {npcName} regards you in silence.
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-parchment/15 px-3 py-2">
          <div className="flex items-center gap-2">
            {total > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setCursor((i) => (i - 1 + total) % total)
                  }
                  className="rounded border border-parchment/20 px-2 py-1 text-xs text-parchment/70 hover:bg-ink/40"
                  title="Previous line (←)"
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  onClick={() => setCursor((i) => (i + 1) % total)}
                  className="rounded border border-parchment/20 px-2 py-1 text-xs text-parchment/70 hover:bg-ink/40"
                  title="Next line (→)"
                >
                  Next →
                </button>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {hasCounter ? (
              <button
                type="button"
                onClick={onVisitCounter}
                className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-xs text-parchment hover:bg-ember/50"
                title="Open this NPC's shop / temple."
              >
                Visit Counter
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-parchment/20 px-3 py-1 text-xs text-parchment/85 hover:bg-ink/50"
            >
              Leave
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
