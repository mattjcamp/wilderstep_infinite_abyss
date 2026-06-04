"use client";

/**
 * Modal overlay that opens when the party steps onto a cell tagged
 * with a `quest` id. The sim's `quest_encountered` event delivers the
 * quest record; this component renders the quest_giver's sprite +
 * name, the quest description, the start_dialog, and Accept / Decline
 * buttons.
 *
 *   - Accept — host calls `sim.markQuestAccepted(id)` so the tile
 *              never re-offers + writes the id into the save.
 *   - Decline — host just closes the overlay. Re-stepping the cell
 *              will re-offer (the kernel only suppresses accepted
 *              quests, not declined ones).
 *
 * Mirrors the LockDialogOverlay / SpawnEncounterOverlay layout so the
 * three modal types read consistently. No rewards, no step tracking
 * here — that's a later pass.
 */

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/util/basePath";
import type { SimQuestRef } from "@/sim/types";

interface Props {
  quest: SimQuestRef;
  /** True when the quest has already been accepted. The overlay
   *  switches to an in-progress / complete view: the Accept /
   *  Decline rows collapse to a single Close button. The exact copy
   *  depends on whether `stepIdx` has caught up to `stepCount`. */
  alreadyAccepted?: boolean;
  /** Index of the NEXT pending step (matches WorldSave.questStepProgress
   *  semantics). 0 = first step still pending, stepCount = all done.
   *  Only consulted when `alreadyAccepted` is true. */
  stepIdx?: number;
  /** Total number of steps in the quest. Only consulted when
   *  `alreadyAccepted` is true. */
  stepCount?: number;
  /** Display name of the active step. Surfaced as the headline
   *  objective in the in-progress view. */
  activeStepName?: string;
  /** Description of the active step. Surfaced as italic detail in
   *  the in-progress view. */
  activeStepDescription?: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function QuestDialogOverlay({
  quest,
  alreadyAccepted = false,
  stepIdx = 0,
  stepCount = 0,
  activeStepName,
  activeStepDescription,
  onAccept,
  onDecline,
}: Props) {
  const complete =
    alreadyAccepted && stepCount > 0 && stepIdx >= stepCount;

  // Build the visible action list based on the dialog's three
  // states (offered / in-progress / complete). The labels match the
  // button copy below so the keyboard cursor walks the same set the
  // player sees. The order is intentional — Accept is what most
  // players want to do first on an offered quest, so Enter on the
  // dialog opening fires Accept.
  type QuestAction = "accept" | "decline" | "close";
  const actions = useMemo<QuestAction[]>(() => {
    if (complete) return ["close"];
    if (alreadyAccepted) return ["close"];
    return ["accept", "decline"];
  }, [complete, alreadyAccepted]);
  const [focusedAction, setFocusedAction] = useState<number>(0);
  // Clamp the focus when the action set shrinks (e.g. the host
  // re-renders the dialog after an Accept resolves and we're now in
  // the in-progress single-button view).
  useEffect(() => {
    setFocusedAction((cur) => Math.min(cur, actions.length - 1));
  }, [actions.length]);

  // Up/Down cycle through the visible buttons; Enter fires whichever
  // one is focused; Esc closes (Decline / Close depending on state).
  // Capture-phase + stopPropagation so the wrapping host's overlay
  // listeners don't ALSO act on the same keys (PlayHost gates the
  // sim via `overlaysOpenRef` while a quest dialog is up).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setFocusedAction((i) => (i + 1) % actions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setFocusedAction(
          (i) => (i - 1 + actions.length) % actions.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const a = actions[focusedAction];
        if (a === "accept") onAccept();
        else onDecline(); // covers "decline" and "close"
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // Esc is always "back out one level" — for the quest dialog
        // that maps to Decline (offered state) or Close (in-progress
        // / complete states). Both flow through onDecline, which the
        // host wires to dismiss the modal without persisting an
        // accept. Matches the same Esc-as-cancel idiom the lock and
        // npc-dialog overlays use.
        onDecline();
        return;
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [actions, focusedAction, onAccept, onDecline]);

  const giver = quest.quest_giver;
  const giverSprite = giver?.npc_sprite
    ? withBasePath(`/sprites/${giver.npc_sprite}`)
    : null;
  const giverName = giver?.npc_name ?? "Quest Giver";
  // Dialog text varies by state:
  //   - complete  → giver's end_dialog (the handoff after success)
  //   - accepted  → giver's start_dialog (reminder of the ask)
  //   - offered   → giver's start_dialog (the offer itself)
  // Each falls back to the quest description / a generic line if
  // the record doesn't carry the targeted dialog string.
  const dialog = complete
    ? giver?.end_dialog ?? "Thank you. The deed is done."
    : giver?.start_dialog ?? quest.description ?? "They have a task for you.";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label={`Quest offered: ${quest.name}`}
    >
      <div className="w-[480px] rounded-lg border border-parchment/25 bg-ink/95 p-4 text-parchment shadow-xl">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">{quest.name}</h2>
          <span className="font-mono text-xs text-parchment/65">
            {complete
              ? "Quest complete"
              : alreadyAccepted
                ? `Quest in progress (${stepIdx}/${stepCount})`
                : "Quest offered"}
          </span>
        </header>

        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-parchment/20 bg-ink/80">
            {giverSprite ? (
              <img
                src={giverSprite}
                alt=""
                width={44}
                height={44}
                style={{ imageRendering: "pixelated" }}
                className="h-11 w-11 object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility =
                    "hidden";
                }}
              />
            ) : (
              <span className="px-1 text-[9px] text-parchment/75">
                {giverName.slice(0, 3)}
              </span>
            )}
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-parchment/65">
              {giverName}
            </p>
            <p className="mt-1 text-sm leading-snug text-parchment/85">
              {dialog}
            </p>
          </div>
        </div>

        {quest.description && quest.description !== dialog ? (
          <p className="mb-3 rounded border border-parchment/10 bg-ink/60 p-2 text-[13px] italic text-parchment/80">
            {quest.description}
          </p>
        ) : null}

        {alreadyAccepted && !complete && activeStepName ? (
          <div className="mb-3 rounded border border-parchment/15 bg-ink/60 p-2">
            <p className="text-xs uppercase tracking-wide text-parchment/65">
              Active objective ({stepIdx + 1}/{stepCount})
            </p>
            <p className="text-sm text-parchment/85">→ {activeStepName}</p>
            {activeStepDescription ? (
              <p className="mt-1 text-xs italic text-parchment/75">
                {activeStepDescription}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {(() => {
            // Each button looks up its own slot in `actions` so the
            // amber outline ring + click → keyboard cursor sync stay
            // in lockstep regardless of which view is rendered. The
            // ring is an `outline` (not a border) so it doesn't
            // affect the button's box size — focus moves between
            // buttons cleanly without layout jitter.
            const focusRing =
              "outline outline-2 outline-amber-200 outline-offset-1";
            const acceptIdx = actions.indexOf("accept");
            const declineIdx = actions.indexOf("decline");
            const closeIdx = actions.indexOf("close");
            return (
              <>
                {complete ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFocusedAction(closeIdx);
                      onDecline();
                    }}
                    className={[
                      "rounded border border-emerald-500/50 bg-emerald-700/25 px-3 py-2 text-left text-sm text-emerald-50 hover:bg-emerald-700/45",
                      focusedAction === closeIdx ? focusRing : "",
                    ].join(" ")}
                  >
                    <div className="font-medium">Close</div>
                    <div className="text-xs text-emerald-100/75">
                      Every objective is finished. Rewards arrive when
                      the completion flow lands; for now, well done.
                    </div>
                  </button>
                ) : alreadyAccepted ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFocusedAction(closeIdx);
                      onDecline();
                    }}
                    className={[
                      "rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm hover:bg-ink/60",
                      focusedAction === closeIdx ? focusRing : "",
                    ].join(" ")}
                  >
                    <div className="font-medium">Close</div>
                    <div className="text-xs text-parchment/75">
                      The quest is already in your log. Return when
                      the objective is complete.
                    </div>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setFocusedAction(acceptIdx);
                        onAccept();
                      }}
                      className={[
                        "rounded border border-ember/60 bg-ember/25 px-3 py-2 text-left text-sm hover:bg-ember/45",
                        focusedAction === acceptIdx ? focusRing : "",
                      ].join(" ")}
                    >
                      <div className="font-medium">Accept the quest</div>
                      <div className="text-xs text-parchment/75">
                        Add it to your quest log. You can talk to the
                        quest giver again any time.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFocusedAction(declineIdx);
                        onDecline();
                      }}
                      className={[
                        "rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm hover:bg-ink/60",
                        focusedAction === declineIdx ? focusRing : "",
                      ].join(" ")}
                    >
                      <div className="font-medium">Decline for now</div>
                      <div className="text-xs text-parchment/75">
                        Close the dialog. Step adjacent and bump the
                        quest giver to re-open this offer.
                      </div>
                    </button>
                  </>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
