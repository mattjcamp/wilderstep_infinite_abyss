/**
 * Detect Traps — an Intelligence save, rolled when a hidden trap comes
 * into a character's line of sight.
 *
 * Passive — there's nothing to switch on. Every living member
 * whose class grants the `detect_traps` ability (at or above its
 * `min_level`) rolls d20 + INT modifier against the trap's detection DC
 * the moment the trap enters the party's line of sight. Any success
 * spots it. A failed trap stays hidden; it gets another roll the next
 * time it comes back into view (not on every step it stays in view).
 *
 * Only characters with the ability can roll; with nobody in the roster
 * holding it, detection is off (`partyHasDetectTraps`).
 *
 * DC: the trap record's `params.detect_dc`, else TRAP_DETECT_DC.
 * Pure — the host (PlayHost) owns visibility, rendering and sound.
 */

import { statMod } from "@/battle/world/PartyActions";

export const TRAP_DETECT_DC = 12;
export const DETECT_TRAPS_ABILITY = "detect_traps";

export interface TrapDetector {
  id: string;
  name: string;
  intelligence: number;
}

/** Minimal member / record / class shapes this module reads. */
export interface DetectorMember {
  id: string;
  hp: number;
  level?: number;
  custom?: unknown;
}
export interface DetectorCharacter {
  id: string;
  name?: string;
  class?: string;
  level?: number;
  intelligence?: number;
}
export interface DetectorClass {
  id: string;
  name?: string;
  abilities?: ReadonlyArray<{ ability_id: string; min_level?: number }>;
}

function classIndex(classes: ReadonlyArray<DetectorClass>): Map<string, DetectorClass> {
  const byKey = new Map<string, DetectorClass>();
  for (const k of classes) {
    byKey.set(k.id.toLowerCase(), k);
    if (k.name) byKey.set(k.name.toLowerCase(), k);
  }
  return byKey;
}

function hasDetectAbility(
  m: DetectorMember,
  rec: DetectorCharacter,
  classByKey: Map<string, DetectorClass>,
): boolean {
  const level = m.level ?? rec.level ?? 1;
  const cls = classByKey.get((rec.class ?? "").toLowerCase());
  return !!cls?.abilities?.some(
    (a) => a.ability_id === DETECT_TRAPS_ABILITY && level >= (a.min_level ?? 1),
  );
}

/** True when any roster member (alive or not) has Detect Traps — the
 *  condition for detection (and spotted-trap markers) to be on. */
export function partyHasDetectTraps(
  members: ReadonlyArray<DetectorMember>,
  characters: ReadonlyArray<DetectorCharacter>,
  classes: ReadonlyArray<DetectorClass>,
): boolean {
  const charById = new Map(characters.map((c) => [c.id, c] as const));
  const classByKey = classIndex(classes);
  return members.some((m) =>
    hasDetectAbility(
      m,
      (charById.get(m.id) ?? (m.custom as DetectorCharacter | null) ?? {}) as DetectorCharacter,
      classByKey,
    ),
  );
}

/** Living members with the Detect Traps ability — the ones who roll. */
export function trapDetectors(
  members: ReadonlyArray<DetectorMember>,
  characters: ReadonlyArray<DetectorCharacter>,
  classes: ReadonlyArray<DetectorClass>,
): TrapDetector[] {
  const charById = new Map(characters.map((c) => [c.id, c] as const));
  const classByKey = classIndex(classes);
  const out: TrapDetector[] = [];
  for (const m of members) {
    if (m.hp <= 0) continue;
    const rec = (charById.get(m.id) ?? (m.custom as DetectorCharacter | null) ?? {}) as DetectorCharacter;
    if (!hasDetectAbility(m, rec, classByKey)) continue;
    out.push({
      id: m.id,
      name: rec.name ?? m.id,
      intelligence: typeof rec.intelligence === "number" ? rec.intelligence : 10,
    });
  }
  return out;
}

export interface TrapDetectionRoll {
  detector: TrapDetector;
  roll: number;
  mod: number;
  total: number;
  dc: number;
}

export interface TrapDetectionResult {
  detected: boolean;
  /** The spotter on success; the best (failed) attempt otherwise.
   *  Null when nobody could roll. */
  best: TrapDetectionRoll | null;
}

/** Each detector rolls d20 + INT mod vs `dc`; any success spots it. */
export function rollTrapDetection(
  detectors: ReadonlyArray<TrapDetector>,
  dc: number,
  rng: () => number = Math.random,
): TrapDetectionResult {
  let best: TrapDetectionRoll | null = null;
  for (const d of detectors) {
    const roll = 1 + Math.floor(rng() * 20);
    const mod = statMod(d.intelligence);
    const attempt = { detector: d, roll, mod, total: roll + mod, dc };
    if (attempt.total >= dc) return { detected: true, best: attempt };
    if (!best || attempt.total > best.total) best = attempt;
  }
  return { detected: false, best };
}

/** Detection DC for a trap record (`params.detect_dc`, else default). */
export function trapDetectDc(record: { params?: unknown } | null | undefined): number {
  const v = (record?.params as { detect_dc?: unknown } | null | undefined)?.detect_dc;
  return typeof v === "number" && Number.isFinite(v) ? v : TRAP_DETECT_DC;
}

/** Armed, still-undetected traps that just came into view: in `visible`
 *  now, not in view last time (`wasInView`), not already `known`. */
export function trapsEnteringView(
  liveTraps: ReadonlySet<string>,
  visible: ReadonlySet<string>,
  wasInView: ReadonlySet<string>,
  known: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const key of liveTraps) {
    if (visible.has(key) && !wasInView.has(key) && !known.has(key)) out.push(key);
  }
  return out;
}
