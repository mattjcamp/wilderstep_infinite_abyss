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

import { useEffect, useMemo, useState } from "react";
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
  canSteal,
  onSteal,
  onAskToMove,
  onClose,
}: {
  npcName: string;
  npcSprite?: string;
  dialogs: ReadonlyArray<DialogLine>;
  hasCounter: boolean;
  onVisitCounter: () => void;
  /** Fires when the player asks the NPC to step aside. The host
   *  relocates the NPC one tile (if it can) and decides whether to
   *  close the dialog. Hidden when not provided (e.g. a context
   *  where moving the NPC makes no sense). */
  onAskToMove?: () => void;
  /** True when an alive Halfling is in the party AND this NPC
   *  hasn't been pickpocketed yet. Surfaces the Steal button in
   *  the footer. Hidden entirely (rather than greyed) when false,
   *  matching the action-menu convention — the player only sees
   *  the option when it's actually doable. */
  canSteal?: boolean;
  /** Fires when the player clicks Steal. The host runs the
   *  Pickpocket attempt, persists the per-NPC marker into the
   *  save, surfaces the loot / refusal message in the log, and
   *  decides whether to close the dialog. */
  onSteal?: () => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const total = dialogs.length;
  const current = total > 0 ? dialogs[Math.min(cursor, total - 1)] : null;

  // Build the action list dynamically from the visibility gates the
  // host wired. The order — Steal → Visit Counter → Leave — matches
  // the left-to-right order in the footer so the keyboard cursor
  // walks the same path the player's eye does.
  //
  // Each entry carries its own onClick so the keydown handler +
  // click handlers funnel through a single place. The label is kept
  // for screen-reader / debugging contexts; the visible UI reads
  // off the button JSX below for finer-grained styling control.
  interface DialogAction {
    label: "Steal" | "Visit Counter" | "Ask to Move" | "Leave";
    onClick: () => void;
  }
  const actions = useMemo<DialogAction[]>(() => {
    const list: DialogAction[] = [];
    if (canSteal && onSteal) list.push({ label: "Steal", onClick: onSteal });
    if (hasCounter)
      list.push({ label: "Visit Counter", onClick: onVisitCounter });
    if (onAskToMove)
      list.push({ label: "Ask to Move", onClick: onAskToMove });
    list.push({ label: "Leave", onClick: onClose });
    return list;
  }, [canSteal, hasCounter, onSteal, onVisitCounter, onAskToMove, onClose]);
  /** Which action button the keyboard cursor is on. Up/Down wraps
   *  through it; Enter fires the highlighted action. Defaults to 0
   *  — the first non-Leave entry when one exists, otherwise Leave
   *  alone, which Enter activates as "close the dialog." That makes
   *  the always-safe default of opening + immediately pressing
   *  Enter just dismiss the screen, matching the legacy click-only
   *  behavior where the player's first move was usually Leave. */
  const [actionIndex, setActionIndex] = useState(0);
  // Clamp when the visible set shrinks (host re-renders with a
  // different `canSteal` after a Pickpocket attempt resolves).
  useEffect(() => {
    setActionIndex((cur) => Math.min(cur, Math.max(0, actions.length - 1)));
  }, [actions.length]);

  // ESC closes. Left/Right cycle dialog lines (read at your own
  // pace); Up/Down cycle action buttons; Enter fires whichever
  // action is highlighted. Capture-phase so the underlying sim
  // doesn't react to the same arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowRight") {
        e.stopPropagation();
        e.preventDefault();
        if (total > 0) setCursor((i) => (i + 1) % total);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.stopPropagation();
        e.preventDefault();
        if (total > 0) setCursor((i) => (i - 1 + total) % total);
        return;
      }
      if (e.key === "ArrowDown") {
        e.stopPropagation();
        e.preventDefault();
        if (actions.length > 0) {
          setActionIndex((i) => (i + 1) % actions.length);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.stopPropagation();
        e.preventDefault();
        if (actions.length > 0) {
          setActionIndex(
            (i) => (i - 1 + actions.length) % actions.length,
          );
        }
        return;
      }
      if (e.key === "Enter") {
        e.stopPropagation();
        e.preventDefault();
        const a = actions[actionIndex];
        if (a) a.onClick();
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
  }, [onClose, total, actions, actionIndex]);

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
            {/* Each action button looks up its slot in the dynamic
                `actions` list so the cursor highlight + click sync
                stay correct as the visible set changes (e.g. Steal
                disappears after a Pickpocket marks the NPC). The
                ring is an `outline` so it sits on top of the
                button's existing border without changing layout. */}
            {(() => {
              const focusRing =
                "outline outline-2 outline-amber-200 outline-offset-1";
              const stealIdx = actions.findIndex((a) => a.label === "Steal");
              const counterIdx = actions.findIndex(
                (a) => a.label === "Visit Counter",
              );
              const askMoveIdx = actions.findIndex(
                (a) => a.label === "Ask to Move",
              );
              const leaveIdx = actions.findIndex((a) => a.label === "Leave");
              return (
                <>
                  {stealIdx >= 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionIndex(stealIdx);
                        actions[stealIdx].onClick();
                      }}
                      className={[
                        "rounded border border-amber-400/60 bg-amber-400/20 px-3 py-1 text-xs text-parchment hover:bg-amber-400/35",
                        actionIndex === stealIdx ? focusRing : "",
                      ].join(" ")}
                      title="Halfling: attempt to pick this NPC's pocket. Once per NPC, with a chance of failure."
                    >
                      Steal
                    </button>
                  ) : null}
                  {counterIdx >= 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionIndex(counterIdx);
                        actions[counterIdx].onClick();
                      }}
                      className={[
                        "rounded border border-ember/60 bg-ember/30 px-3 py-1 text-xs text-parchment hover:bg-ember/50",
                        actionIndex === counterIdx ? focusRing : "",
                      ].join(" ")}
                      title="Open this NPC's shop / temple."
                    >
                      Visit Counter
                    </button>
                  ) : null}
                  {askMoveIdx >= 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionIndex(askMoveIdx);
                        actions[askMoveIdx].onClick();
                      }}
                      className={[
                        "rounded border border-parchment/20 px-3 py-1 text-xs text-parchment/85 hover:bg-ink/50",
                        actionIndex === askMoveIdx ? focusRing : "",
                      ].join(" ")}
                      title="Ask this NPC to step aside so you can pass."
                    >
                      Ask to Move
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setActionIndex(leaveIdx);
                      actions[leaveIdx].onClick();
                    }}
                    className={[
                      "rounded border border-parchment/20 px-3 py-1 text-xs text-parchment/85 hover:bg-ink/50",
                      actionIndex === leaveIdx ? focusRing : "",
                    ].join(" ")}
                  >
                    Leave
                  </button>
                </>
              );
            })()}
          </div>
        </footer>
      </div>
    </div>
  );
}
