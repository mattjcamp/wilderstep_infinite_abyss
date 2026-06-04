/**
 * Host-side kill-step credit for combats the kernel's quest pipeline
 * doesn't own — authored (painted) encounters, i.e. fights whose
 * placed-encounter id is `placed-c-r` rather than `q-<quest>-<step>-<n>`.
 *
 * History / why this exists as its own module:
 *
 * The original `creditKillStep` lived inline in PlayHost and had two
 * bugs the playtest surfaced ("I killed the goblins but the step never
 * registered" / "steps don't show placards anymore but they show in
 * the log"):
 *
 *   1. It IGNORED the step's `count`. The first matching kill marked
 *      a multi-kill step complete in the save, so the quest log
 *      (painted from the save) raced ahead of the kernel's own
 *      counter — and on the next map remount the bootstrap read the
 *      save, told the kernel the step was done, and the kernel's
 *      completion placard never fired. Steps thereby completed
 *      "silently": visible in the log, never celebrated.
 *
 *   2. It returned only the updated save — no description of WHAT
 *      got credited — so the host had nothing to hang a placard or
 *      log line on even for legitimately-completed steps. Every
 *      credit through this path was invisible.
 *
 * The fix: kills are now counted in `save.questStepKills` (a
 * persisted per-quest, per-step counter), a step only flips complete
 * when its authored `count` is reached, and the function reports each
 * credit (partial or completing) so the host can fire the same
 * placard / log feedback the kernel path produces.
 *
 * Double-count protection: the kernel path (MapSimulation →
 * `quest_kill_credited`) owns quest-SPAWNED encounters. Callers must
 * skip this function for those fights — use {@link isKernelQuestKill}
 * on the resolved combat's `placedEncounterId`.
 */
import {
  completedStepIds,
  markStepDone,
  type QuestProgressFields,
} from "./questSteps";

/** Minimal raw step shape this module reads off the quests catalog
 *  (raw JSON shape — top-level `encounter_id` / `count` per the v2
 *  authoring format, with `params` fallbacks for older fixtures). */
interface RawKillStep {
  id?: string;
  name?: string;
  kind?: string;
  encounter_id?: string;
  count?: number | string;
  params?: {
    encounter_id?: string;
    monster_id?: string;
    count?: number | string;
  } | null;
  map_id?: string;
  dungeon_id?: string;
  dungeon_level?: number;
}

/** Minimal quest shape — raw catalog record with raw steps. */
interface RawQuestWithSteps {
  id: string;
  name?: string;
  steps?: ReadonlyArray<RawKillStep>;
}

/** The save fields this module reads / rewrites. Matches the
 *  corresponding optional fields on WorldSave so a whole save can be
 *  passed and spread-updated. */
export interface KillCreditFields extends QuestProgressFields {
  acceptedQuests?: ReadonlyArray<string>;
  turnedInQuests?: ReadonlyArray<string>;
  /** Persisted kill counters: quest id → step id → kills so far.
   *  Written here (authored-encounter kills) AND by the host's
   *  `quest_kill_credited` listener (kernel-spawned kills), and
   *  seeded into the kernel's in-session `stepKills` at sim mount so
   *  partial multi-kill progress survives map changes / reloads. */
  questStepKills?: Record<string, Record<string, number>>;
}

/** What the just-won combat looked like, from the host's
 *  SpawnEncounterOptions snapshot. */
export interface KillCombatInfo {
  /** Cleared encounter's catalog id (`combat.encounter?.id`). Null
   *  for boss / roamer fights, which never carry an encounter. */
  encounterId: string | null;
  /** Monster ids in the combat roster — legacy `monster_id` match. */
  monsters: ReadonlyArray<string>;
}

/** One step credit produced by {@link creditKillSteps} — enough for
 *  the host to fire the same placard + log feedback the kernel's
 *  `quest_kill_credited` event drives. */
export interface KillStepCredit {
  questId: string;
  questName: string;
  stepId: string;
  stepName: string;
  killsSoFar: number;
  count: number;
  /** True when this credit reached `count` and flipped the step. */
  stepCompleted: boolean;
  /** True when flipping this step completed the quest's last
   *  outstanding step (drive the "Return to {giver}" placard). */
  questCompleted: boolean;
}

export interface KillCreditResult {
  /** Updated copies of the progress fields (always fresh objects;
   *  equal-valued when `credited` is empty). */
  questStepProgress: Record<string, number>;
  questStepsDone: Record<string, ReadonlyArray<string>>;
  questStepKills: Record<string, Record<string, number>>;
  /** Every step this combat credited, partial or completing. */
  credited: KillStepCredit[];
  changed: boolean;
}

/** Id minted by the kernel's quest spawn pass —
 *  `q-<questId>-<stepIdx>-<n>`. Fights resolving one of these are
 *  credited by the kernel (via `quest_kill_credited`); the host path
 *  must skip them or the kill counts double. */
export function isKernelQuestKill(
  placedEncounterId: string | null | undefined,
): boolean {
  return !!placedEncounterId && /^q-.+-\d+-\d+$/.test(placedEncounterId);
}

function coerceCount(v: number | string | undefined): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && v.trim().length > 0) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Walk every accepted (not turned-in) quest and credit EVERY
 * incomplete kill step the just-resolved combat satisfies — order
 * independent, location pinned, count honoured.
 *
 * A step is credited when ALL of:
 *   - its `kind` is "kill" and it isn't already complete;
 *   - the combat matches — the step's `encounter_id` equals the
 *     cleared encounter's id, OR (legacy) `params.monster_id` is in
 *     the combat roster;
 *   - its location matches: `dungeon_id` steps need the matching
 *     dungeon (+ floor when `dungeon_level` is set); `map_id` steps
 *     need the party on that map and NOT in a dungeon; a step with
 *     neither credits anywhere.
 *
 * Each credit increments the persisted counter; the step only flips
 * complete when the counter reaches the authored `count` (default 1).
 */
export function creditKillSteps(
  fields: KillCreditFields,
  combat: KillCombatInfo | null,
  dungeon: { dungeonId: string; floorIdx: number } | null,
  quests: ReadonlyArray<RawQuestWithSteps>,
  currentMapId: string | null,
): KillCreditResult {
  let progress: QuestProgressFields = {
    questStepProgress: { ...(fields.questStepProgress ?? {}) },
    questStepsDone: { ...(fields.questStepsDone ?? {}) },
  };
  const kills: Record<string, Record<string, number>> = Object.fromEntries(
    Object.entries(fields.questStepKills ?? {}).map(([q, m]) => [
      q,
      { ...m },
    ]),
  );
  const result = (credited: KillStepCredit[], changed: boolean) => ({
    questStepProgress: progress.questStepProgress ?? {},
    questStepsDone: progress.questStepsDone ?? {},
    questStepKills: kills,
    credited,
    changed,
  });

  if (!combat || (!combat.encounterId && combat.monsters.length === 0)) {
    return result([], false);
  }
  const accepted = fields.acceptedQuests ?? [];
  if (accepted.length === 0) return result([], false);
  const turnedIn = new Set(fields.turnedInQuests ?? []);
  const monsterIdsInCombat = new Set(combat.monsters);
  const byId = new Map(quests.map((q) => [q.id, q]));

  const credited: KillStepCredit[] = [];
  let changed = false;

  for (const questId of accepted) {
    if (turnedIn.has(questId)) continue;
    const quest = byId.get(questId);
    if (!quest) continue;
    const steps = quest.steps ?? [];
    const def = {
      id: questId,
      steps: steps.map((s, i) => ({ id: s.id || `__idx_${i}` })),
    };
    const done = completedStepIds(progress, def);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepId = step.id || `__idx_${i}`;
      if (step.kind !== "kill") continue;
      if (done.has(stepId)) continue;

      // Combat match — encounter id (preferred) OR monster id (legacy).
      const stepEncounterId =
        step.encounter_id || step.params?.encounter_id || "";
      const encounterMatch =
        !!stepEncounterId &&
        combat.encounterId !== null &&
        stepEncounterId === combat.encounterId;
      const monsterMatch =
        !!step.params?.monster_id &&
        monsterIdsInCombat.has(step.params.monster_id);
      if (!encounterMatch && !monsterMatch) continue;

      // Location match.
      if (step.dungeon_id) {
        if (!dungeon || dungeon.dungeonId !== step.dungeon_id) continue;
        if (typeof step.dungeon_level === "number") {
          const expectedFloorIdx = Math.max(0, step.dungeon_level - 1);
          if (dungeon.floorIdx !== expectedFloorIdx) continue;
        }
      } else if (step.map_id) {
        // Map-pinned: only credit when standing on that map (and NOT
        // inside a dungeon, whose synthetic map id won't match).
        if (dungeon) continue;
        if (currentMapId !== step.map_id) continue;
      }

      // Count the kill; only completion marks the step done.
      const count = Math.max(
        1,
        coerceCount(step.count) ?? coerceCount(step.params?.count ?? undefined) ?? 1,
      );
      const perQuest = (kills[questId] = kills[questId] ?? {});
      const killsSoFar = (perQuest[stepId] ?? 0) + 1;
      perQuest[stepId] = killsSoFar;
      changed = true;

      let stepCompleted = false;
      let questCompleted = false;
      if (killsSoFar >= count) {
        const res = markStepDone(progress, def, stepId);
        progress = {
          questStepProgress: res.questStepProgress,
          questStepsDone: res.questStepsDone,
        };
        stepCompleted = res.changed;
        questCompleted = res.questNowComplete;
      }
      credited.push({
        questId,
        questName: quest.name ?? questId,
        stepId,
        stepName: step.name ?? stepId,
        killsSoFar,
        count,
        stepCompleted,
        questCompleted,
      });
    }
  }

  return result(credited, changed);
}
