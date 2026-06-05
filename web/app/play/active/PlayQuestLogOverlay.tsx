"use client";

/**
 * Quest log modal — opens with `Q` from the play screen. Lists every
 * quest the party has interacted with, grouped by status:
 *
 *   - **Active**: quest is in `acceptedQuests`, has remaining steps.
 *   - **Complete (rewards pending)**: all steps done, but the player
 *     hasn't bumped the quest giver to claim. Player walks back to
 *     the giver to turn in.
 *   - **Turned in**: quest id is in `turnedInQuests`; rewards have
 *     been claimed. Surfaced separately so the player can review
 *     completed adventures without losing them in the active queue.
 *
 * Read-only. Players don't manipulate quests from here — they
 * accept/turn-in through the in-world quest dialog.
 */

import { useEffect } from "react";
import type { SimQuestRef } from "@/sim/types";

interface QuestStep {
  id?: string;
  name?: string;
  description?: string;
}

/** Completed step ids for a quest — authoritative `questStepsDone`
 *  with a legacy `questStepProgress` (first N) fallback. Mirrors
 *  `doneSetForQuest` in the painted log + `completedStepIds` in
 *  `@/play/questSteps`; kept local so this overlay has no import
 *  coupling. */
function doneSet(
  questId: string,
  steps: QuestStep[],
  questStepProgress: Readonly<Record<string, number>>,
  questStepsDone: Readonly<Record<string, ReadonlyArray<string>>>,
): Set<string> {
  const explicit = questStepsDone[questId];
  if (explicit) return new Set(explicit);
  const n = questStepProgress[questId] ?? 0;
  const out = new Set<string>();
  for (let i = 0; i < Math.min(n, steps.length); i++) {
    out.add(steps[i].id ?? `__idx_${i}`);
  }
  return out;
}

export function PlayQuestLogOverlay({
  quests,
  acceptedQuests,
  questStepProgress,
  questStepsDone = {},
  turnedInQuests,
  onClose,
}: {
  quests: ReadonlyArray<SimQuestRef>;
  acceptedQuests: ReadonlyArray<string>;
  questStepProgress: Readonly<Record<string, number>>;
  questStepsDone?: Readonly<Record<string, ReadonlyArray<string>>>;
  turnedInQuests: ReadonlyArray<string>;
  onClose: () => void;
}) {
  // ESC and Q close. Capture so the underlying sim's movement keys
  // don't fire under the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "q" || e.key === "Q") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      } else if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "w" ||
        e.key === "a" ||
        e.key === "s" ||
        e.key === "d" ||
        e.key === "W" ||
        e.key === "A" ||
        e.key === "S" ||
        e.key === "D"
      ) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  const byId = new Map(quests.map((q) => [q.id, q]));
  const turnedInSet = new Set(turnedInQuests);

  // Build three buckets in one pass.
  const active: SimQuestRef[] = [];
  const completeRewardsPending: SimQuestRef[] = [];
  const turnedIn: SimQuestRef[] = [];
  for (const id of acceptedQuests) {
    const q = byId.get(id);
    if (!q) continue;
    if (turnedInSet.has(id)) {
      turnedIn.push(q);
      continue;
    }
    const steps = ((q as unknown as { steps?: QuestStep[] }).steps ?? []);
    const done = doneSet(id, steps, questStepProgress, questStepsDone);
    const complete =
      steps.length > 0 &&
      steps.every((s, i) => done.has(s.id ?? `__idx_${i}`));
    if (complete) completeRewardsPending.push(q);
    else active.push(q);
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h2 className="font-display text-base text-parchment">
            Quest Log
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
            title="Close (Q or ESC)"
          >
            Close
          </button>
        </div>
        <div className="p-3">
          {acceptedQuests.length === 0 ? (
            <p className="text-sm text-parchment/55">
              You haven&apos;t accepted any quests yet. Look for quest
              givers in towns and dungeons.
            </p>
          ) : (
            <div className="space-y-4">
              <QuestSection
                label="Active"
                quests={active}
                questStepProgress={questStepProgress}
                questStepsDone={questStepsDone}
                emptyHint="No quests in progress."
              />
              <QuestSection
                label="Ready to Turn In"
                quests={completeRewardsPending}
                questStepProgress={questStepProgress}
                questStepsDone={questStepsDone}
                emptyHint=""
                stateTag="rewards-pending"
              />
              <QuestSection
                label="Completed"
                quests={turnedIn}
                questStepProgress={questStepProgress}
                questStepsDone={questStepsDone}
                emptyHint=""
                stateTag="turned-in"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestSection({
  label,
  quests,
  questStepProgress,
  questStepsDone,
  emptyHint,
  stateTag,
}: {
  label: string;
  quests: ReadonlyArray<SimQuestRef>;
  questStepProgress: Readonly<Record<string, number>>;
  questStepsDone: Readonly<Record<string, ReadonlyArray<string>>>;
  emptyHint: string;
  stateTag?: "rewards-pending" | "turned-in";
}) {
  if (quests.length === 0 && !emptyHint) return null;
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wide text-amber-300">
        {label}
      </h3>
      {quests.length === 0 ? (
        <p className="mt-1 text-xs text-parchment/45">{emptyHint}</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {quests.map((q) => {
            const steps =
              ((q as unknown as { steps?: QuestStep[] }).steps ?? []);
            const stepCount = steps.length;
            const done = doneSet(
              q.id,
              steps,
              questStepProgress,
              questStepsDone,
            );
            const stepId = (i: number) => steps[i].id ?? `__idx_${i}`;
            const doneCount = steps.reduce(
              (n, _s, i) => (done.has(stepId(i)) ? n + 1 : n),
              0,
            );
            const complete = stepCount > 0 && doneCount >= stepCount;
            // First incomplete step = the one we surface as "current"
            // (description hint), matching the painted log.
            const firstIncompleteIdx = complete
              ? -1
              : steps.findIndex((_s, i) => !done.has(stepId(i)));
            const tagClass =
              stateTag === "rewards-pending"
                ? "text-amber-300"
                : stateTag === "turned-in"
                  ? "text-parchment/45"
                  : complete
                    ? "text-emerald-300"
                    : "text-parchment/50";
            const tagText =
              stateTag === "rewards-pending"
                ? "Return to the giver to claim"
                : stateTag === "turned-in"
                  ? "Turned in"
                  : complete
                    ? "Complete"
                    : `${doneCount}/${stepCount} steps`;
            const allDone =
              stateTag === "rewards-pending" || stateTag === "turned-in";
            return (
              <li
                key={q.id}
                className="rounded border border-parchment/15 bg-ink/40 p-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-sm text-parchment">
                    {q.name}
                  </span>
                  <span
                    className={`font-mono text-[10px] ${tagClass}`}
                  >
                    {tagText}
                  </span>
                </div>
                {q.description ? (
                  <p className="mt-1 text-[11px] text-parchment/55">
                    {q.description}
                  </p>
                ) : null}
                {stepCount > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {steps.map((s, i) => {
                      const stepDone = allDone || done.has(stepId(i));
                      const isCurrent = !stepDone && i === firstIncompleteIdx;
                      const glyph = stepDone ? "✓" : isCurrent ? "→" : "·";
                      const rowClass = stepDone
                        ? "text-emerald-300"
                        : isCurrent
                          ? "text-amber-300"
                          : "text-parchment/45";
                      return (
                        <li key={s.id ?? i} className="text-[11px]">
                          <span className={`font-mono ${rowClass}`}>
                            {glyph} {s.name ?? `Step ${i + 1}`}
                          </span>
                          {/* Every step shows its description so the
                              player can scroll the log and read the
                              full plan — what's been done, what's in
                              hand, what's still ahead. The current
                              step stays the brightest; done/pending
                              details render dimmer so the list still
                              scans at a glance. */}
                          {s.description ? (
                            <div
                              className={`ml-3 text-[11px] italic ${
                                isCurrent
                                  ? "text-parchment/75"
                                  : "text-parchment/45"
                              }`}
                            >
                              {s.description}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
