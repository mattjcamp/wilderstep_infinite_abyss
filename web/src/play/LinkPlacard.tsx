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

export function LinkPlacard({
  placeKind,
  name,
  description,
  explored,
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

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col rounded-lg border border-parchment/25 bg-ink/95 shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-parchment/15 px-4 py-2.5">
          <h2 className="font-display text-lg text-parchment">{name}</h2>
          <span
            className={[
              "shrink-0 rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide",
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
