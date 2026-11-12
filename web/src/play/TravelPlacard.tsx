"use client";

/**
 * Travel placard — announces a quest "travel" reward: the quest giver
 * (or the quest itself, for a step reward) is sending the party to a
 * map that is usually unreachable any other way. Names the giver and
 * destination, shows the giver's authored `message` (if any) and the
 * destination's description, and offers Travel and (when the host
 * passes `onLater`) "Later".
 *
 * "Later" never loses the trip: the pending trip stays persisted in the
 * save (`WorldSave.pendingTravel`, flagged `deferred`), and the host
 * keeps a "Travel to …" button on screen (and re-opens this placard
 * when the party talks to the quest giver) until the party goes. A
 * hidden map may have no other way in, so the trip is never dropped.
 *
 * Keyboard: arrows / WASD move between Later and Travel (Travel starts
 * highlighted), Enter / E / Space presses the highlighted one, Esc / L
 * chooses Later. Captured so the party can't wander off under the
 * placard.
 */

import { useEffect, useState } from "react";

export function TravelPlacard({
  questName,
  giverName,
  destinationName,
  destinationDescription,
  message,
  onTravel,
  onLater,
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
  /** "Come back later" — close the placard and keep the trip. Omit to
   *  show Travel only. */
  onLater?: () => void;
}) {
  // Buttons the arrow keys move between, in on-screen order (Later
  // sits left of Travel). Travel starts focused so Enter still means
  // "go" — same idiom as the quest dialog, where Accept starts focused.
  const actions: ReadonlyArray<"later" | "travel"> = onLater
    ? ["later", "travel"]
    : ["travel"];
  const [focused, setFocused] = useState<number>(actions.length - 1);
  useEffect(() => {
    setFocused((i) => Math.min(i, actions.length - 1));
  }, [actions.length]);

  useEffect(() => {
    const fire = (a: "later" | "travel" | undefined) => {
      if (a === "later") onLater?.();
      else onTravel();
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (k === "Enter" || k === "e" || k === "E" || k === " " || k === "Spacebar") {
        stop();
        fire(actions[focused]);
        return;
      }
      if (onLater && (k === "Escape" || k === "l" || k === "L")) {
        stop();
        onLater();
        return;
      }
      // Arrows / WASD step between the buttons (wrapping).
      const back = ["ArrowLeft", "ArrowUp", "a", "A", "w", "W"].includes(k);
      const fwd = ["ArrowRight", "ArrowDown", "d", "D", "s", "S"].includes(k);
      if (back || fwd) {
        stop();
        const n = actions.length;
        setFocused((i) => (i + (fwd ? 1 : -1) + n) % n);
        return;
      }
      if (k === "Escape") stop();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [actions, focused, onTravel, onLater]);

  const focusRing = "outline outline-2 outline-amber-200 outline-offset-1";
  const laterIdx = actions.indexOf("later");
  const travelIdx = actions.indexOf("travel");

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
          <div className="flex items-center gap-2">
          {onLater ? (
            <button
              type="button"
              onClick={onLater}
              onMouseEnter={() => setFocused(laterIdx)}
              className={[
                "rounded border border-parchment/25 px-3 py-1 text-xs text-parchment/85 hover:bg-ink/40",
                focused === laterIdx ? focusRing : "",
              ].join(" ")}
              title="Not yet — come back later (Esc)"
            >
              Later
            </button>
          ) : null}
          <button
            type="button"
            onClick={onTravel}
            onMouseEnter={() => setFocused(travelIdx)}
            className={[
              "rounded border border-ember/60 bg-ember/20 px-3 py-1 text-xs text-parchment hover:bg-ember/35",
              focused === travelIdx ? focusRing : "",
            ].join(" ")}
            title="Travel (Enter)"
          >
            Travel
          </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
