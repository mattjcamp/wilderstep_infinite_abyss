/**
 * Keyboard cursor for the Form Thy Party screen.
 *
 * The screen reads top-to-bottom as one list of targets:
 *
 *   Begin  →  Create  →  party rows…  →  available rows…
 *
 * The cursor is stored as (section, index) rather than a flat index so
 * it stays put sensibly when rows move between lists: adding an
 * available character keeps the cursor at the same position in the
 * Available list (now the next character), removing a party member
 * keeps it at the same party position.
 *
 * Pure — the screen owns key handling and rendering.
 */

export type PartyNavSection = "begin" | "create" | "party" | "avail";

export interface PartyNavCursor {
  section: PartyNavSection;
  index: number;
}

export interface PartyNavCounts {
  party: number;
  avail: number;
}

/** Every target in on-screen order. */
export function partyNavTargets(c: PartyNavCounts): PartyNavCursor[] {
  const out: PartyNavCursor[] = [
    { section: "begin", index: 0 },
    { section: "create", index: 0 },
  ];
  for (let i = 0; i < c.party; i++) out.push({ section: "party", index: i });
  for (let i = 0; i < c.avail; i++) out.push({ section: "avail", index: i });
  return out;
}

/** Snap a cursor onto a target that exists. A section that emptied
 *  out falls back to its neighbour: Available → last party row →
 *  Create; Party → first available row → Create. */
export function clampPartyNav(
  cur: PartyNavCursor,
  c: PartyNavCounts,
): PartyNavCursor {
  if (cur.section === "begin" || cur.section === "create") {
    return { section: cur.section, index: 0 };
  }
  if (cur.section === "avail") {
    if (c.avail > 0) {
      return { section: "avail", index: Math.min(Math.max(0, cur.index), c.avail - 1) };
    }
    if (c.party > 0) return { section: "party", index: c.party - 1 };
    return { section: "create", index: 0 };
  }
  // party
  if (c.party > 0) {
    return { section: "party", index: Math.min(Math.max(0, cur.index), c.party - 1) };
  }
  if (c.avail > 0) return { section: "avail", index: 0 };
  return { section: "create", index: 0 };
}

/** Move one target up (-1) or down (+1), clamped at the ends. */
export function stepPartyNav(
  cur: PartyNavCursor,
  dir: -1 | 1,
  c: PartyNavCounts,
): PartyNavCursor {
  const targets = partyNavTargets(c);
  const at = clampPartyNav(cur, c);
  const i = targets.findIndex(
    (t) => t.section === at.section && t.index === at.index,
  );
  const next = Math.max(0, Math.min(targets.length - 1, (i < 0 ? 0 : i) + dir));
  return targets[next];
}

/** Where the cursor starts: the first available character when there
 *  is one (adding is the usual first move), else Create. */
export function initialPartyNav(c: PartyNavCounts): PartyNavCursor {
  return c.avail > 0
    ? { section: "avail", index: 0 }
    : { section: "create", index: 0 };
}

export function samePartyNav(a: PartyNavCursor, b: PartyNavCursor): boolean {
  return a.section === b.section && a.index === b.index;
}
