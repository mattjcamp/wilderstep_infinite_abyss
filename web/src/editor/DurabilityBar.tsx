"use client";

/**
 * Tiny progress bar that visualises an item's remaining durability.
 *
 * Used in three places today:
 *   - the shared-stash inventory list (PartyScreen),
 *   - each character's personal inventory list (CharacterSheetSim),
 *   - the equipped-slots panel (CharacterSheetSim) — the value there
 *     reads from the saved `equipped_durability` map rather than an
 *     inventory entry's `durability`, but the rendering is identical.
 *
 * Colour shifts as the bar drains: green > 60 %, amber 30–60 %, rose
 * < 30 %, so a glance is enough to spot worn-out gear. The numeric
 * `current/max` lives in the `title` so a hover gives the exact
 * value. Indestructible / unknown items render nothing — the gating
 * lives on the caller (only paint when the catalog's max > 0).
 */

interface DurabilityBarProps {
  /** Remaining durability — clamped to `[0, max]` internally so a
   *  stale save with a negative or over-max value still renders
   *  sensibly. */
  current: number;
  /** Catalog's max durability. Caller is expected to have already
   *  confirmed this is > 0; the component still defends against a
   *  zero or negative max to avoid a divide-by-zero. */
  max: number;
}

export function DurabilityBar({ current, max }: DurabilityBarProps): JSX.Element | null {
  if (!(max > 0)) return null;
  const clamped = Math.max(0, Math.min(max, current));
  const pct = clamped / max;
  // Green when healthy, amber as it bites into the second half, rose
  // when nearly broken. Threshold values picked to mirror v1's
  // colour-grade so the player's intuition carries across.
  const fillClass =
    pct > 0.6
      ? "bg-emerald-500"
      : pct > 0.3
        ? "bg-amber-400"
        : "bg-rose-500";
  return (
    <span
      className="inline-block h-1 w-12 shrink-0 overflow-hidden rounded border border-parchment/25 bg-ink/70 align-middle"
      title={`Durability ${clamped}/${max}`}
      role="img"
      aria-label={`Durability ${clamped} of ${max}`}
    >
      <span
        className={`block h-full ${fillClass}`}
        style={{ width: `${pct * 100}%` }}
      />
    </span>
  );
}
