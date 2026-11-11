/**
 * Game-clock stamps for the exploration log. PlayHost keeps its log as
 * a plain string buffer (appended at many call sites, trimmed from the
 * front at MAX_LOG), so the side-panel Log works out which lines are
 * new on each update and stamps them with the clock at that moment —
 * no change to how anything writes to the log.
 */

/** How many entries at the front of `prev` were trimmed to make `next`,
 *  i.e. the smallest shift where prev's tail lines up with next's head.
 *  Returns null when the two don't line up at all (log was replaced,
 *  e.g. a save loaded). */
export function trimmedShift(
  prev: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
): number | null {
  for (let s = 0; s <= prev.length; s++) {
    const overlap = prev.length - s;
    if (overlap > next.length) continue;
    let ok = true;
    for (let i = 0; i < overlap; i++) {
      if (prev[i + s] !== next[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return s;
  }
  return null;
}

/** Per-line metadata for `next`, carrying over what lines already seen
 *  in `prev` had and calling `fresh()` for every line that's new. */
export function carryLog<T>(
  prev: ReadonlyArray<string>,
  prevMeta: ReadonlyArray<T>,
  next: ReadonlyArray<string>,
  fresh: () => T,
): T[] {
  if (prev === next) return [...prevMeta];
  const shift = trimmedShift(prev, next);
  if (shift !== null && (shift < prev.length || prev.length === 0)) {
    const kept = prevMeta.slice(shift);
    return next.map((_, i) => (i < kept.length ? kept[i] : fresh()));
  }
  // No clean "trimmed + appended" fit — e.g. the buffer was rewound to
  // an older copy (missing its newest lines) and then appended to.
  // Keep the meta of the longest run of `next`'s head that already
  // appeared in `prev`, so old lines aren't treated as new (re-stamped,
  // re-chimed); only what follows that run is fresh.
  let bestS = -1;
  let bestLen = 0;
  for (let s = 0; s < prev.length; s++) {
    let len = 0;
    while (s + len < prev.length && len < next.length && prev[s + len] === next[len]) len++;
    if (len > bestLen) {
      bestLen = len;
      bestS = s;
    }
  }
  if (bestLen === 0) return next.map(() => fresh());
  return next.map((_, i) => (i < bestLen ? prevMeta[bestS + i] : fresh()));
}

/** Stamps for `next`, carrying over the stamps of lines already seen in
 *  `prev` and giving `now` to every line that's new. */
export function stampLog(
  prev: ReadonlyArray<string>,
  prevStamps: ReadonlyArray<number>,
  next: ReadonlyArray<string>,
  now: number,
): number[] {
  return carryLog(prev, prevStamps, next, () => now);
}

/** What kind of notable event a log line records. */
export type LogCategory =
  | "xp"
  | "quest"
  | "find"
  | "combat"
  | "trap"
  | "lock"
  | "loot"
  | "story";

/**
 * Allow-list of notable log lines — the data points worth keeping in the
 * side-panel Log and the Adventure Log (experience, level-ups, quests,
 * things found or picked up, fights, traps, lock attempts) plus the
 * module's authored Log Events. Everything else the game
 * writes to the log is moment-to-moment feedback — monster spawns, map
 * links, "Edge of the map.", blocked moves, waiting, torches, boats,
 * on-step tile text — and stays only in the bottom strip on the map.
 *
 * To surface a new kind of message, add a pattern here.
 */
const NOTABLE: ReadonlyArray<[LogCategory, RegExp]> = [
  // Experience + level-ups ("Met X — +25 XP.", "Discovered Y — +50 XP.").
  ["xp", /\+\d+ XP\b/],
  ["xp", /\breached Level \d+/],
  // Quests.
  ["quest", /^Quest complete\b/],
  ["quest", /^Step complete:/],
  ["quest", /^Step reward:/],
  ["quest", /^Spelunking:/],
  ["quest", /\(\d+\/\d+\)\.?$/], // kill progress "Wolf (2/5)."
  // Reagents and other finds.
  ["find", / spots an? .+ in the brush\.$/],
  // Fights started and won.
  ["combat", /^Defeated an? /],
  ["combat", / defeated\.$/],
  ["combat", /lair falls silent/],
  ["combat", / ambushes the party!$/],
  ["combat", /^A roaming .+ catches up!$/],
  ["combat", /^Approach Lair:/],
  // Traps.
  ["trap", /^Trap! /],
  // Lock attempts (rolls included) and keys.
  ["lock", /\(d20:\d+/],
  ["lock", / turns in the lock\b/],
  // Items picked up and chests opened.
  ["loot", /^Picked up /],
  ["loot", /^Opened .+(: |— it's empty\.$)/],
  // Pickpocketing.
  ["loot", / pilfers \d+ gold\.$/],
  ["loot", / swipes an? /],
];

/** Category of a notable line, or null for routine feedback.
 *  `storyLines` are the module's authored Log Event texts — always
 *  notable, as "story". */
export function notableCategory(
  message: string,
  storyLines?: ReadonlySet<string>,
): LogCategory | null {
  if (storyLines?.has(message)) return "story";
  for (const [cat, re] of NOTABLE) if (re.test(message)) return cat;
  return null;
}
