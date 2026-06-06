/**
 * Turn-based tactical combat controller.
 *
 * Pure logic — no Phaser, no DOM. The Phaser scene constructs a Combat,
 * reads its public state to draw the arena, and calls `tryMove()`,
 * `attack()` and `decideMonsterIntent()` to advance.
 *
 * Turn flow:
 *   1. Constructor lays out party (right side) and enemies (left side)
 *      on the arena grid, then rolls initiative.
 *   2. `current` returns whose turn it is. `movePoints` reflects how
 *      many tiles the current actor has left to spend this turn.
 *   3. Active side calls `tryMove(dir)`. Three outcomes:
 *        - moved: position updated, movePoints decremented
 *        - bumped: walking into an adjacent enemy attacks them; this
 *          uses ALL remaining move points (turn ends)
 *        - blocked: wall / ally / out-of-bounds; nothing happens
 *   4. `endTurn()` advances the cursor to the next alive combatant
 *      and refills their movePoints.
 *   5. `isOver` / `winner` end the encounter when one side is wiped.
 *
 * For monster turns the scene calls `decideMonsterIntent()` repeatedly
 * until it returns 'wait' or the turn ends. The intent describes ONE
 * step (move or attack) so the scene can animate between steps.
 */

import { defaultRng, type RNG } from "../rng";
import {
  ARENA_COLS,
  ARENA_ROWS,
  ALL_DIRECTIONS,
  DIR_DELTAS,
  chebyshev,
  inBounds,
  isWall,
  type Direction,
  type GridPos,
} from "./Arena";
import { getModifier, rollAttack, rollBonusDamage, rollD20, rollDamage, rollInitiative } from "./engine";
import {
  sumBuff,
  tickBuffs,
  describeExpire,
  type Buff,
  type BuffKind,
} from "./Buffs";
import type {
  AttackResult,
  Combatant,
  InitiativeRoll,
  Side,
} from "../types";
import type { MonsterSpell, MonsterPassive } from "../data/monsters";

/** Subset of MonsterSpell the dice helpers actually use. Keeping this
 *  narrow lets the helpers stay easy to test in isolation. */
type MonsterSpellLike = Pick<
  MonsterSpell,
  | "type"
  | "damage_dice"
  | "damage_sides"
  | "damage_bonus"
  | "heal_dice"
  | "heal_sides"
  | "heal_bonus"
>;

/** Pick the nearest enemy within `range` tiles (Chebyshev). Returns
 *  null when nobody qualifies — caller falls through to melee. */
function nearestInRange(
  actor: Combatant,
  candidates: Combatant[],
  range: number | undefined,
): Combatant | null {
  const r = range ?? Infinity;
  let best: Combatant | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = chebyshev(actor.position, c.position);
    if (d > r) continue;
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

/** True iff the combatant carries a passive of the given kind. */
function hasPassive(c: Combatant, kind: MonsterPassive["type"]): boolean {
  if (!c.passives) return false;
  return c.passives.some((p) => p.type === kind);
}

// ── Class-gated ability predicates ────────────────────────────────
//
// Backstab + Shadow Step both gate on (class === "Thief", level ≥ N)
// plus a per-ability extra check. Centralised here so combat.attack
// and combat.tryMove read identical gates.

/** True when the attacker meets the Backstab prerequisites: alive
 *  Thief, level 3+, wielding a Dagger. The roll itself (d20+DEX vs
 *  DC 12) lives in `Combat.attack` so the saving-throw RNG share the
 *  same `this.rng` as the rest of the encounter. */
export function canBackstab(c: Combatant): boolean {
  if (c.hp <= 0) return false;
  if (!c.charClass) return false;
  if (c.charClass.toLowerCase() !== "thief") return false;
  if ((c.level ?? 1) < 3) return false;
  if (!c.weaponName) return false;
  return c.weaponName.toLowerCase() === "dagger";
}

/** True when a bump-attack should leave the attacker's remaining
 *  movement intact (Thief Shadow Step). Level 7+ Thieves only —
 *  Python required the same gate. Fires on hit, miss, OR kill: the
 *  ability is a hit-and-run mobility tool, not a finisher bonus.
 *  The kill-only gate that used to live alongside this predicate
 *  was removed once the design intent was clarified. */
export function canShadowStep(c: Combatant): boolean {
  if (c.hp <= 0) return false;
  if (!c.charClass) return false;
  if (c.charClass.toLowerCase() !== "thief") return false;
  return (c.level ?? 1) >= 7;
}

/** True when the attacker's strike against an undead target should
 *  be doubled (Paladin Smite Undead). Mirrors the abilities.json
 *  record: gates on Paladin class at level 1+ (every Paladin starts
 *  with it). Sibling-shape with `canBackstab` / `canShadowStep` so
 *  the engine's attack flow can read all three from one place.
 *
 *  Note that this only gates the attacker; the *target.undead* check
 *  happens at the call site so this predicate stays usable wherever
 *  we need a per-actor "could smite if undead were present" answer
 *  (e.g. a future UI hint on the action menu). */
export function canSmiteUndead(c: Combatant): boolean {
  if (c.hp <= 0) return false;
  if (!c.charClass) return false;
  if (c.charClass.toLowerCase() !== "paladin") return false;
  return (c.level ?? 1) >= 1;
}

/** True when this combatant's turns are run by the monster-AI loop. */
export function isAiControlled(c: Combatant): boolean {
  // Honour an explicit flag first (summons set it true on the party
  // side); otherwise default to "enemies are AI, party are player".
  if (typeof c.aiControlled === "boolean") return c.aiControlled;
  return c.side === "enemies";
}

export type MoveResult =
  | { kind: "moved"; from: GridPos; to: GridPos; pointsLeft: number }
  | { kind: "attacked"; result: AttackResult }
  | {
      kind: "blocked";
      reason:
        | "wall"
        | "ally"
        | "no-points"
        | "out-of-turn"
        /** Tried to bump-attack a second enemy in the same turn. Nimble
         *  / Shadow Step / Dragon hit-and-run keep movement alive after
         *  a swing so the actor can retreat — but only one attack per
         *  turn. Remaining moves are still spendable on empty tiles. */
        | "already-attacked";
    };

/** Events the round-end consume tick produces. The scene drains
 *  these via `popConsumeEvents()` after each `endTurn()` so it can
 *  float damage numbers / show an escape flash on the affected
 *  sprite. Without these the HP drain is invisible to the player. */
export type ConsumeEvent =
  | { targetId: string; kind: "applied"; consumerId: string }
  | { targetId: string; kind: "tick"; damage: number }
  | { targetId: string; kind: "saved" }
  | { targetId: string; kind: "released" };

/** What a monster's AI wants to do this step. */
export type MonsterIntent =
  | { kind: "attack"; targetId: string }
  | { kind: "move"; dir: Direction }
  | { kind: "spell"; spellIndex: number; targetId?: string }
  | { kind: "wait" };

export class Combat {
  readonly combatants: Combatant[];
  readonly initiativeOrder: InitiativeRoll[];
  private cursor = 0;
  /** Tiles the current actor has left to spend this turn. */
  movePoints = 0;
  /**
   * True once the current actor has resolved a bump-attack this turn.
   * Gates further bump-attacks so abilities that preserve movement
   * after a swing (Elf Nimble's `postAttackMove`, Dragon hit-and-run,
   * Thief Shadow Step) can't be chained into attack → step → attack
   * → step indefinitely. Remaining `movePoints` are still spendable
   * on empty tiles — the design intent of those abilities is "swing
   * and retreat," not "swing and keep swinging." Reset by
   * `refillMovePoints` on every turn refill.
   */
  private attackedThisTurn = false;
  readonly log: string[] = [];
  /**
   * Numerical buffs / debuffs keyed by combatant id. Mirrors the
   * Python game's bless_buffs / curse_buffs / range_buffs dicts
   * unified into one structure. See `./Buffs.ts` for kinds.
   */
  private buffs = new Map<string, Buff[]>();
  /**
   * Per-combatant summon timer (in rounds). Animate Dead and similar
   * spells push an entry here; tickSummons() decrements at end of
   * round and crumbles the summon to dust when it expires.
   */
  private summons = new Map<string, number>();
  /** Counts cursor advances; we tick buffs once per full round
   *  (equal to combatants.length advances). */
  private turnsAdvanced = 0;
  /** Consume-tick events accumulated since the last `popConsumeEvents`
   *  call. Drained by the scene each `endTurn()` so floating damage
   *  / escape labels animate in sync with HP changes. */
  private pendingConsumeEvents: ConsumeEvent[] = [];

  /**
   * Optional per-cell walkability predicate, supplied by the arena
   * map. Default = no extra blocking — only the hardcoded perimeter
   * wall stops movement. `isBlocked` ORs this with `isWall` so
   * `tryMove`, the AI step, and `findFreeTileNear` all honour
   * authored obstacles like rocks / pits.
   */
  private blockedPredicate: (col: number, row: number) => boolean = () => false;
  /**
   * Optional per-cell line-of-sight predicate. Cells where this
   * returns true stop projectiles + ranged spells. Default = nothing
   * obstructs (open arena). `hasLineOfSight` walks Bresenham between
   * attacker and target and rejects the line on the first
   * intermediate obstruction.
   */
  private obstructsPredicate: (col: number, row: number) => boolean = () => false;

  private rng: RNG;

  constructor(
    party: Combatant[],
    enemies: Combatant[],
    rng: RNG = defaultRng,
    /**
     * Optional per-cell blocked predicate used during initial
     * formation placement. When provided, `layoutFormations` filters
     * the candidate cells in each side's band by it so combatants
     * don't spawn on top of unwalkable terrain (rocks, trees, hedges,
     * etc.) carried in the arena map. The same predicate gets
     * installed permanently after construction via
     * `setBlockedPredicate` for movement / AI; passing it here just
     * makes initial placement honor the same rules. When omitted, the
     * placer falls back to the original full-band scatter.
     */
    placementBlocked?: (col: number, row: number) => boolean,
  ) {
    this.rng = rng;
    this.combatants = [...party, ...enemies];
    if (placementBlocked) {
      // Install up front so layoutFormations can read it via
      // `this.blockedPredicate`. CombatScene's later call replaces it
      // (with an identical body, in practice) but doing it here keeps
      // tryMove / AI honest if the caller forgets the second hookup.
      this.blockedPredicate = placementBlocked;
    }
    this.layoutFormations(party, enemies);

    const rolls: InitiativeRoll[] = this.combatants.map((c) => {
      const { total, raw } = rollInitiative(c.dexMod, this.rng);
      return { combatantId: c.id, total, raw };
    });
    rolls.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const ca = this.byId(a.combatantId);
      const cb = this.byId(b.combatantId);
      if (cb.dexMod !== ca.dexMod) return cb.dexMod - ca.dexMod;
      return this.combatants.indexOf(ca) - this.combatants.indexOf(cb);
    });
    this.initiativeOrder = rolls;
    this.advanceToAlive();
    this.refillMovePoints();

    // Opening banner — mirrors the Python game's "Party vs N enemies!"
    // intro lines so the bottom log opens with context.
    const enemyNames = enemies.map((e) => e.name).join(", ");
    this.log.push(`--- Party vs ${enemies.length} enemies! ---`);
    if (enemyNames) this.log.push(`(${enemyNames})`);
    this.log.push(`${party.length} party members engage!`);
    this.log.push(`-- ${this.current.name}'s turn --`);
  }

  /**
   * Scatter party across the bottom band of the arena and enemies
   * across the top band. Each side gets a 4-row band (rows 11..14 for
   * party, rows 1..4 for enemies) with a one-column gutter against
   * the perimeter walls. Cells are shuffled with the seeded RNG and
   * the first N taken, so positions are random per-encounter but
   * reproducible in tests.
   *
   * Replaces an earlier "everyone in one row, centred" layout that
   * left party and enemies looking like two opposing chorus lines.
   */
  private layoutFormations(party: Combatant[], enemies: Combatant[]): void {
    const colMin = 2;
    const colMax = ARENA_COLS - 3;          // inclusive, leaves a wall gutter
    const partyRows = [ARENA_ROWS - 5, ARENA_ROWS - 4, ARENA_ROWS - 3, ARENA_ROWS - 2];
    const enemyRows = [1, 2, 3, 4];
    this.placeOnBand(party, colMin, colMax, partyRows);
    this.placeOnBand(enemies, colMin, colMax, enemyRows);
  }

  /** Shuffle the (col, row) cells in the given band and assign the
   *  first `combatants.length` to each combatant. Falls back to row 0
   *  / centred col stacking if (somehow) the band is smaller than the
   *  group — should never happen with the bands above. */
  private placeOnBand(
    combatants: Combatant[],
    colMin: number,
    colMax: number,
    rows: number[],
  ): void {
    // Two pools: walkable cells go first; the rest are kept as a
    // fallback for the edge case where an arena map authored heavy
    // obstruction in a side band would otherwise leave combatants
    // unplaced. Filtering uses `isBlocked` so the perimeter wall +
    // any arena-map `walkable: false` cells are skipped together.
    const walkable: GridPos[] = [];
    const blocked: GridPos[] = [];
    for (const r of rows) {
      for (let c = colMin; c <= colMax; c++) {
        if (this.isBlocked(c, r)) blocked.push({ col: c, row: r });
        else walkable.push({ col: c, row: r });
      }
    }
    // Fisher-Yates with Math.random — deliberately NOT this.rng so
    // the seeded combat RNG sequence (d20s, damage rolls, init) stays
    // independent of formation shuffling. Tests pin combat RNG with
    // mulberry32 and check positions only as bands, not exact cells,
    // so non-deterministic placement is fine.
    const shuffle = (arr: GridPos[]): void => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };
    shuffle(walkable);
    shuffle(blocked);
    // Concatenate so walkable cells are consumed first; blocked cells
    // only come into play when the band is too crowded — which on the
    // ARENA_COLS-2 wide × 4 row default bands shouldn't happen unless
    // an author intentionally packed obstacles wall-to-wall.
    const cells = walkable.concat(blocked);
    combatants.forEach((c, i) => {
      c.position = cells[i] ?? { col: colMin, row: rows[0] };
    });
  }

  // ── Queries ──────────────────────────────────────────────────────

  byId(id: string): Combatant {
    const c = this.combatants.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown combatant id: ${id}`);
    return c;
  }

  get current(): Combatant {
    return this.byId(this.initiativeOrder[this.cursor].combatantId);
  }

  alive(side: Side): Combatant[] {
    return this.combatants.filter((c) => c.side === side && c.hp > 0);
  }

  /**
   * Install (or clear) the per-cell movement-block predicate. Pass
   * `null` to reset to "no extra blocking". CombatScene installs the
   * predicate after the scene wires the arena map's `walkable` flags.
   */
  setBlockedPredicate(fn: ((col: number, row: number) => boolean) | null): void {
    this.blockedPredicate = fn ?? (() => false);
  }

  /**
   * Install (or clear) the line-of-sight predicate. Pass `null` to
   * reset. Cells where the predicate returns true block ranged
   * attacks and damage spells that go through `hasLineOfSight`.
   */
  setObstructsPredicate(fn: ((col: number, row: number) => boolean) | null): void {
    this.obstructsPredicate = fn ?? (() => false);
  }

  /** True when `(col, row)` is a wall or has been flagged unwalkable
   *  by the arena map. Used in place of bare `isWall` calls. */
  private isBlocked(col: number, row: number): boolean {
    return isWall(col, row) || this.blockedPredicate(col, row);
  }

  /**
   * True iff a straight line from `from` → `to` doesn't pass through
   * any cell flagged as obstructing. Uses an integer Bresenham walk;
   * the endpoints themselves are NOT tested (you don't shoot through
   * yourself, and the target tile is your aim point, not cover).
   *
   * No predicate installed → always true; v1 callers that don't care
   * about cover get the original line-free behaviour. The blocking
   * cell itself acts as cover even when its `walkable` is true (tall
   * grass) — the two flags are independent.
   */
  hasLineOfSight(from: GridPos, to: GridPos): boolean {
    let x0 = from.col;
    let y0 = from.row;
    const x1 = to.col;
    const y1 = to.row;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (x0 !== x1 || y0 !== y1) {
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
      // Reached the target — endpoint itself never obstructs the
      // shot at that target.
      if (x0 === x1 && y0 === y1) break;
      if (this.obstructsPredicate(x0, y0)) return false;
    }
    return true;
  }

  combatantAt(col: number, row: number): Combatant | null {
    for (const c of this.combatants) {
      if (c.hp <= 0) continue;
      if (c.position.col === col && c.position.row === row) return c;
    }
    return null;
  }

  get isOver(): boolean {
    return this.alive("party").length === 0 || this.alive("enemies").length === 0;
  }

  get winner(): Side | null {
    if (!this.isOver) return null;
    return this.alive("party").length > 0 ? "party" : "enemies";
  }

  // ── Mid-fight roster changes ─────────────────────────────────────
  //
  // The constructor seeds the roster from `(party, enemies)`; spells
  // like Animate Dead need to bring new actors in mid-encounter. These
  // helpers keep `combatants` and `initiativeOrder` in sync so the
  // scene's existing turn loop just picks the new entry up.

  /**
   * Add a combatant mid-fight. Rolls initiative for them, splices the
   * roll into the existing order so they get a turn this round (after
   * the current actor), and stamps their position on the grid.
   *
   * If `summonTurns` is provided, the combatant is tracked as a summon
   * — at the end of each full round its timer ticks down, and when it
   * hits zero the combatant crumbles to dust (HP = 0).
   */
  addCombatant(
    c: Combatant,
    position: { col: number; row: number },
    summonTurns?: number,
  ): void {
    c.position = { ...position };
    this.combatants.push(c);
    const { total, raw } = rollInitiative(c.dexMod, this.rng);
    // Insert the roll just after the current cursor so the new actor
    // takes their turn before the round wraps. Splicing here also
    // keeps `initiativeOrder.length === combatants.length`, which the
    // round-tick math depends on.
    this.initiativeOrder.splice(this.cursor + 1, 0, {
      combatantId: c.id, total, raw,
    });
    if (typeof summonTurns === "number" && summonTurns > 0) {
      this.summons.set(c.id, summonTurns);
    }
  }

  // ── Buffs / debuffs ──────────────────────────────────────────────

  /** Add a numerical buff or debuff to a combatant. */
  addBuff(combatantId: string, buff: Buff): void {
    const list = this.buffs.get(combatantId) ?? [];
    list.push(buff);
    this.buffs.set(combatantId, list);
  }

  /** Sum every active buff of `kind` on this combatant — handy for
   *  scenes wanting to display "+2 ATK" badges or log breakdowns. */
  sumBuff(combatantId: string, kind: BuffKind): number {
    return sumBuff(this.buffs.get(combatantId), kind);
  }

  /**
   * True if this combatant has any active buff with the given source
   * tag (case-insensitive). Used by the scene to drive source-keyed
   * visuals — e.g. holding the caster at low alpha while their
   * "Invisibility" buff is in effect.
   */
  hasBuffFromSource(combatantId: string, source: string): boolean {
    const list = this.buffs.get(combatantId);
    if (!list) return false;
    const tag = source.toLowerCase();
    return list.some((b) => b.source.toLowerCase() === tag);
  }

  /** Hit-roll bonus = base attackBonus + active attack_bonus buffs
   *  − active attack_penalty buffs. */
  effectiveAttackBonus(c: Combatant): number {
    const list = this.buffs.get(c.id);
    return c.attackBonus + sumBuff(list, "attack_bonus")
                          - sumBuff(list, "attack_penalty");
  }

  /** Defensive AC = base ac + ac_bonus − ac_penalty. */
  effectiveAc(c: Combatant): number {
    const list = this.buffs.get(c.id);
    return c.ac + sumBuff(list, "ac_bonus") - sumBuff(list, "ac_penalty");
  }

  /**
   * Extra damage on top of the weapon's dice + base bonus, summed
   * across active `damage_bonus` buffs. Mirrors the Python game's
   * STR-buff path where Elixir of Strength bumps both attack and
   * damage — we model that as two parallel buff kinds so callers
   * stay explicit about which side of the calc each adds to.
   */
  effectiveDamageBonus(c: Combatant): number {
    return sumBuff(this.buffs.get(c.id), "damage_bonus");
  }

  // ── Movement & bump-attack ───────────────────────────────────────

  /**
   * Attempt to move the current actor one step in `dir`. Returns a
   * structured outcome the UI can react to. Mutates state on success.
   *
   * Bump-attack rule (from src/states/combat.py): walking into an
   * adjacent enemy resolves a melee attack and consumes ALL remaining
   * move points — i.e. ends the turn after the attack resolves.
   */
  tryMove(dir: Direction): MoveResult {
    if (this.isOver) return { kind: "blocked", reason: "out-of-turn" };
    if (this.movePoints <= 0) {
      return { kind: "blocked", reason: "no-points" };
    }
    const actor = this.current;
    const [dc, dr] = DIR_DELTAS[dir];
    const nc = actor.position.col + dc;
    const nr = actor.position.row + dr;

    if (!inBounds(nc, nr) || this.isBlocked(nc, nr)) {
      return { kind: "blocked", reason: "wall" };
    }

    const occupant = this.combatantAt(nc, nr);
    if (occupant) {
      if (occupant.side === actor.side) {
        return { kind: "blocked", reason: "ally" };
      }
      // Already swung this turn — block any further bump-attacks.
      // Abilities that preserve movement after a swing (Nimble,
      // Shadow Step, Dragon hit-and-run) are intended for retreat,
      // not for chaining attacks. The actor can still spend their
      // remaining movement on empty tiles to disengage.
      if (this.attackedThisTurn) {
        return { kind: "blocked", reason: "already-attacked" };
      }
      // Enemy in the way → bump attack. Normally this zeros the
      // remaining moves so the turn ends after the swing. Two
      // overrides, in priority order:
      //
      //   1. Thief Shadow Step (level 7+) — keeps ALL remaining
      //      movement after ANY bump-attack (hit, miss, or kill).
      //      The point of the ability is hit-and-run mobility: the
      //      thief darts in, swings, and slips back out of reach
      //      whether or not the strike landed. Strictly the most
      //      powerful override.
      //   2. `postAttackMove` (Elf Nimble: 2, Dragon hit-and-run:
      //      2) — caps movement at the actor's per-attack
      //      allowance regardless of whether the attack killed.
      //      Fires for hit / miss / hit-not-killed alike (the
      //      ability description is "move after an attack," not
      //      "move after a kill"). Replaces — not adds to —
      //      whatever was left, so the player can't bank
      //      pre-attack movement and then claim the post-attack
      //      bonus on top.
      //
      // When neither applies the default zero-out runs, matching
      // the legacy "attack ends the turn" rule.
      const result = this.attack(occupant.id);
      // Lock the per-turn attack gate BEFORE the override branches —
      // every bump-attack path (Shadow Step, postAttackMove, default
      // zero-out) consumes the actor's one swing for the turn.
      this.attackedThisTurn = true;
      if (canShadowStep(actor) && !this.isOver) {
        // Mutate the result so the scene's player-step handler can
        // start the "shadow step active" pulse on the thief's body
        // without re-deriving the gate from the actor + result. The
        // attack returned 0–2ms ago — nothing else has read the
        // object yet, so the post-hoc field add is safe.
        result.shadowStepped = true;
        // Log line phrased generically ("steps away") since the
        // ability now fires on hit, miss, AND kill. The remaining-
        // moves count tells the player how much retreat they have.
        this.log.push(
          `${actor.name} Shadow Steps away! (${this.movePoints} moves remaining)`,
        );
      } else if (
        !this.isOver &&
        typeof actor.postAttackMove === "number" &&
        actor.postAttackMove > 0
      ) {
        this.movePoints = actor.postAttackMove;
        this.log.push(
          `${actor.name} darts back. (${actor.postAttackMove} moves remaining)`,
        );
      } else {
        this.movePoints = 0;
      }
      return { kind: "attacked", result };
    }

    const from = { ...actor.position };
    actor.position = { col: nc, row: nr };
    this.movePoints -= 1;
    return { kind: "moved", from, to: { col: nc, row: nr }, pointsLeft: this.movePoints };
  }

  /**
   * Resolve an attack from the current actor against `targetId`.
   * Used by the bump-attack path and by monster AI directly.
   */
  attack(targetId: string): AttackResult {
    const attacker = this.current;
    const target = this.byId(targetId);

    if (attacker.hp <= 0) throw new Error(`Attacker ${attacker.name} is down`);
    if (target.hp <= 0) throw new Error(`Target ${target.name} is already down`);
    if (target.side === attacker.side) {
      throw new Error(`Cannot attack ally ${target.name}`);
    }

    // Resolve hit + damage using *effective* values so buffs and
    // debuffs (Bless +ATK, Curse -ATK / -AC, Shield +AC) flow into
    // the math automatically.
    const effAtk = this.effectiveAttackBonus(attacker);
    const effAc = this.effectiveAc(target);
    const roll = rollAttack(effAtk, effAc, this.rng);
    // Thief Backstab — level 3+ Thief wielding a Dagger gets a chance
    // to upgrade a normal melee hit to a crit. Mirrors Python's
    // `combat.py` backstab block: d20 + DEX vs DC 12 on top of a hit
    // that wasn't already a nat-20 crit. The flag rides back on the
    // AttackResult so the scene can play the stinger animation.
    let backstab = false;
    let backstabAttempted = false;
    let critical = roll.critical;
    if (roll.hit && !critical && canBackstab(attacker)) {
      backstabAttempted = true;
      const saveRoll = rollD20(this.rng);
      const dexMod = getModifier(attacker.dexterity ?? 10);
      const total = saveRoll + dexMod;
      const dice = `d20:${saveRoll}+${dexMod}=${total} vs DC 12`;
      if (total >= 12) {
        backstab = true;
        critical = true;
        this.log.push(
          `${attacker.name} finds an opening! (${dice}) — BACKSTAB!`,
        );
      } else {
        // Tell the player the ability fired even when the save
        // failed — without this the gate looks silently absent
        // and the player can't tell whether Backstab is wired
        // at all. Same dice-math format as the success line so
        // both branches read consistently in the log strip.
        this.log.push(
          `${attacker.name} probes for an opening on ${target.name} (${dice}) — no opening.`,
        );
      }
    }
    let damage = 0;
    let bonusDamage = 0;
    let smiteUndead = false;
    if (roll.hit) {
      // `damage_bonus` buffs (Elixir of Strength) add a flat amount on
      // top of the weapon's dice + base bonus. Critical hits double
      // the dice but not the bonus — the buff stays additive on the
      // bonus side, matching how `rollDamage` treats `bonus` already.
      const buffBonus = this.effectiveDamageBonus(attacker);
      damage = rollDamage(
        attacker.damage.dice,
        attacker.damage.sides,
        attacker.damage.bonus + buffBonus,
        critical,
        this.rng
      );
      // Magic-item bonus damage — Sun Sword's 1d6 fire, etc. Rolled
      // separately so the dice spec can be either flat ("3") or
      // "NdM" ("1d6"). Crits double the dice the same way base
      // damage does. Mirrors the Python game's `_roll_bonus_damage`.
      //
      // RANGED weapons are excluded here: a crossbow / bow / sling's
      // elemental payload (Stormbolt Crossbow's lightning, etc.) is a
      // ranged effect and fires on the Range shot via `resolveThrow`,
      // not when the wielder bumps an adjacent enemy with the stock.
      // Melee weapons (weaponRanged falsy) keep landing their bonus
      // on every swing.
      if (attacker.weaponBonusDamage != null && !attacker.weaponRanged) {
        bonusDamage = rollBonusDamage(attacker.weaponBonusDamage, critical, this.rng);
        damage += bonusDamage;
      }
      // Paladin Smite Undead — straight 2x multiplier on the rolled
      // total when the attacker is a Paladin AND the target carries
      // the `undead` flag (Skeleton, Zombie, Wight, Lich, …). Applied
      // AFTER the bonus-damage roll so a Sun Sword Paladin smiting a
      // Lich doubles BOTH the dagger dice and the fire bonus — the
      // ability's flavour ("divine wrath") reads as "everything hits
      // harder," not "the holy bit, separately." Crits stack with
      // smite multiplicatively (crit doubles the dice, smite doubles
      // the total) so a crit-smite reads as the peak holy moment.
      if (canSmiteUndead(attacker) && target.undead) {
        smiteUndead = true;
        damage *= 2;
        this.log.push(
          `${attacker.name} channels divine wrath against ${target.name} — SMITE!`,
        );
      }
      target.hp = Math.max(0, target.hp - damage);
      this.applyOnHitEffects(attacker, target);
    }
    const killed = target.hp === 0 && roll.hit;
    // Release anyone in the dead actor's stomach so the encounter
    // doesn't end with a Cleric forever inside a corpse. Mirrors the
    // Python game's `_release_consumed_fighter` triggered from
    // `_on_monster_killed`.
    if (killed) {
      this.releaseAllConsumedBy(target.id);
    }
    // Detailed log line — mirrors the Python game's "(d20:N+M=T vs ACX)"
    // format so the player can see the math behind each swing. The
    // bonus shown is the effective one so a Blessed attacker visibly
    // adds the +2. Magic weapons append a damage-type tag so the
    // player can see Sun Sword's fire damage at a glance.
    const bonusStr = effAtk >= 0 ? `+${effAtk}` : `${effAtk}`;
    const dice = `d20:${roll.roll}${bonusStr}=${roll.total} vs AC${effAc}`;
    const dmgType = attacker.weaponDamageType;
    const typeSuffix = dmgType && dmgType !== "physical" ? ` (${dmgType})` : "";
    const dmgBreakdown = bonusDamage > 0
      ? ` — ${damage} dmg${typeSuffix} [${damage - bonusDamage}+${bonusDamage} bonus]`
      : ` — ${damage} dmg${typeSuffix}`;
    this.log.push(
      roll.hit
        ? `${attacker.name} ${critical ? "crits" : "hits"} ${target.name} (${dice})${dmgBreakdown}${killed ? ", defeated!" : "."}`
        : `${attacker.name} swings at ${target.name} (${dice}) — miss.`
    );
    return {
      attackerId: attacker.id,
      targetId: target.id,
      hit: roll.hit,
      roll: roll.roll,
      total: roll.total,
      critical,
      backstab,
      backstabAttempted,
      smiteUndead,
      damage,
      killed,
    };
  }

  /**
   * Decide what the active monster wants to do this STEP. Called by
   * the scene one-at-a-time so movement can be animated between tiles.
   *
   * Heuristic:
   *   - If adjacent (Chebyshev = 1) to any alive party member, attack
   *     the lowest-HP one (focus fire).
   *   - Otherwise step toward the nearest party member, picking the
   *     cardinal direction that reduces Manhattan distance most. Ties
   *     are broken by RNG so monsters don't all funnel identically.
   *   - If no useful move exists, return 'wait' so the scene ends the
   *     turn.
   */
  decideMonsterIntent(): MonsterIntent {
    const actor = this.current;
    // Generalised: any AI-controlled combatant runs this loop. Enemies
    // are AI-driven by default; summoned allies (Animate Dead) live on
    // the party side but flip aiControlled so they fight on their own.
    if (!isAiControlled(actor)) return { kind: "wait" };
    if (this.movePoints <= 0) return { kind: "wait" };
    // Defensive: a fire cell (thrown torch, fire trap) can kill the
    // current actor mid-turn AFTER endTurn already selected them. The
    // scene's run loop checks the loop condition but neither it nor
    // isAiControlled inspects hp, so without this guard we'd hand
    // back an attack intent and Combat.attack would throw "Attacker
    // is down". Treating dead actors as "wait" lets the run loop
    // exit cleanly and endTurn skip them on the next advance.
    if (actor.hp <= 0) return { kind: "wait" };

    // Hostile to whichever side the actor isn't on. Consumed party
    // members are off the board — exclude them from the AI target
    // list so a Man Eater doesn't "attack" someone in its own belly.
    const enemySide: Side = actor.side === "enemies" ? "party" : "enemies";
    const targets = this.alive(enemySide).filter((c) => !c.consumed);
    if (targets.length === 0) return { kind: "wait" };

    // Spell-casting AI — Dragons breathe fire, Liches throw bolts,
    // Trolls heal themselves. Roll each spell's `cast_chance`; the
    // first one that passes AND has a valid target wins. Mirrors the
    // Python game's `_monster_try_spell` at `combat.py:5120+`.
    const spellIntent = this.maybePickSpell(actor, targets);
    if (spellIntent) return spellIntent;

    // Adjacent? Attack the weakest.
    const adjacent = targets.filter(
      (t) => chebyshev(actor.position, t.position) === 1
    );
    if (adjacent.length > 0) {
      adjacent.sort((a, b) => a.hp - b.hp);
      return { kind: "attack", targetId: adjacent[0].id };
    }

    // Otherwise pursue the nearest target.
    const nearest = [...targets].sort(
      (a, b) =>
        chebyshev(actor.position, a.position) -
        chebyshev(actor.position, b.position)
    )[0];

    let bestDelta = Infinity;
    const candidates: Direction[] = [];
    for (const dir of ALL_DIRECTIONS) {
      const [dc, dr] = DIR_DELTAS[dir];
      const nc = actor.position.col + dc;
      const nr = actor.position.row + dr;
      if (!inBounds(nc, nr) || this.isBlocked(nc, nr)) continue;
      const occupant = this.combatantAt(nc, nr);
      // Allow stepping into a tile occupied by the target's party so
      // the bump-attack path can resolve — but only if it's an enemy
      // of the monster. Allies of the monster (other monsters) block.
      if (occupant && occupant.side === actor.side) continue;
      const candidatePos = { col: nc, row: nr };
      const delta =
        chebyshev(candidatePos, nearest.position) -
        chebyshev(actor.position, nearest.position);
      if (delta < bestDelta) {
        bestDelta = delta;
        candidates.length = 0;
        candidates.push(dir);
      } else if (delta === bestDelta) {
        candidates.push(dir);
      }
    }

    if (candidates.length === 0 || bestDelta >= 0) {
      // No direction makes us closer. Sit still rather than wander.
      return { kind: "wait" };
    }
    const idx = Math.floor(this.rng() * candidates.length);
    return { kind: "move", dir: candidates[idx] };
  }

  // ── Turn control ─────────────────────────────────────────────────

  /** Move the turn cursor to the next alive combatant and refill points. */
  endTurn(): void {
    if (this.isOver) return;
    for (let i = 0; i < this.combatants.length; i++) {
      this.cursor = (this.cursor + 1) % this.initiativeOrder.length;
      this.turnsAdvanced += 1;
      // End of a round — every combatant has had a chance to act.
      // Tick all buff durations down once and log expirations.
      if (this.turnsAdvanced % this.combatants.length === 0) {
        this.tickAllBuffs();
        this.tickSummons();
        this.tickPassives();
      }
      if (this.byId(this.initiativeOrder[this.cursor].combatantId).hp > 0) {
        this.refillMovePoints();
        this.log.push(`-- ${this.current.name}'s turn --`);
        return;
      }
    }
  }

  /** Round-end tick. Decrements every active buff and logs expirations. */
  private tickAllBuffs(): void {
    for (const [id, list] of this.buffs) {
      const expired = tickBuffs(list);
      if (list.length === 0) this.buffs.delete(id);
      for (const b of expired) {
        const c = this.combatants.find((x) => x.id === id);
        if (!c || c.hp <= 0) continue;
        this.log.push(describeExpire(c.name, b.source));
      }
    }
  }

  /**
   * Round-end tick for active summons. Decrements each timer and, when
   * one hits zero, sets the summon's HP to zero with a flavour log
   * line ("X crumbles to dust!"). Mirrors the Python summon_buffs
   * expiration in `_tick_summon_buffs`.
   */
  private tickSummons(): void {
    for (const [id, turnsLeft] of this.summons) {
      const next = turnsLeft - 1;
      if (next <= 0) {
        this.summons.delete(id);
        const c = this.combatants.find((x) => x.id === id);
        if (c && c.hp > 0) {
          c.hp = 0;
          this.log.push(`${c.name} crumbles to dust!`);
        }
      } else {
        this.summons.set(id, next);
      }
    }
  }

  /**
   * End-of-round pass for monster `passives` array.
   *
   *   - `regen`            — heal `amount` HP, capped at maxHp.
   *   - `fire_resistance`  — passive flag; consumed by spell damage.
   *   - `poison_immunity`  — passive flag; consumed by future poison.
   *
   * Only the regen branch mutates state here; the other two are
   * declarative flags read at damage-resolution time.
   */
  private tickPassives(): void {
    for (const c of this.combatants) {
      if (c.hp <= 0) continue;
      if (!c.passives) continue;
      for (const p of c.passives) {
        if (p.type === "regen" && c.hp < c.maxHp) {
          const before = c.hp;
          c.hp = Math.min(c.maxHp, c.hp + p.amount);
          const healed = c.hp - before;
          if (healed > 0) {
            this.log.push(`${c.name} regenerates ${healed} HP.`);
          }
        }
      }
    }
  }

  /** True when the active combatant has been swallowed and their
   *  turn should auto-resolve via `runConsumedAutoTurn` rather than
   *  prompting the player or running the AI loop. */
  isCurrentConsumed(): boolean {
    return !!this.current.consumed;
  }

  /**
   * Auto-resolve the active combatant's turn while they're consumed.
   * Mirrors `_tick_consumed_fighter` at `src/states/combat.py:4771`:
   *
   *   - Roll d20 + STR mod vs the saved `saveDc`.
   *   - Pass → spit them out at a free tile near the consumer
   *     (or near their original position if the consumer's gone),
   *     clear the debuff, queue a "saved" event.
   *   - Fail → take `damagePerTurn` HP, queue a "tick" event. If
   *     they hit 0 HP they died inside; the body is "released" at
   *     the consumer's tile so it can be revived later.
   *
   * Returns the queued events so the scene can animate. Caller is
   * responsible for calling `endTurn()` afterwards — the auto-resolve
   * always consumes the whole turn regardless of outcome.
   */
  runConsumedAutoTurn(): ConsumeEvent[] {
    const actor = this.current;
    if (!actor.consumed) return [];
    const data = actor.consumed;
    const consumer = this.combatants.find((x) => x.id === data.consumerId);

    // Consumer dead? Auto-release without rolling — the body just
    // tumbles out as the beast falls.
    if (!consumer || consumer.hp <= 0) {
      this.releaseConsumed(actor, consumer ?? null);
      this.log.push(`${actor.name} tumbles free as the beast falls!`);
      return this.popConsumeEvents();
    }

    const strMod = Math.floor(((actor.strength ?? 10) - 10) / 2);
    const roll = 1 + Math.floor(this.rng() * 20);
    const total = roll + strMod;
    if (total >= data.saveDc) {
      this.releaseConsumed(actor, consumer);
      this.log.push(
        `${actor.name} fights free of ${consumer.name}! ` +
        `(STR ${roll}+${strMod}=${total} vs DC ${data.saveDc})`
      );
      return this.popConsumeEvents();
    }

    // Save failed — take a per-turn HP tick.
    const dmg = data.damagePerTurn;
    actor.hp = Math.max(0, actor.hp - dmg);
    this.log.push(
      `${actor.name} is crushed inside ${consumer.name}! (-${dmg} HP) ` +
      `(STR ${roll}+${strMod}=${total} vs DC ${data.saveDc} — Failed!)`
    );
    this.pendingConsumeEvents.push({ targetId: actor.id, kind: "tick", damage: dmg });
    if (actor.hp === 0) {
      // Died inside — clear the debuff and drop the body out so it
      // can be revived later. The "released" event tells the scene
      // to make the corpse visible again.
      this.releaseConsumed(actor, consumer);
      this.log.push(`${actor.name}'s body tumbles out, lifeless.`);
    }
    return this.popConsumeEvents();
  }

  /**
   * Place a previously-consumed combatant back on the arena at a
   * free tile near `consumer` (or their original position if the
   * consumer is gone), clear their `consumed` marker, and queue a
   * `saved` event for the scene to animate.
   */
  private releaseConsumed(actor: Combatant, consumer: Combatant | null): void {
    const data = actor.consumed!;
    const anchor = consumer && consumer.hp > 0
      ? consumer.position
      : data.originalPosition;
    const newPos = this.findFreeTileNear(anchor) ?? anchor;
    actor.position = { ...newPos };
    actor.consumed = undefined;
    this.pendingConsumeEvents.push({ targetId: actor.id, kind: "saved" });
  }

  /** Pop every consumed actor whose consumer just died back onto the
   *  arena. Called from `attack()` and `castMonsterSpell` whenever
   *  damage drops a target to 0 HP. */
  private releaseAllConsumedBy(consumerId: string): void {
    for (const c of this.combatants) {
      if (!c.consumed || c.consumed.consumerId !== consumerId) continue;
      const consumer = this.combatants.find((x) => x.id === consumerId) ?? null;
      this.releaseConsumed(c, consumer);
      this.log.push(`${c.name} tumbles free as the beast falls!`);
    }
  }

  /** Spiral search for the first walkable, unoccupied tile within 5
   *  rings of `origin`. Returns null when the arena is jam-packed —
   *  the caller falls back to dropping at the origin tile. */
  private findFreeTileNear(origin: GridPos): GridPos | null {
    for (let r = 0; r <= 5; r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
          const c = origin.col + dc;
          const ro = origin.row + dr;
          if (!inBounds(c, ro) || this.isBlocked(c, ro)) continue;
          if (this.combatantAt(c, ro)) continue;
          return { col: c, row: ro };
        }
      }
    }
    return null;
  }

  /** Drain the queued consume-tick events so the scene can animate
   *  them. Each call empties the buffer. */
  popConsumeEvents(): ConsumeEvent[] {
    const out = this.pendingConsumeEvents;
    this.pendingConsumeEvents = [];
    return out;
  }

  /**
   * Walk the actor's `monsterSpells` table and return the first spell
   * intent whose dice roll passes `cast_chance` AND has a valid
   * target. Damage spells need an enemy in range; heal_self needs the
   * caster to be wounded; heal_ally needs a wounded same-side ally.
   * Returns null when nothing is castable this turn.
   */
  private maybePickSpell(actor: Combatant, enemies: Combatant[]): MonsterIntent | null {
    if (!actor.monsterSpells || actor.monsterSpells.length === 0) return null;
    for (let i = 0; i < actor.monsterSpells.length; i++) {
      const spell = actor.monsterSpells[i];
      const chance = spell.cast_chance | 0;
      if (chance <= 0) continue;
      const roll = Math.floor(this.rng() * 100) + 1;
      if (roll > chance) continue;

      // heal_self — only when wounded.
      if (spell.type === "heal_self") {
        if (actor.hp >= actor.maxHp) continue;
        return { kind: "spell", spellIndex: i };
      }
      // heal_ally — pick the lowest-HP wounded same-side ally.
      if (spell.type === "heal_ally") {
        const allies = this.alive(actor.side).filter((c) => c.id !== actor.id && c.hp < c.maxHp);
        if (allies.length === 0) continue;
        allies.sort((a, b) => a.hp - b.hp);
        const ally = allies[0];
        if (spell.range != null && chebyshev(actor.position, ally.position) > spell.range) continue;
        return { kind: "spell", spellIndex: i, targetId: ally.id };
      }
      // sleep — refuses targets above max_target_hp; closest enemy in range.
      if (spell.type === "sleep") {
        const max = spell.max_target_hp ?? Infinity;
        const candidates = enemies.filter((e) => e.maxHp <= max);
        const target = nearestInRange(actor, candidates, spell.range);
        if (!target) continue;
        return { kind: "spell", spellIndex: i, targetId: target.id };
      }
      // Everything else (breath_fire, magic_dart, magic_arrow, fireball,
      // lightning_bolt, poison, curse) targets the nearest enemy in range.
      const target = nearestInRange(actor, enemies, spell.range);
      if (!target) continue;
      return { kind: "spell", spellIndex: i, targetId: target.id };
    }
    return null;
  }

  /**
   * Resolve a spell from the active actor's `monsterSpells` table.
   * Mutates HP / status, appends a log line, and returns a brief
   * outcome the scene can animate. Used by the scene's monster-turn
   * loop after `decideMonsterIntent` returns a `kind: "spell"` intent.
   */
  castMonsterSpell(spellIndex: number, targetId?: string): {
    spellName: string;
    targetId: string;
    damage: number;
    heal: number;
    killed: boolean;
  } {
    const actor = this.current;
    const spell = actor.monsterSpells?.[spellIndex];
    if (!spell) {
      throw new Error(`No monster spell at index ${spellIndex} for ${actor.name}`);
    }
    let damage = 0;
    let heal = 0;
    let target: Combatant | null = null;

    if (spell.type === "heal_self") {
      heal = this.rollHealAmount(spell, actor);
      const before = actor.hp;
      actor.hp = Math.min(actor.maxHp, actor.hp + heal);
      heal = actor.hp - before;
      this.log.push(`${actor.name} casts ${spell.name} and recovers ${heal} HP.`);
      target = actor;
    } else if (spell.type === "heal_ally") {
      target = (targetId && this.byIdMaybe(targetId)) || null;
      if (!target) {
        this.log.push(`${actor.name} fizzles ${spell.name} — no target.`);
      } else {
        const amt = this.rollHealAmount(spell, target);
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + amt);
        heal = target.hp - before;
        this.log.push(
          `${actor.name} casts ${spell.name} on ${target.name} (+${heal} HP).`
        );
      }
    } else {
      // Damage / debuff spells.
      target = (targetId && this.byIdMaybe(targetId)) || null;
      if (!target) {
        this.log.push(`${actor.name} fizzles ${spell.name} — no target.`);
      } else {
        damage = this.rollMonsterSpellDamage(spell, target);
        if (damage > 0) target.hp = Math.max(0, target.hp - damage);
        const dealtMsg = damage > 0
          ? `${target.name} takes ${damage} damage`
          : `${target.name} resists`;
        this.log.push(`${actor.name} casts ${spell.name}! ${dealtMsg}.`);
        if (target.hp === 0) {
          this.releaseAllConsumedBy(target.id);
        }
        // Sleep / curse currently log only — the duration ticker for
        // monster-cast statuses is a follow-up.
      }
    }
    const tid = target?.id ?? actor.id;
    return {
      spellName: spell.name,
      targetId: tid,
      damage,
      heal,
      killed: target ? target.hp === 0 : false,
    };
  }

  /** Sum dice + bonus for a damage spell, halving fire-typed damage
   *  when the target has a `fire_resistance` passive. */
  private rollMonsterSpellDamage(spell: MonsterSpellLike, target: Combatant): number {
    const dice = spell.damage_dice ?? 0;
    const sides = spell.damage_sides ?? 0;
    const bonus = spell.damage_bonus ?? 0;
    if (dice <= 0 || sides <= 0) {
      // Pure-status spell (sleep / curse) with no damage payload.
      return 0;
    }
    let total = bonus;
    for (let i = 0; i < dice; i++) {
      total += Math.floor(this.rng() * sides) + 1;
    }
    if (spell.type === "breath_fire" || spell.type === "fireball") {
      if (hasPassive(target, "fire_resistance")) {
        const halved = Math.max(1, Math.floor(total / 2));
        this.log.push(`${target.name}'s fire resistance halves ${total} → ${halved}.`);
        return halved;
      }
    }
    return Math.max(1, total);
  }

  private rollHealAmount(spell: MonsterSpellLike, _target: Combatant): number {
    const dice = spell.heal_dice ?? 1;
    const sides = spell.heal_sides ?? 6;
    const bonus = spell.heal_bonus ?? 0;
    let total = bonus;
    for (let i = 0; i < dice; i++) {
      total += Math.floor(this.rng() * sides) + 1;
    }
    return Math.max(1, total);
  }

  private byIdMaybe(id: string): Combatant | null {
    return this.combatants.find((c) => c.id === id) ?? null;
  }

  /**
   * Roll each `onHitEffects` entry attached to the attacker against
   * the target after a successful melee hit. Currently handles:
   *
   *   - `drain`    — heal the attacker by `amount` (life-leech)
   *   - `consume`  — apply the per-turn damage debuff that ticks
   *                  in `tickConsumeDebuffs` until the victim saves
   *
   * Each effect rolls independently against its `chance` (0-100).
   */
  private applyOnHitEffects(attacker: Combatant, target: Combatant): void {
    if (!attacker.onHitEffects) return;
    for (const eff of attacker.onHitEffects) {
      const roll = Math.floor(this.rng() * 100) + 1;
      if (roll > eff.chance) continue;
      if (eff.type === "drain") {
        const before = attacker.hp;
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + eff.amount);
        const healed = attacker.hp - before;
        if (healed > 0) {
          this.log.push(`${attacker.name} drains ${healed} HP from ${target.name}.`);
        }
      } else if (eff.type === "consume") {
        // STR save vs the consume DC — pass twists free, fail is
        // swallowed whole. Mirrors `_apply_consume_effect` in
        // `src/states/combat.py:4714`.
        if (target.consumed) continue; // already inside something
        const strMod = Math.floor(((target.strength ?? 10) - 10) / 2);
        const roll = 1 + Math.floor(this.rng() * 20);
        const total = roll + strMod;
        if (total >= eff.save_dc) {
          this.log.push(
            `${target.name} twists free of ${attacker.name}'s jaws! ` +
            `(STR ${roll}+${strMod}=${total} vs DC ${eff.save_dc})`
          );
          continue;
        }
        // Save failed — swallow whole. Stash the original position so
        // we can release them near it later, then move off-board so
        // collision / targeting helpers don't see them.
        target.consumed = {
          damagePerTurn: eff.damage_per_turn,
          saveDc: eff.save_dc,
          consumerId: attacker.id,
          originalPosition: { ...target.position },
        };
        target.position = { col: -1, row: -1 };
        this.log.push(
          `${attacker.name} swallows ${target.name} whole! ` +
          `(STR ${roll}+${strMod}=${total} vs DC ${eff.save_dc} — Failed!)`
        );
        this.pendingConsumeEvents.push({
          targetId: target.id, kind: "applied", consumerId: attacker.id,
        });
      }
    }
  }

  private advanceToAlive(): void {
    if (this.byId(this.initiativeOrder[this.cursor].combatantId).hp > 0) return;
    this.endTurn();
  }

  private refillMovePoints(): void {
    // baseMoveRange + race-passive `extraMoveRange` (Elf Nimble: +3)
    // + active range_bonus buffs (Long Shanks). Mirrors the Python
    // game's per-turn refill: the class budget, the race's innate
    // bonus, and any currently-stacked buffs sum into one budget.
    const racial = this.current.extraMoveRange ?? 0;
    const bonus = sumBuff(this.buffs.get(this.current.id), "range_bonus");
    this.movePoints = this.current.baseMoveRange + racial + bonus;
    // Fresh turn — the actor hasn't swung yet, so the bump-attack
    // gate reopens. Paired with the lock in `tryMove`'s bump branch.
    this.attackedThisTurn = false;
  }
}
