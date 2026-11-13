"use client";

/**
 * Status display for the Party screen — the same badges (label, colour,
 * three-letter chip) the battle HUD uses, from
 * battle/combat/effects/statusDisplay.ts, so a poisoned character looks
 * the same in a fight and on the roster.
 *
 *   <StatusPills effects={member.effects} />   colour-coded pills
 *   <StatusAvatarDots effects={member.effects} />  dots on an avatar
 */

import {
  describeStatus,
  savedStatusBadges,
  type StatusBadge,
} from "@/battle/combat/effects/statusDisplay";

type SavedEffects = ReadonlyArray<{ id: string; duration: unknown }> | undefined;

function Pill({ b, size }: { b: StatusBadge; size: "sm" | "md" }) {
  return (
    <span
      className={`rounded border bg-ink/60 font-mono uppercase tracking-wider ${
        size === "sm" ? "px-1.5 py-px text-[9px]" : "px-1.5 py-0.5 text-xs"
      }`}
      style={{ borderColor: `${b.color}99`, color: b.color }}
      title={describeStatus(b)}
    >
      {b.label}
      {b.remaining !== undefined ? (
        <span className="ml-1 opacity-80">
          {b.remaining}
          {b.unit === "steps" ? " steps" : b.unit === "turns" ? "t" : ""}
        </span>
      ) : b.detail === "permanent" ? (
        <span className="ml-1 opacity-80">∞</span>
      ) : null}
    </span>
  );
}

/** Colour-coded status pills. Renders nothing when there are none. */
export function StatusPills({
  effects,
  size = "sm",
}: {
  effects: SavedEffects;
  size?: "sm" | "md";
}) {
  const badges = savedStatusBadges(effects);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((b) => (
        <Pill key={b.key} b={b} size={size} />
      ))}
    </>
  );
}

/** Small coloured dots for the corner of an avatar — one per status
 *  (up to three). Place inside a `relative` wrapper. */
export function StatusAvatarDots({ effects }: { effects: SavedEffects }) {
  const badges = savedStatusBadges(effects);
  if (badges.length === 0) return null;
  return (
    <span
      className="pointer-events-none absolute -bottom-1 -right-1 flex gap-px"
      title={badges.map(describeStatus).join(", ")}
    >
      {badges.slice(0, 3).map((b) => (
        <span
          key={b.key}
          className="block h-2.5 w-2.5 rounded-full border border-ink"
          style={{ backgroundColor: b.color }}
        />
      ))}
    </span>
  );
}
