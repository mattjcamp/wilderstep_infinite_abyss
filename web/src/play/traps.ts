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
  /** Save roll total (d20 + modifier) when the trap allows a save. */
  saveTotal?: number;
}

export interface TrapOutcome {
  kind: "damage" | "effect" | "teleport" | "fizzle";
  /** Per-victim results. Empty for teleport / fizzle. */
  hits: TrapHit[];
  /** Destination for `kind: "teleport"`. */
  teleport: { map_id: string; col: number; row: number } | null;
  /** Teleport trap with no authored destination: the host flings the
   *  party to a random reachable cell on the current map. */
  randomTeleport?: boolean;
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
      // No destination authored: a random jump somewhere reachable on
      // the current map (the host picks the cell).
      return {
        kind: "teleport",
        hits: [],
        teleport: null,
        randomTeleport: true,
        lines: [
          `${trapName}! The world lurches — the party is flung somewhere else nearby.`,
        ],
      };
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
  const rollSave = (v: TrapVictim): { saved: boolean; total?: number } => {
    if (!hasSave) return { saved: false };
    const roll = 1 + Math.floor(rng() * 20);
    const total = roll + statModifier(v.stats?.[saveStat!]);
    return { saved: total >= saveDc!, total };
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
    const { saved, total } = rollSave(v);
    const effect = saved ? null : trap.effect ?? null;
    let damage = 0;
    if (type === "damage") {
      damage = rollRange(min as number, max as number, rng);
      if (saved) damage = Math.floor(damage / 2);
    }
    hits.push({
      index: v.index,
      damage,
      saved,
      effect,
      ...(total !== undefined ? { saveTotal: total } : {}),
    });

    const name = displayName(v);
    const hpAfter = Math.max(0, v.hp - damage);
    const saveNote =
      total !== undefined
        ? ` (${saveStat} save ${total} vs DC ${saveDc})`
        : "";
    if (type === "damage") {
      lines.push(
        saved
          ? `${trapName}! ${name} twists aside${saveNote} — ${damage} ${dmgWord} (HP ${v.hp} → ${hpAfter}).`
          : `${trapName}! ${name} takes ${damage} ${dmgWord}${saveNote} (HP ${v.hp} → ${hpAfter}).`,
      );
      if (damage > 0 && hpAfter === 0) lines.push(`${name} is knocked out!`);
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

// ── Trap card (the "what just happened" dialog) ──────────────────────

/** One party member's row on the trap card. */
export interface TrapCardLine {
  id: string;
  name: string;
  sprite?: string;
  /** The trap picked this member (single-target traps pick one). */
  targeted: boolean;
  damage: number;
  saved: boolean;
  saveTotal?: number;
  /** Display name of the affliction applied, or null. */
  effect: string | null;
  hp: number;
  maxHp?: number;
  /** Dropped to 0 HP by this trap. */
  knockedOut: boolean;
  /** Already down before the trap went off. */
  fallen: boolean;
}

export interface TrapCard {
  trapName: string;
  description?: string;
  damageType?: string;
  kind: TrapOutcome["kind"];
  /** Save the trap allowed, if any (e.g. dexterity vs DC 13). */
  save?: { stat: string; dc: number };
  /** One-line summary of the outcome. */
  summary: string;
  lines: TrapCardLine[];
}

interface CardMember {
  id: string;
  hp: number;
  max_hp?: number;
}

/** Build the trap card from the resolved outcome and the roster before
 *  and after the hits were applied. `info` names a member and gives its
 *  sprite; `effectName` turns an effects.json id into a display name. */
export function trapCard(
  record: TrapRecord | null,
  outcome: TrapOutcome,
  before: ReadonlyArray<CardMember>,
  after: ReadonlyArray<CardMember>,
  info: (id: string) => { name?: string; sprite?: string } | undefined,
  effectName: (id: string) => string = (id) => id.replace(/_/g, " "),
): TrapCard {
  const trapName = record ? record.name || record.id : "Trap";
  const hitByIdx = new Map(outcome.hits.map((h) => [h.index, h]));
  const lines: TrapCardLine[] = after.map((m, i) => {
    const b = before[i] ?? m;
    const h = hitByIdx.get(i);
    const meta = info(m.id);
    return {
      id: m.id,
      name: meta?.name || m.id,
      sprite: meta?.sprite,
      targeted: !!h,
      damage: h?.damage ?? 0,
      saved: h?.saved ?? false,
      ...(h?.saveTotal !== undefined ? { saveTotal: h.saveTotal } : {}),
      effect: h?.effect ? effectName(h.effect) : null,
      hp: m.hp,
      maxHp: m.max_hp,
      knockedOut: b.hp > 0 && m.hp <= 0,
      fallen: b.hp <= 0,
    };
  });

  const params = record?.params ?? {};
  const stat = params["save_stat"];
  const dc = params["save_dc"];
  const save =
    typeof stat === "string" && stat && typeof dc === "number" && Number.isFinite(dc)
      ? { stat, dc }
      : undefined;

  const dmgWord = record?.damage_type ? `${record.damage_type} damage` : "damage";
  const hit = lines.filter((l) => l.targeted);
  let summary: string;
  if (outcome.kind === "teleport" || outcome.kind === "fizzle") {
    summary = outcome.lines[0] ?? `${trapName}!`;
  } else if (hit.length === 1) {
    const l = hit[0];
    const parts: string[] = [];
    if (l.damage > 0) parts.push(`${l.damage} ${dmgWord}`);
    if (l.effect) parts.push(l.effect);
    summary =
      parts.length > 0
        ? `${l.name} was hit — ${parts.join(" and ")}.`
        : `${l.name} avoided the worst of it.`;
  } else {
    const total = hit.reduce((a, l) => a + l.damage, 0);
    summary =
      total > 0
        ? `The whole party was caught — ${total} ${dmgWord} in all.`
        : "The whole party was caught in it.";
  }
  const ko = hit.filter((l) => l.knockedOut).map((l) => l.name);
  if (ko.length > 0) summary += ` ${ko.join(" and ")} ${ko.length === 1 ? "is" : "are"} knocked out!`;

  return {
    trapName,
    ...(record?.description ? { description: record.description } : {}),
    ...(record?.damage_type ? { damageType: record.damage_type } : {}),
    kind: outcome.kind,
    ...(save ? { save } : {}),
    summary,
    lines,
  };
}
