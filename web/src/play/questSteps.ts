/**
 * Quest step bookkeeping — the order-independent completion model.
 *
 * Background: the save originally tracked quest progress as a single
 * integer per quest (`questStepProgress[id]` = "next incomplete step
 * index"). That can only express *sequential* completion: it literally
 * cannot say "step 3 done, steps 1-2 pending." A player who cleared a
 * later objective first got no credit and saw nothing in the quest log.
 *
 * The fix moves the source of truth to a set of completed STEP IDS per
 * quest (`questStepsDone[id]`). Steps carry stable `id`s in the quest
 * JSON, so completion is tracked per-step regardless of order. The
 * legacy integer is kept in sync as a derived "leading run" count so
 * the many existing readers (dialog gating, painted log) keep working
 * for the common all-in-order case.
 *
 * Everything here is pure + save-shaped (plain arrays/records, no Sets
 * on the wire) so it round-trips through JSON and is trivially testable.
 */

/** Minimal step shape these helpers read — just the stable id. Both
 *  the parsed `QuestStep` and the raw JSON step satisfy it. */
export interface StepLike {
  id: string;
}

/** Minimal quest shape — an ordered list of steps with ids. */
export interface QuestLike {
  id: string;
  steps: ReadonlyArray<StepLike>;
}

/** The two save fields these helpers operate on, pulled out so callers
 *  can pass a whole `WorldSave` or a narrowed object in tests. */
export interface QuestProgressFields {
  questStepProgress?: Record<string, number>;
  questStepsDone?: Record<string, ReadonlyArray<string>>;
}

/** Completed step ids for one quest, as a Set for O(1) membership.
 *  Reads the authoritative `questStepsDone`; falls back to deriving
 *  from the legacy `questStepProgress` integer (first N step ids) when
 *  a quest has no `questStepsDone` entry yet — i.e. an old save mid-
 *  quest. `def` is needed for that backfill (to map index → id). */
export function completedStepIds(
  fields: QuestProgressFields,
  def: QuestLike,
): Set<string> {
  const explicit = fields.questStepsDone?.[def.id];
  if (explicit) return new Set(explicit);
  // Legacy backfill: the old integer means "first N steps done."
  const n = fields.questStepProgress?.[def.id] ?? 0;
  const out = new Set<string>();
  for (let i = 0; i < Math.min(n, def.steps.length); i++) {
    out.add(def.steps[i].id);
  }
  return out;
}

/** True when `step` (by index) is complete for `def` under the given
 *  save fields. Convenience over {@link completedStepIds} for spot
 *  checks. */
export function isStepDone(
  fields: QuestProgressFields,
  def: QuestLike,
  stepIdx: number,
): boolean {
  const step = def.steps[stepIdx];
  if (!step) return false;
  return completedStepIds(fields, def).has(step.id);
}

/** How many of a quest's steps are complete (in any order). */
export function completedStepCount(
  fields: QuestProgressFields,
  def: QuestLike,
): number {
  const done = completedStepIds(fields, def);
  let n = 0;
  for (const s of def.steps) if (done.has(s.id)) n += 1;
  return n;
}

/** True when EVERY step in the quest def is complete — the quest body
 *  is done and the party can return to the giver to claim. An empty
 *  step list is treated as not-complete (matches the legacy
 *  `stepCount > 0 && idx >= stepCount` gate). */
export function isQuestBodyComplete(
  fields: QuestProgressFields,
  def: QuestLike,
): boolean {
  if (def.steps.length === 0) return false;
  const done = completedStepIds(fields, def);
  return def.steps.every((s) => done.has(s.id));
}

/** Derive the legacy `questStepProgress` integer from a completed-id
 *  set: the length of the leading run of completed steps. A quest done
 *  fully in order yields `steps.length` (unchanged from before); an
 *  out-of-order quest yields the count of consecutive completed steps
 *  from the front, which is the best the linear field can represent.
 *  The authoritative state stays in `questStepsDone`; this keeps the
 *  derived field sensible for coarse legacy readers. */
export function leadingRunCount(
  done: ReadonlySet<string>,
  def: QuestLike,
): number {
  let n = 0;
  for (const s of def.steps) {
    if (!done.has(s.id)) break;
    n += 1;
  }
  return n;
}

/** Result of {@link markStepDone}: a fresh, immutable pair of the two
 *  progress fields with `stepId` added for `questId`. Callers spread
 *  this back over the save. Idempotent — marking an already-done step
 *  returns equal-valued fields (and `changed: false`). */
export interface MarkStepResult {
  questStepProgress: Record<string, number>;
  questStepsDone: Record<string, ReadonlyArray<string>>;
  changed: boolean;
  /** True when this mark completed the final outstanding step. */
  questNowComplete: boolean;
}

/** Mark one step (by id) complete for a quest, returning updated copies
 *  of both progress fields. Pure: does not mutate the input. Keeps the
 *  legacy `questStepProgress` integer in sync as the leading-run count.
 */
export function markStepDone(
  fields: QuestProgressFields,
  def: QuestLike,
  stepId: string,
): MarkStepResult {
  const prevDoneArr = fields.questStepsDone?.[def.id] ?? [];
  const prevDone = new Set(prevDoneArr);
  const alreadyDone = prevDone.has(stepId);
  const nextDone = alreadyDone ? prevDone : new Set(prevDone).add(stepId);

  const nextStepsDone: Record<string, ReadonlyArray<string>> = {
    ...(fields.questStepsDone ?? {}),
    [def.id]: Array.from(nextDone),
  };
  const nextProgress: Record<string, number> = {
    ...(fields.questStepProgress ?? {}),
    [def.id]: leadingRunCount(nextDone, def),
  };
  const questNowComplete =
    def.steps.length > 0 && def.steps.every((s) => nextDone.has(s.id));

  return {
    questStepProgress: nextProgress,
    questStepsDone: nextStepsDone,
    changed: !alreadyDone,
    questNowComplete,
  };
}
