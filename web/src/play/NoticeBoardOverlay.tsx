"use client";

/**
 * Notice board — opens when the party bumps a map cell carrying
 * `board: "<board_id>"`. Lists every quest posted on that board
 * (quests.json `boards: [...]`) that the party hasn't taken yet, and
 * lets the player pick which ones to take. Taking a quest starts it
 * on the spot (the usual "New Quest" placard) and drops it from the
 * list; the board stays open so several notices can be taken in one
 * visit.
 *
 * Keys: ↑/↓ (or W/S) move the selection, Enter / T takes the selected
 * notice, Esc / E closes. Other movement keys are swallowed so the
 * party doesn't walk off under the board.
 */

import { useEffect, useState } from "react";

export interface NoticeBoardEntry {
  questId: string;
  name: string;
  description: string;
  /** Who posted it — the quest giver's name, when authored. */
  postedBy: string;
  /** First step's name — "what you'd be signing up for". */
  firstStep: string;
  xp: number;
  gold: number;
}

const SWALLOW = new Set(["ArrowLeft", "ArrowRight", "a", "d", "A", "D"]);

export function PlayNoticeBoardOverlay({
  title,
  entries,
  onTake,
  onClose,
}: {
  title: string;
  entries: ReadonlyArray<NoticeBoardEntry>;
  onTake: (questId: string) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState(0);
  const clamped = Math.min(sel, Math.max(0, entries.length - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (k === "Escape" || k === "e" || k === "E") {
        stop();
        onClose();
      } else if (k === "ArrowUp" || k === "w" || k === "W") {
        stop();
        setSel((s) => Math.max(0, Math.min(s, entries.length - 1) - 1));
      } else if (k === "ArrowDown" || k === "s" || k === "S") {
        stop();
        setSel((s) => Math.min(entries.length - 1, s + 1));
      } else if (k === "Enter" || k === "t" || k === "T") {
        stop();
        if (entries.length === 0) onClose();
        else onTake(entries[Math.min(sel, entries.length - 1)].questId);
      } else if (SWALLOW.has(k) || k === " ") {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [entries, sel, onTake, onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4"
    >
      <article
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-amber-200/30 bg-ink/95 shadow-2xl"
      >
        <header className="border-b border-parchment/15 px-5 pb-3 pt-4">
          <h2 id="board-title" className="font-display text-3xl text-parchment">
            {title}
          </h2>
          <p className="mt-1 text-sm text-parchment/60">
            {entries.length > 0
              ? "Notices pinned here ask for help. Take the ones you'll answer."
              : "Nothing new is posted here."}
          </p>
        </header>

        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {entries.map((q, i) => {
            const active = i === clamped;
            return (
              <li
                key={q.questId}
                onMouseEnter={() => setSel(i)}
                className={`rounded border px-3 py-2.5 ${
                  active
                    ? "border-amber-300/60 bg-amber-300/10"
                    : "border-parchment/15 bg-ink/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-xl text-parchment">{q.name}</h3>
                    {q.postedBy ? (
                      <p className="text-xs uppercase tracking-wide text-amber-200/70">
                        Posted by {q.postedBy}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onTake(q.questId)}
                    className="shrink-0 rounded border border-amber-300/50 px-3 py-1 text-sm text-amber-100 hover:bg-amber-300/15"
                    title="Take this quest (Enter)"
                  >
                    Take
                  </button>
                </div>
                {q.description ? (
                  <p className="mt-1.5 whitespace-pre-line text-base leading-relaxed text-parchment/80">
                    {q.description}
                  </p>
                ) : null}
                <p className="mt-1.5 flex flex-wrap gap-x-4 text-sm text-parchment/55">
                  {q.firstStep ? <span>First: {q.firstStep}</span> : null}
                  {q.xp > 0 ? <span>{q.xp} XP</span> : null}
                  {q.gold > 0 ? <span>{q.gold} gold</span> : null}
                </p>
              </li>
            );
          })}
        </ul>

        <footer className="flex items-center justify-between gap-2 border-t border-parchment/15 px-5 py-2.5">
          <span className="text-xs text-parchment/50">↑/↓ choose · Enter take · Esc close</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/25 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
          >
            Close
          </button>
        </footer>
      </article>
    </div>
  );
}
