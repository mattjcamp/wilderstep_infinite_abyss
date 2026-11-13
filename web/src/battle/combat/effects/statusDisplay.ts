/**
 * Status badges — one description of "what's on this character right
 * now" shared by every place an avatar shows up: the battle HUD's party
 * cards, the active-combatant portrait, the turn-start log report, the
 * inspector, and the Party screen (roster cards + character sheet).
 *
 * Pure: no Phaser, no React. Two entry points:
 *   - `statusBadgesFor(combatant)` — live battle state (effects list,
 *     turned counter). Durations are in turns.
 *   - `savedStatusBadges(effects)` — a save's `{ id, duration }[]`
 *     (statuses that outlast a battle, e.g. poison). Durations are in
 *     map steps.
 *
 * Colours match the on-arena auras (statusAuras.ts) and the floating
 * status labels, so a poisoned character is the same green everywhere.
 */

import type { Combatant } from "../../types";

export interface StatusBadge {
  /** Stable key (effect id, or `stat_modifier:<source>`). */
  key: string;
  /** Full display name — "Poisoned", "Cursed". */
  label: string;
  /** Three-letter chip text — "PSN", "CRS". */
  short: string;
  /** CSS hex colour. */
  color: string;
  /** Remaining duration, when it has one. */
  remaining?: number;
  /** Unit of `remaining`. */
  unit?: "turns" | "steps";
  /** Extra detail — "−3 AC, −3 ATK". */
  detail?: string;
  /** True for helpful effects (bless, shield…). */
  good: boolean;
}

interface StatusLook {
  label: string;
  short: string;
  color: string;
  good: boolean;
}

/** Looks for effect ids (effects.json) and named statuses. */
export const STATUS_LOOKS: Readonly<Record<string, StatusLook>> = {
  poisoned: { label: "Poisoned", short: "PSN", color: "#7be36a", good: false },
  sleep: { label: "Asleep", short: "SLP", color: "#9ec5ff", good: false },
  charm: { label: "Charmed", short: "CHM", color: "#ff8fd0", good: false },
  slowed: { label: "Slowed", short: "SLW", color: "#b8c4d6", good: false },
  consumed: { label: "Swallowed", short: "SWL", color: "#d9925f", good: false },
  turned: { label: "Turned", short: "TRN", color: "#f2e7c4", good: false },
  cursed: { label: "Cursed", short: "CRS", color: "#c58bff", good: false },
  curse: { label: "Cursed", short: "CRS", color: "#c58bff", good: false },
  blessed: { label: "Blessed", short: "BLS", color: "#ffd75e", good: true },
  bless: { label: "Blessed", short: "BLS", color: "#ffd75e", good: true },
};

/** Looks for stat_modifier buffs, by their `source` tag. */
const BUFF_SOURCE_LOOKS: Readonly<Record<string, StatusLook>> = {
  curse: STATUS_LOOKS.cursed,
  bless: STATUS_LOOKS.blessed,
  shield: { label: "Shielded", short: "SHD", color: "#a8d8ff", good: true },
  invisibility: { label: "Invisible", short: "INV", color: "#d6d6ff", good: true },
  "long shanks": { label: "Long Shanks", short: "HST", color: "#8de0a0", good: true },
};

const BUFF_KIND: Readonly<Record<string, { sign: string; stat: string; bad: boolean }>> = {
  attack_bonus: { sign: "+", stat: "ATK", bad: false },
  attack_penalty: { sign: "−", stat: "ATK", bad: true },
  ac_bonus: { sign: "+", stat: "AC", bad: false },
  ac_penalty: { sign: "−", stat: "AC", bad: true },
  damage_bonus: { sign: "+", stat: "DMG", bad: false },
  range_bonus: { sign: "+", stat: "RNG", bad: false },
};

function titleize(id: string): string {
  return id
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function lookFor(id: string, good = false): StatusLook {
  return (
    STATUS_LOOKS[id] ?? {
      label: titleize(id),
      short: id.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "FX",
      color: good ? "#9be39b" : "#e8c99a",
      good,
    }
  );
}

/** Statuses on a combatant right now, in a stable display order. */
export function statusBadgesFor(c: Combatant): StatusBadge[] {
  const out: StatusBadge[] = [];
  const buffs = new Map<string, { look: StatusLook; mods: string[]; remaining?: number; source: string }>();

  for (const e of c.effects ?? []) {
    if (e.effectId === "stat_modifier") {
      const source = String(e.state.source ?? "Buff");
      const kind = String(e.params.kind ?? "");
      const spec = BUFF_KIND[kind];
      const value = Math.abs(num(e.params.value) ?? 0);
      const left = num(e.state.turnsLeft);
      const key = source.toLowerCase();
      const entry =
        buffs.get(key) ??
        {
          look:
            BUFF_SOURCE_LOOKS[key] ??
            (() => {
              const l = lookFor(key.replace(/\s+/g, "_"), !spec?.bad);
              return { ...l, label: source };
            })(),
          mods: [],
          source,
        };
      if (spec && value) entry.mods.push(`${spec.sign}${value} ${spec.stat}`);
      if (left !== undefined) {
        entry.remaining = entry.remaining === undefined ? left : Math.min(entry.remaining, left);
      }
      buffs.set(key, entry);
      continue;
    }
    const look = lookFor(e.effectId);
    const left = num(e.state.turnsLeft);
    if (out.some((b) => b.key === e.effectId)) continue;
    out.push({
      key: e.effectId,
      ...look,
      remaining: left,
      unit: left !== undefined ? "turns" : undefined,
    });
  }

  for (const [key, b] of buffs) {
    out.push({
      key: `stat_modifier:${key}`,
      ...b.look,
      remaining: b.remaining,
      unit: b.remaining !== undefined ? "turns" : undefined,
      detail: b.mods.length ? b.mods.join(", ") : undefined,
    });
  }

  if ((c.turnedTurns ?? 0) > 0) {
    out.push({ key: "turned", ...STATUS_LOOKS.turned, remaining: c.turnedTurns, unit: "turns" });
  }

  // Harmful first, then helpful; otherwise keep application order.
  return out.sort((a, b) => Number(a.good) - Number(b.good));
}

/** Badges for a save's carried statuses (`{ id, duration }`). */
export function savedStatusBadges(
  effects: ReadonlyArray<{ id: string; duration: unknown }> | undefined,
): StatusBadge[] {
  return (effects ?? []).map((e) => {
    const look = lookFor(e.id);
    const d = num(e.duration);
    return {
      key: e.id,
      ...look,
      remaining: d,
      unit: d !== undefined ? ("steps" as const) : undefined,
      detail: e.duration === "permanent" ? "permanent" : undefined,
    };
  });
}

/** "Poisoned (3 turns)", "Cursed −3 AC, −3 ATK (2 turns)". */
export function describeStatus(b: StatusBadge): string {
  const detail = b.detail && b.detail !== "permanent" ? ` ${b.detail}` : "";
  const time =
    b.remaining !== undefined && b.unit
      ? ` (${b.remaining} ${b.remaining === 1 ? b.unit.slice(0, -1) : b.unit})`
      : b.detail === "permanent"
        ? " (permanent)"
        : "";
  return `${b.label}${detail}${time}`;
}

/** Chip text — "PSN 3". */
export function badgeChipText(b: StatusBadge): string {
  return b.remaining !== undefined ? `${b.short} ${b.remaining}` : b.short;
}
