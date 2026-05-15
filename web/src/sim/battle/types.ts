/**
 * Shared types for the battle simulation kernel.
 *
 * The kernel is pure (no Phaser, no React) so the same logic can drive
 * the editor's preview BattleScreen and, later, the game's /play
 * combat scene. The split mirrors `sim/types.ts` for the overworld
 * sim: types here, helpers in movement.ts, controller in
 * BattleSimulation.ts.
 *
 * Scope intent (MVP):
 *   - 2D arena grid (small — 6 cols × 4 rows by default). Party
 *     starts on the left columns, monsters on the right.
 *   - Each combatant takes one *turn* per *round*. Within a turn the
 *     active combatant submits one action (attack / cast / use
 *     ability / defend / flee). Movement is rolled into the action
 *     (e.g., Attack at distance > 1 → step closer first). Keep it
 *     simple; richer turn structure (separate move + action) can
 *     come later.
 *   - Battle ends when every monster is at 0 HP (victory), every
 *     party member is at 0 HP (defeat), or the party flees.
 */

/** Which "team" a combatant belongs to. */
export type BattleSide = "party" | "monster";

/** Grid coordinate inside the arena. */
export interface BattlePos {
  col: number;
  row: number;
}

/** A combatant on the battlefield. Party members carry their full
 *  character ref (for sprite + stats lookups) and monster combatants
 *  carry the monster ref. The kernel reads only the fields listed
 *  here; hosts can stash anything else on the source records. */
export interface BattleCombatant {
  /** Stable id used for selection / event references. Party: the
   *  character id; monster: synthetic (e.g. "monster_0"). */
  id: string;
  side: BattleSide;
  /** Display name (e.g., "Aldric", "Giant Rat #1"). */
  name: string;
  /** Sprite path under `/sprites/` (e.g., "person/fighter6.png"). */
  sprite: string;
  pos: BattlePos;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** Derived combat numbers — computed by the host (party) or read
   *  off the monster record. */
  ac: number;
  attackBonus: number;
  damage: { dice: number; sides: number; bonus: number };
  /** For party: ability scores so spell/heal helpers can read them.
   *  Monsters have no separate stat block today — leave 10s. */
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  /** Movement budget (cells per turn). Party reads from class.range;
   *  monsters read from monster.move_range. */
  moveRange: number;
  /** Set to true once HP hits 0. The kernel skips dead combatants in
   *  the turn cycle. */
  dead: boolean;
  /** Per-combatant XP reward (monsters) — paid out on victory.
   *  Party combatants leave this at 0. */
  xpReward: number;
  /** Optional weapon-name label so the event log can render
   *  "Aldric attacks with Club" rather than a bare "Aldric attacks". */
  weaponName?: string | null;
  /** True for monster + summon combatants — turns are resolved by
   *  the AI loop rather than the player. */
  aiControlled: boolean;
}

/** The full snapshot the UI renders from. Immutable per round. */
export interface BattleState {
  /** Arena dimensions. */
  cols: number;
  rows: number;
  combatants: ReadonlyArray<BattleCombatant>;
  /** Initiative-sorted order of combatant ids. Drives whose turn it
   *  is via `activeIndex` (an index into this array, NOT into
   *  `combatants`). */
  initiativeOrder: ReadonlyArray<string>;
  /** Index into `initiativeOrder` of whoever's turn it is. The kernel
   *  walks forward each time `endTurn()` resolves; dead combatants
   *  are skipped on advance. */
  activeIndex: number;
  /** Move points the current actor has remaining this turn. Refilled
   *  to the combatant's `moveRange` at the start of their turn. */
  movePoints: number;
  /** 1-based round counter. Bumps when the cycle wraps from the
   *  last living combatant back to the first. */
  round: number;
  outcome: BattleOutcome;
}

/** Terminal state of the battle. */
export type BattleOutcome =
  | { kind: "in_progress" }
  | { kind: "victory"; xpEarned: number; goldEarned: number }
  | { kind: "defeat" }
  | { kind: "fled" };

/** Cardinal step direction — v1 uses 4-way movement. Diagonals are
 *  intentionally absent (matches the Python original + v1 web port). */
export type BattleDirection = "n" | "s" | "e" | "w";

export const BATTLE_DIR_DELTAS: Record<BattleDirection, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
};

/** Result of a single-step move attempt. v1's MoveResult shape. */
export type MoveResult =
  | { kind: "moved"; from: BattlePos; to: BattlePos; pointsLeft: number }
  | {
      kind: "attacked";
      attackerId: string;
      targetId: string;
      hit: boolean;
      damage: number;
      killed: boolean;
    }
  | {
      kind: "blocked";
      reason: "wall" | "ally" | "no-points" | "out-of-turn" | "out-of-bounds";
    };

/** Actions a party combatant can submit on their turn. v1 has Attack
 *  too — it's a shortcut that finds an adjacent enemy and bumps into
 *  them. Step movement (Cardinal tryMove) is the primary input; this
 *  union only carries non-movement actions. */
export type BattleAction =
  | { kind: "attack" }
  | { kind: "cast"; spellId: string; targetId: string | null }
  | { kind: "use_ability"; abilityId: string; targetId: string | null }
  | { kind: "end_turn" };

/** Events the kernel emits for the UI to log + animate. Hosts
 *  subscribe; the kernel doesn't directly mutate the DOM. */
export type BattleEvent =
  | { kind: "round_started"; round: number }
  | { kind: "turn_started"; combatantId: string }
  | {
      kind: "attack";
      attackerId: string;
      targetId: string;
      hit: boolean;
      roll: number;
      total: number;
      attackerAttackBonus: number;
      targetAc: number;
      damage: number;
      killed: boolean;
      weaponName?: string;
    }
  | { kind: "moved"; combatantId: string; from: BattlePos; to: BattlePos }
  | {
      kind: "cast";
      casterId: string;
      spellId: string;
      targetId: string | null;
      effect: string;
      value?: number;
    }
  | {
      kind: "ability";
      casterId: string;
      abilityId: string;
      effect: string;
      value?: number;
    }
  | { kind: "killed"; combatantId: string }
  | {
      kind: "illegal";
      combatantId: string;
      reason: string;
    }
  | { kind: "outcome"; outcome: BattleOutcome }
  | { kind: "log"; message: string };

export type BattleEventListener = (event: BattleEvent) => void;

// ── Loose catalog refs the battle controller reads ────────────────
// These mirror the PartyScreen-side types but live here so the
// battle module is self-contained (the editor + future /play scene
// can both depend on `sim/battle/*` without dragging in `editor/*`).

export interface BattleMonsterRef {
  id: string;
  name?: string;
  sprite?: string;
  hp?: number;
  ac?: number;
  attack_bonus?: number;
  damage_dice?: number;
  damage_sides?: number;
  damage_bonus?: number;
  move_range?: number;
  xp_reward?: number;
  gold_min?: number;
  gold_max?: number;
  undead?: boolean;
  [k: string]: unknown;
}

export interface BattleEncounterRef {
  id: string;
  name?: string;
  level?: number;
  monsters?: string[];
  [k: string]: unknown;
}

/** Reach used by melee weapons / unarmed strikes. Chebyshev distance
 *  ≤ MELEE_RANGE = "in melee". */
export const MELEE_RANGE = 1;
/** Default arena dimensions if the host doesn't override. Kept
 *  small so a 4-on-3 fight fits on a single screen. */
export const DEFAULT_ARENA_COLS = 6;
export const DEFAULT_ARENA_ROWS = 4;
/** AI monster intent — what the kernel wants to do next on a
 *  monster's turn. The host pumps `nextMonsterIntent()` step-by-step
 *  so movement can be animated between tiles, matching v1. */
export type MonsterIntent =
  | { kind: "step"; direction: BattleDirection }
  | { kind: "bump"; direction: BattleDirection; targetId: string }
  | { kind: "wait" };
