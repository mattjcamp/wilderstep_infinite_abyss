"use client";

/**
 * Travel placard — announces a quest "travel" reward: the quest giver
 * (or the quest itself, for a step reward) is sending the party to a
 * map that is usually unreachable any other way. Names the giver and
 * destination, shows the giver's authored `message` (if any) and the
 * destination's description, and offers a single Travel button.
 *
 * There is deliberately no "Stay": the trip is the reward, and a
 * hidden map may have no other way in. The pending trip is persisted
 * in the save (`WorldSave.pendingTravel`) so a reload re-shows this
 * placard instead of losing the destination.
 *
 * Keyboard: Enter / E travels. Movement keys and Esc are swallowed in
 * the capture phase so the party can't wander off under the placard.
 */

import { useEffect } from "react";

export function TravelPlacard({
  questName,
  giverName,
  destinationName,
  destinationDescription,
  message,
  onTravel,
}: {
  questName: string;
  /** Who is sending the party. Empty → the copy falls back to "You
   *  are sent to …". */
  giverName: string;
  destinationName: string;
  destinationDescription?: string;
  /** Optional authored line from the quest giver. */
  message: string;
  onTravel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "e" || e.key === "E") {
        e.preventDefault();
        e.stopPropagation();
        onTravel();
        return;
      }
      if (
        [
          "Escape",
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
          " ",
          "Spacebar",
        ].includes(e.key)
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onTravel]);

  const sender = giverName.trim();
  const lead = sender
    ? `${sender} sends the party to ${destinationName}.`
    : `The party is sent to ${destinationName}.`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Travel to ${destinationName}`}
        className="flex w-full max-w-md flex-col rounded-lg border border-amber-300/60 bg-ink/95 shadow-2xl shadow-amber-300/20"
      >
        <header className="flex items-center justify-between gap-3 border-b border-parchment/15 px-4 py-2.5">
          <h2 className="font-display text-lg text-parchment">
            {destinationName}
          </h2>
          <span
            className="shrink-0 rounded border border-amber-300/60 bg-amber-300/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200"
            title={`A reward from the quest “${questName}”.`}
          >
            ⚜ Quest Reward
          </span>
        </header>

        <div className="px-4 py-3">
          {message ? (
            <blockquote className="mb-3 rounded border border-amber-300/30 bg-amber-300/5 px-3 py-2 text-sm italic leading-snug text-amber-100/90">
              “{message}”
              {sender ? (
                <span className="mt-1 block text-right text-xs not-italic text-amber-200/80">
                  — {sender}
                </span>
              ) : null}
            </blockquote>
          ) : null}
          <p className="text-sm leading-snug text-parchment/85">{lead}</p>
          {destinationDescription ? (
            <p className="mt-2 text-sm leading-snug text-parchment/65">
              {destinationDescription}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-amber-200/80">⚜ {questName}</p>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-parchment/15 px-4 py-2.5">
          <span className="text-xs text-parchment/55">
            The journey begins when you are ready.
          </span>
          <button
            type="button"
            onClick={onTravel}
            autoFocus
            className="rounded border border-ember/60 bg-ember/20 px-3 py-1 text-xs text-parchment hover:bg-ember/35"
            title="Travel (Enter)"
          >
            Travel
          </button>
        </footer>
      </div>
    </div>
  );
}
