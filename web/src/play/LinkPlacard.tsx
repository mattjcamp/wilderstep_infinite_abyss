"use client";

/**
 * Place placard — a confirm prompt shown when the party steps onto a
 * link tile or dungeon entrance the author flagged `show_link_placard`.
 * It names the destination, shows its description, and marks whether
 * the party has been there before, then asks the player to commit
 * before crossing.
 *
 * Shared by the play host (app/play/active/PlayHost) and the editor's
 * sim mode (src/editor/MapEditor) so both surfaces present the feature
 * identically. The kernel does NOT traverse / enter on its own for
 * flagged tiles — it emits `place_encountered` and waits. Confirming
 * here runs the same transition the immediate path would; cancelling
 * leaves the party where they are.
 *
 * Keyboard: Enter / E confirm, Esc / backdrop cancel. Capture phase so
 * the world movement keys underneath don't fire while it's open.
 */

import { useEffect } from "react";
import type { QuestPlacardTarget } from "./questPlacardTargets";

export function LinkPlacard({
  placeKind,
  name,
  description,
  explored,
  questTargets,
  onConfirm,
  onCancel,
}: {
  placeKind: "link" | "dungeon";
  name: string;
  description?: string;
  /** True when the party has visited this destination before. Drives
   *  the badge so the player can tell a fresh discovery from a return
   *  trip. */
  explored: boolean;
  /** Active quests with an incomplete step at this destination —
   *  computed by `questsTargetingPlace`. Non-empty switches the
   *  placard into its quest treatment: gold frame, a ⚜ Quest chip in
   *  the header, and one "quest — step" context line per entry under
   *  the description. Optional so callers without quest state (or
   *  destinations with no quest relevance) render the plain placard. */
  questTargets?: ReadonlyArray<QuestPlacardTarget>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "e" || e.key === "E") {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      // Swallow movement keys so the party doesn't step under the
      // placard.
      if (
        [
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
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onConfirm, onCancel]);

  const confirmLabel = placeKind === "dungeon" ? "Descend" : "Travel";
  const prompt =
    placeKind === "dungeon"
      ? "Descend into this dungeon?"
      : "Travel to this place?";
  // Quest treatment — the frame and header pick up gold accents when
  // any active quest has an incomplete step at this destination.
  const questRelevant = (questTargets?.length ?? 0) > 0;

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={[
          "flex w-full max-w-md flex-col rounded-lg border bg-ink/95 shadow-2xl",
          questRelevant
            ? "border-amber-300/60 shadow-amber-300/20"
            : "border-parchment/25",
        ].join(" ")}
      >
        <header className="flex items-center justify-between gap-3 border-b border-parchment/15 px-4 py-2.5">
          <h2 className="font-display text-lg text-parchment">{name}</h2>
          <div className="flex shrink-0 items-center gap-1.5">
            {questRelevant ? (
              <span
                className="rounded border border-amber-300/60 bg-amber-300/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200"
                title="An active quest has an objective here."
              >
                ⚜ Quest
              </span>
            ) : null}
            <span
              className={[
                "rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                explored
                  ? "border-parchment/25 text-parchment/55"
                  : "border-amber-300/50 bg-amber-300/10 text-amber-200",
              ].join(" ")}
              title={
                explored
                  ? "Your party has been here before."
                  : "Your party has not explored this place yet."
              }
            >
              {explored ? "Explored" : "Unexplored"}
            </span>
          </div>
        </header>

        <div className="px-4 py-3">
          {description ? (
            <p className="text-sm leading-snug text-parchment/85">
              {description}
            </p>
          ) : (
            <p className="text-sm italic text-parchment/50">
              The way leads onward into the unknown.
            </p>
          )}
          {questRelevant ? (
            <div className="mt-3 rounded border border-amber-300/30 bg-amber-300/5 px-3 py-2">
              {questTargets!.map((t) => (
                <p
                  key={`${t.questId}:${t.stepId}`}
                  className="text-xs leading-snug text-amber-100/90"
                >
                  <span className="font-semibold text-amber-200">
                    ⚜ {t.questName}
                  </span>
                  <span className="text-amber-100/70"> — {t.stepName}</span>
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-parchment/15 px-4 py-2.5">
          <span className="text-xs text-parchment/55">{prompt}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-parchment/20 px-3 py-1 text-xs text-parchment/80 hover:bg-ink/50"
              title="Stay where you are (Esc)"
            >
              Stay
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded border border-ember/60 bg-ember/20 px-3 py-1 text-xs text-parchment hover:bg-ember/35"
              title="Enter (Enter)"
            >
              {confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
