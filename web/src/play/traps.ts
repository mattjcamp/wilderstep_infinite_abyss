/**
 * Trap resolution — pure helpers between the kernel's
 * `trap_triggered` event and the host's save mutation.
 *
 * The kernel signals "a trap fired at (col,row) with record id X (or
 * null for a legacy boolean trap)". This module owns everything
 * data-driven about what happens next:
 *
 *   - `resolveTrapRecord` maps the event's trapId to a traps.json
 *     record (null → the default `dart_trap`, covering legacy
 *     boolean cells and procedural dungeon traps).
 *   - `resolveTrapOutcome` rolls the record against the alive party:
 *     target selection (`params.targets`: one random / all), the
 *     optional d20 + stat-modifier save (`params.save_stat` +
 *     `save_dc`; pass = half damage, no effect), the damage roll
 *     (`damage_range`, uniform), the rider `effect`, and the
 *     `teleport` destination. Returns per-victim hits + ready-made
 *     log lines; the HOST applies them (hp mutation, effect append
 *     with catalog duration, sim.teleport / link traversal, VFX).
 *
 * Misauthored records degrade to a "fizzle" outcome (a log line,
 * nothing else) — a broken trap must never crash the step pipeline.
 *
 * Pure + rng-injectable for tests.
 */

/** traps.json record shape (loose — authored JSON). */
export interface TrapRecord {
  id: string;
  name?: string;
  description?: string;
  /** "damage" | "effect" | "teleport" — resolution branch. */
  trap_type?: string;
  /** Flavour + VFX driver ("fire", "poison", "piercing", "magic"). */
  damage_type?: string;
  damage_range?: { min?: number; max?: number } | null;
  /** effects.json id applied to victims that fail the save. */
  effect?: string | null;
  params?: Record<string, unknown> | null;
}

/** Record id legacy boolean traps (and procedural dungeon traps)
 *  resolve to. Ships in the default module's traps.json with the
 *  original 3+d6 (4–9) damage so old content plays identically. */
export const DEFAULT_TRAP_ID = "dart_trap";

/** One alive party member as the roller sees it. `index` is the
 *  member's position in `save.party.members` so the host can apply
 *  hits back. `stats` are ability scores for the save roll (absent
 *  scores roll with a +0 modifier). */
export interface TrapVictim {
  index: number;
  id: string;
  name?: string;
  hp: number;
  stats?: Record<string, number | undefined>;
}

export interface TrapHit {
  index: number;
  damage: number;
  saved: boolean;
  /** effects.json id to apply, or null (saved, or trap has none). */
  effect: string | null;
}

export interface TrapOutcome {
  kind: "damage" | "effect" | "teleport" | "fizzle";
  /** Per-victim results. Empty for teleport / fizzle. */
  hits: TrapHit[];
  /** Destination for `kind: "teleport"`. */
  teleport: { map_id: string; col: number; row: number } | null;
  /** Ready-made adventure-log lines, in display order. */
  lines: string[];
}

/** Map the kernel event's trapId to a catalog record. Null trapId
 *  (legacy boolean trap) resolves to {@link DEFAULT_TRAP_ID}.
 *  Returns null when the catalog has no matching record — the host
 *  falls back to the original hardcoded roll so a module without a
 *  traps.json keeps its dungeon traps working. */
export function resolveTrapRecord(
  traps: ReadonlyArray<TrapRecord>,
  trapId: string | null | undefined,
): TrapRecord | null {
  const id = trapId ?? DEFAULT_TRAP_ID;
  return traps.find((t) => t.id === id) ?? null;
}

/** d20 ability modifier — same convention as the lock-pick and
 *  leveling math (`Math.floor((score - 10) / 2)`). */
function statModifier(score: number | undefined): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return 0;
  return Math.floor((score - 10) / 2);
}

function displayName(v: TrapVictim): string {
  return v.name || v.id;
}

/** Uniform integer in [min, max] via the injected rng. */
function rollRange(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Roll `trap` against the alive party. See module docs for the
 *  semantics. `victims` should be ALIVE members only — the caller
 *  filters, matching the legacy handler's behaviour. */
export function resolveTrapOutcome(
  trap: TrapRecord,
  victims: ReadonlyArray<TrapVictim>,
  rng: () => number = Math.random,
): TrapOutcome {
  const trapName = trap.name || trap.id;
  const fizzle = (why: string): TrapOutcome => ({
    kind: "fizzle",
    hits: [],
    teleport: null,
    lines: [`${trapName} sputters and fails. (${why})`],
  });

  const params = trap.params ?? {};
  const type = trap.trap_type ?? "damage";

  // ── Teleport ─────────────────────────────────────────────────────
  if (type === "teleport") {
    const t = params["teleport"] as
      | { map_id?: unknown; col?: unknown; row?: unknown }
      | undefined;
    if (
      !t ||
      typeof t.map_id !== "string" ||
      t.map_id.length === 0 ||
      !Number.isFinite(t.col) ||
      !Number.isFinite(t.row)
    ) {
      return fizzle("no destination");
    }
    return {
      kind: "teleport",
      hits: [],
      teleport: {
        map_id: t.map_id,
        col: t.col as number,
        row: t.row as number,
      },
      lines: [
        `${trapName}! The world lurches — the party is hurled elsewhere.`,
      ],
    };
  }

  if (victims.length === 0) return fizzle("no one to harm");

  // ── Target selection ─────────────────────────────────────────────
  const targets =
    params["targets"] === "all"
      ? [...victims]
      : [victims[Math.floor(rng() * victims.length)]];

  // ── Save roll setup ──────────────────────────────────────────────
  const saveStat =
    typeof params["save_stat"] === "string" && params["save_stat"].length > 0
      ? (params["save_stat"] as string)
      : null;
  const saveDc =
    typeof params["save_dc"] === "number" &&
    Number.isFinite(params["save_dc"])
      ? (params["save_dc"] as number)
      : null;
  const hasSave = saveStat !== null && saveDc !== null;
  const rollSave = (v: TrapVictim): boolean => {
    if (!hasSave) return false;
    const roll = 1 + Math.floor(rng() * 20);
    return roll + statModifier(v.stats?.[saveStat!]) >= saveDc!;
  };

  // ── Damage range (damage traps only) ─────────────────────────────
  const range = trap.damage_range;
  const min = range?.min;
  const max = range?.max;
  const rangeValid =
    typeof min === "number" &&
    typeof max === "number" &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    min >= 0 &&
    max >= min;

  if (type === "damage" && !rangeValid) return fizzle("no damage authored");
  if (type === "effect" && !trap.effect) return fizzle("no effect authored");
  if (type !== "damage" && type !== "effect") {
    return fizzle(`unknown type "${type}"`);
  }

  // ── Resolve per victim ───────────────────────────────────────────
  const dmgWord = trap.damage_type ? `${trap.damage_type} damage` : "damage";
  const hits: TrapHit[] = [];
  const lines: string[] = [];
  for (const v of targets) {
    const saved = rollSave(v);
    const effect = saved ? null : trap.effect ?? null;
    let damage = 0;
    if (type === "damage") {
      damage = rollRange(min as number, max as number, rng);
      if (saved) damage = Math.floor(damage / 2);
    }
    hits.push({ index: v.index, damage, saved, effect });

    const name = displayName(v);
    if (type === "damage") {
      lines.push(
        saved
          ? `${trapName}! ${name} twists aside — ${damage} ${dmgWord}.`
          : `${trapName}! ${name} takes ${damage} ${dmgWord}.`,
      );
    } else {
      lines.push(
        saved
          ? `${trapName}! ${name} shakes off the ${trapName.toLowerCase()}.`
          : `${trapName}! ${name} is caught by it.`,
      );
    }
    if (effect) {
      lines.push(`${name} is afflicted: ${effect.replace(/_/g, " ")}.`);
    }
  }

  return { kind: type, hits, teleport: null, lines };
}
