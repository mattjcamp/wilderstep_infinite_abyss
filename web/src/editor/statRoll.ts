/**
 * "Roll for me" on the character creator's Distribute Stats step.
 *
 * Hands out the bonus points one at a time, each going to a stat
 * picked at random but WEIGHTED by how much that stat matters to the
 * chosen class, so a rolled Fighter leans Strength / Constitution and
 * a rolled Wizard leans Intelligence — yet two rolls of the same class
 * still differ. The player can adjust the result afterwards.
 *
 * Weights follow the game's actual rules rather than flavour:
 *   - STR  melee attack and damage
 *   - DEX  ranged attacks, initiative, Dexterity saves (Run)
 *   - CON  bonus HP every level
 *   - WIS  bonus MP every level for priest casters
 *   - INT  bonus MP every level for sorcerer casters
 *          (the Druid uses the average of WIS and INT)
 *
 * Unknown classes (a module's own) fall back to their casting type and
 * movement range. Pure + seedable for tests.
 */

export type StatKey =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom";

export const ROLL_STAT_KEYS: ReadonlyArray<StatKey> = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
];

type Weights = Record<StatKey, number>;

const w = (s: number, d: number, c: number, i: number, wi: number): Weights => ({
  strength: s,
  dexterity: d,
  constitution: c,
  intelligence: i,
  wisdom: wi,
});

/** Shipped classes — how much each stat matters (0–5). */
const CLASS_WEIGHTS: Record<string, Weights> = {
  fighter: w(5, 2, 4, 0.5, 1),
  thief: w(2, 5, 2, 1, 1),
  ranger: w(1, 5, 2, 0.5, 3),
  paladin: w(4, 1, 3, 0.5, 3.5),
  cleric: w(2, 1, 3, 0.5, 5),
  wizard: w(0.5, 2, 2, 5, 1),
  druid: w(0.5, 1, 2, 4, 4),
  alchemist: w(0.5, 3, 2, 5, 1),
};

/** Weights for a class: the table above, else derived from what the
 *  class record says about casting and movement. */
export function classStatWeights(cls: {
  id: string;
  casting_type?: ReadonlyArray<string>;
  range?: number;
}): Weights {
  const known = CLASS_WEIGHTS[cls.id];
  if (known) return known;
  const casting = (cls.casting_type ?? []).filter((t) => t && t !== "none");
  const out = w(1, 1, 2, 0.5, 0.5);
  if (casting.includes("priest")) out.wisdom = 5;
  if (casting.includes("sorcerer")) out.intelligence = 5;
  if (casting.length === 0) out.strength = 5;
  if ((cls.range ?? 0) >= 6) out.dexterity = 5;
  return out;
}

export interface RollRules {
  min: number;
  max: number;
  bonus: number;
}

/** Roll a full build: every stat starts at `min`, then `bonus` points
 *  are spent one by one. A stat's chance of getting the next point is
 *  proportional to weight^1.5, which favours the class's key stats
 *  clearly without dumping everything into one. Stats at `max` stop
 *  receiving points. Always spends exactly `bonus` points (when the
 *  caps allow it). */
export function rollStats(
  weights: Weights,
  rules: RollRules,
  rng: () => number = Math.random,
): Record<StatKey, number> {
  const out = w(rules.min, rules.min, rules.min, rules.min, rules.min);
  for (let p = 0; p < rules.bonus; p++) {
    const open = ROLL_STAT_KEYS.filter((k) => out[k] < rules.max);
    if (open.length === 0) break;
    const ws = open.map((k) => Math.pow(Math.max(0.05, weights[k]), 1.5));
    const total = ws.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let pick = open[open.length - 1];
    for (let i = 0; i < open.length; i++) {
      r -= ws[i];
      if (r < 0) {
        pick = open[i];
        break;
      }
    }
    out[pick] += 1;
  }
  return out;
}

/** The stats to badge as "key" for a class: every stat weighted 4+,
 *  topped up to two with the next-best stat when it's weighted 3+
 *  (a Paladin's Wisdom, a Ranger's Wisdom, an Alchemist's Dexterity). */
export function keyStatsFor(weights: Weights): StatKey[] {
  const ranked = [...ROLL_STAT_KEYS].sort((a, b) => weights[b] - weights[a]);
  const out = ranked.filter((k) => weights[k] >= 4);
  if (out.length < 2) {
    const next = ranked.find((k) => !out.includes(k));
    if (next && weights[next] >= 3) out.push(next);
  }
  return ROLL_STAT_KEYS.filter((k) => out.includes(k));
}
