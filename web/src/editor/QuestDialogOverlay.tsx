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

import { withBasePath } from "@/util/basePath";
import type { SimQuestRef } from "@/sim/types";

interface Props {
  quest: SimQuestRef;
  /** True when the quest has already been accepted. The overlay
   *  switches to an in-progress view: same banner + description, but
   *  the Accept / Decline rows are replaced with a single Close
   *  button so the player can confirm the active objective and
   *  return to the world. */
  alreadyAccepted?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function QuestDialogOverlay({
  quest,
  alreadyAccepted = false,
  onAccept,
  onDecline,
}: Props) {
  const giver = quest.quest_giver;
  const giverSprite = giver?.npc_sprite
    ? withBasePath(`/sprites/${giver.npc_sprite}`)
    : null;
  const giverName = giver?.npc_name ?? "Quest Giver";
  // Dialog falls back to the description when the quest record
  // doesn't author a start_dialog (legacy quests + stub records).
  const dialog =
    giver?.start_dialog ??
    quest.description ??
    "They have a task for you.";

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
          <span className="font-mono text-[11px] text-parchment/45">
            {alreadyAccepted ? "Quest in progress" : "Quest offered"}
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
              <span className="px-1 text-[9px] text-parchment/55">
                {giverName.slice(0, 3)}
              </span>
            )}
          </div>
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-wide text-parchment/45">
              {giverName}
            </p>
            <p className="mt-1 text-sm leading-snug text-parchment/85">
              {dialog}
            </p>
          </div>
        </div>

        {quest.description && quest.description !== dialog ? (
          <p className="mb-3 rounded border border-parchment/10 bg-ink/60 p-2 text-xs italic text-parchment/65">
            {quest.description}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {alreadyAccepted ? (
            <button
              type="button"
              onClick={onDecline}
              className="rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm hover:bg-ink/60"
            >
              <div className="font-medium">Close</div>
              <div className="text-[11px] text-parchment/55">
                The quest is already in your log. Return when the
                objective is complete.
              </div>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onAccept}
                className="rounded border border-ember/60 bg-ember/25 px-3 py-2 text-left text-sm hover:bg-ember/45"
              >
                <div className="font-medium">Accept the quest</div>
                <div className="text-[11px] text-parchment/55">
                  Add it to your quest log. You can talk to the
                  quest giver again any time.
                </div>
              </button>

              <button
                type="button"
                onClick={onDecline}
                className="rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm hover:bg-ink/60"
              >
                <div className="font-medium">Decline for now</div>
                <div className="text-[11px] text-parchment/55">
                  Close the dialog. Step adjacent and bump the
                  quest giver to re-open this offer.
                </div>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
