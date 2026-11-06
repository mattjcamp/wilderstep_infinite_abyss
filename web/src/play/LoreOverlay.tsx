"use client";

/**
 * Lore reading screen — opens when the party bumps a map object that
 * carries lore (a bookshelf, a plaque) or uses a readable item.
 *
 * Shows the title, the lore's tags and its paragraphs. On the FIRST
 * read a banner notes the experience earned and that the entry is now
 * in the Journal (J). Closes on Esc / Enter / Space / E or a backdrop
 * click; movement keys are swallowed so the party doesn't walk off
 * under the page.
 */

import { useEffect } from "react";
import type { LoreRecord } from "@/play/lore";

const SWALLOW = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "w",
  "a",
  "s",
  "d",
  "W",
  "A",
  "S",
  "D",
]);

export function PlayLoreOverlay({
  lore,
  firstRead,
  xp,
  onClose,
}: {
  lore: LoreRecord;
  /** True when this read added the lore to the journal. */
  firstRead: boolean;
  /** XP each living member earned on this read (0 when none). */
  xp: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" ||
        e.key === "Enter" ||
        e.key === " " ||
        e.key === "e" ||
        e.key === "E"
      ) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (SWALLOW.has(e.key)) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4"
    >
      <article
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lore-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-amber-200/30 bg-ink/95 shadow-2xl"
      >
        <header className="border-b border-parchment/15 px-5 pb-3 pt-4">
          <h2 id="lore-title" className="font-display text-3xl text-parchment">
            {lore.name}
          </h2>
          {lore.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lore.tags.map((t) => (
                <span
                  key={t}
                  className="rounded border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-200/90"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        {firstRead ? (
          <p className="mx-5 mt-3 rounded border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
            ✦ New lore discovered — added to your Journal (J)
            {xp > 0 ? ` · +${xp} XP to each party member` : ""}.
          </p>
        ) : null}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {lore.paragraphs.length > 0 ? (
            lore.paragraphs.map((p, i) => (
              <p
                key={i}
                className="whitespace-pre-line text-lg leading-relaxed text-parchment/85"
              >
                {p}
              </p>
            ))
          ) : (
            <p className="text-lg italic text-parchment/50">
              The page is blank.
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-parchment/15 px-5 py-2.5">
          <span className="text-xs text-parchment/50">
            Re-read it any time from your Journal (J).
          </span>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded border border-parchment/25 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
            title="Close (Esc or Enter)"
          >
            Close
          </button>
        </footer>
      </article>
    </div>
  );
}
