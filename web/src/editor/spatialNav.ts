/**
 * Spatial keyboard navigation: given where focus is now and the boxes
 * of every other control, pick the one an arrow key should move to.
 *
 * Works on any layout (rows of cards, wrapped grids, stacked rows of
 * −/+ buttons) without per-screen wiring, which is why the character
 * creator uses it for all six of its steps.
 *
 * A candidate must lie in the pressed direction (its near edge past
 * the current box's centre); left / right also stay within the current
 * row (some vertical overlap), so they never jump to another line. Among those, the winner minimises
 *   gap along the direction + 2 × offset across it
 * so the nearest control roughly in line wins over a closer one far to
 * the side. Pure — callers pass DOMRect-like boxes.
 */

export type NavDir = "up" | "down" | "left" | "right";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function pickSpatial(
  from: Box,
  candidates: ReadonlyArray<Box>,
  dir: NavDir,
): number {
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((b, i) => {
    const bx = (b.left + b.right) / 2;
    const by = (b.top + b.bottom) / 2;
    let along: number;
    let across: number;
    if (dir === "down") {
      if (b.top < cy + 1 || by <= cy) return;
      along = Math.max(0, b.top - from.bottom);
      across = overlapGap(from.left, from.right, b.left, b.right, cx, bx);
    } else if (dir === "up") {
      if (b.bottom > cy - 1 || by >= cy) return;
      along = Math.max(0, from.top - b.bottom);
      across = overlapGap(from.left, from.right, b.left, b.right, cx, bx);
    } else if (dir === "right") {
      if (b.left < cx + 1 || bx <= cx) return;
      if (b.bottom <= from.top || b.top >= from.bottom) return; // same row only
      along = Math.max(0, b.left - from.right);
      across = overlapGap(from.top, from.bottom, b.top, b.bottom, cy, by);
    } else {
      if (b.right > cx - 1 || bx >= cx) return;
      if (b.bottom <= from.top || b.top >= from.bottom) return; // same row only
      along = Math.max(0, from.left - b.right);
      across = overlapGap(from.top, from.bottom, b.top, b.bottom, cy, by);
    }
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Sideways distance between two spans: 0 when they overlap enough
 *  that either centre falls inside the other, else the centre gap. */
function overlapGap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  ac: number,
  bc: number,
): number {
  if ((bc >= a0 && bc <= a1) || (ac >= b0 && ac <= b1)) return 0;
  return Math.abs(ac - bc);
}

/** Map a key to a direction. WASD only when `letters` is true (i.e.
 *  focus is not in a text field). */
export function keyToDir(key: string, letters: boolean): NavDir | null {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
  }
  if (!letters) return null;
  switch (key) {
    case "w":
    case "W":
      return "up";
    case "s":
    case "S":
      return "down";
    case "a":
    case "A":
      return "left";
    case "d":
    case "D":
      return "right";
  }
  return null;
}
