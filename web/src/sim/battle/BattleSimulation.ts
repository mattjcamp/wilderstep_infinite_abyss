/**
 * BattleSimulation — pure kernel for v1-style tactical combat on a
 * grid. Mirrors `_v1_reference/.../combat/Combat.ts`:
 *
 *   - Initiative rolled at start (d20 + DEX_mod) — sorted descending,
 *     ties broken by DEX then by combatants index.
 *   - Move points refill per turn from the combatant's `moveRange`.
 *   - Cardinal step movement via `tryMove(direction)`. Walking into
 *     an adjacent enemy resolves a bump-attack and consumes ALL
 *     remaining move points (matching v1's `tryMove` bump rule).
 *   - `endTurn()` advances the cursor to the next alive combatant
 *     and refills points.
 *   - `nextMonsterIntent()` returns one step at a time so the host
 *     can animate between actions; resolve via `tryMove` /
 *     `attackTarget` and call again until `kind === "wait"`.
 *   - Non-movement actions (Cast, Use Ability, "Attack" shortcut)
 *     come in through `submitAction`. Attack-from-the-menu finds
 *     an adjacent enemy and bumps into them.
 *
 * What we deliberately DON'T model in this pass:
 *   - Buffs / debuffs (bless, curse, range_buff) with round-end ticks.
 *   - Backstab / Shadow Step class abilities.
 *   - Range / Throw / Use Item / Equip Item action flows.
 *   - On-hit effects (drain, poison, charm).
 *   - VFX timing — events fire instantly; host adds delays if needed.
 *
 * Those can land in future passes without breaking the kernel's
 * public surface.
 */

import type {
  BattleAction,
  BattleCombatant,
  BattleDirection,
  BattleEvent,
  BattleEventListener,
  BattlePos,
  BattleState,
  MonsterIntent,
  MoveResult,
} from "./types";

/** Minimal Spell shape the kernel reads. */
export interface BattleSpell {
  id: string;
  name?: string;
  mp_cost?: number;
  range?: number;
  action?: string;
  usable_in?: string[];
  targeting?: string;
  action_params?: Record<string, unknown> | null;
}

/** Minimal Ability shape the kernel reads. */
export interface BattleAbility {
  id: string;
  name?: string;
  usable_in?: string[];
  params?: Record<string, unknown> | null;
}
import { BATTLE_DIR_DELTAS, MELEE_RANGE } from "./types";
import {
  abilityMod,
  chebyshev,
  rollAttack,
  rollDamage,
  rollDie,
  type WalkablePredicate,
} from "./movement";

export interface BattleSetupOptions {
  cols?: number;
  rows?: number;
  combatants: BattleCombatant[];
  walkable?: WalkablePredicate;
}

export class BattleSimulation {
  private state: BattleState;
  private readonly listeners = new Set<BattleEventListener>();
  private readonly spellById: Map<string, BattleSpell>;
  private readonly abilityById: Map<string, BattleAbility>;
  private readonly walkable?: WalkablePredicate;
  private xpPool = 0;
  private goldPool = 0;

  constructor(
    opts: BattleSetupOptions,
    catalogs: {
      spells: ReadonlyArray<BattleSpell>;
      abilities: ReadonlyArray<BattleAbility>;
    } = { spells: [], abilities: [] },
  ) {
    this.spellById = new Map(catalogs.spells.map((s) => [s.id, s]));
    this.abilityById = new Map(catalogs.abilities.map((a) => [a.id, a]));
    this.walkable = opts.walkable;

    this.xpPool = opts.combatants
      .filter((c) => c.side === "monster")
      .reduce((sum, m) => sum + (m.xpReward ?? 0), 0);

    // Initiative — v1 rolls d20 + DEX_mod for every combatant, sorts
    // descending. Ties: higher DEX_mod first, then stable by index.
    type Roll = {
      id: string;
      total: number;
      raw: number;
      dexMod: number;
      idx: number;
    };
    const rolls: Roll[] = opts.combatants.map((c, idx) => {
      const dexMod = abilityMod(c.dexterity ?? 10);
      const raw = rollDie(20);
      return { id: c.id, total: raw + dexMod, raw, dexMod, idx };
    });
    rolls.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.dexMod !== a.dexMod) return b.dexMod - a.dexMod;
      return a.idx - b.idx;
    });
    const initiativeOrder = rolls.map((r) => r.id);

    this.state = {
      cols: opts.cols ?? 0,
      rows: opts.rows ?? 0,
      combatants: opts.combatants,
      initiativeOrder,
      activeIndex: 0,
      movePoints: 0,
      round: 1,
      outcome: { kind: "in_progress" },
    };
    // Skip past any combatant that started dead (unlikely; defensive).
    this.advanceToAlive(0);
    this.refillMovePoints();
    this.emit({ kind: "round_started", round: 1 });
    this.emitTurnStart();
  }

  // ── Public surface ──────────────────────────────────────────────

  subscribe(listener: BattleEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): BattleState {
    return {
      ...this.state,
      combatants: this.state.combatants.map((c) => ({ ...c })),
      initiativeOrder: [...this.state.initiativeOrder],
    };
  }

  activeCombatant(): BattleCombatant | null {
    const id = this.state.initiativeOrder[this.state.activeIndex];
    if (!id) return null;
    return this.state.combatants.find((c) => c.id === id) ?? null;
  }

  /** Cardinal step. Walking into an adjacent enemy resolves a melee
   *  attack (bump-attack) and consumes ALL remaining move points.
   *  Walking into a wall / out-of-bounds / ally → blocked, no points
   *  spent. */
  tryMove(direction: BattleDirection): MoveResult {
    if (this.state.outcome.kind !== "in_progress") {
      return { kind: "blocked", reason: "out-of-turn" };
    }
    const actor = this.activeCombatant();
    if (!actor || actor.dead) {
      return { kind: "blocked", reason: "out-of-turn" };
    }
    if (this.state.movePoints <= 0) {
      return { kind: "blocked", reason: "no-points" };
    }
    const [dc, dr] = BATTLE_DIR_DELTAS[direction];
    const nc = actor.pos.col + dc;
    const nr = actor.pos.row + dr;
    if (
      nc < 0 ||
      nr < 0 ||
      nc >= this.state.cols ||
      nr >= this.state.rows
    ) {
      return { kind: "blocked", reason: "out-of-bounds" };
    }
    if (this.walkable && !this.walkable(nc, nr)) {
      return { kind: "blocked", reason: "wall" };
    }

    const occupant = this.combatantAt(nc, nr);
    if (occupant) {
      if (occupant.side === actor.side) {
        return { kind: "blocked", reason: "ally" };
      }
      // Bump-attack: resolve melee, zero remaining points, end turn
      // implicitly (the host should call endTurn after).
      const result = this.attackCombatant(actor, occupant);
      this.state.movePoints = 0;
      return {
        kind: "attacked",
        attackerId: actor.id,
        targetId: occupant.id,
        hit: result.hit,
        damage: result.damage,
        killed: result.killed,
      };
    }

    const from = { ...actor.pos };
    actor.pos = { col: nc, row: nr };
    this.state.movePoints -= 1;
    this.emit({
      kind: "moved",
      combatantId: actor.id,
      from,
      to: { ...actor.pos },
    });
    this.maybeFinish();
    return {
      kind: "moved",
      from,
      to: { ...actor.pos },
      pointsLeft: this.state.movePoints,
    };
  }

  /** Submit a non-movement action. Attack from this surface is the
   *  v1 shortcut: find any adjacent enemy and bump into them. */
  submitAction(action: BattleAction): void {
    if (this.state.outcome.kind !== "in_progress") return;
    const actor = this.activeCombatant();
    if (!actor || actor.side !== "party" || actor.dead) {
      this.emit({
        kind: "illegal",
        combatantId: actor?.id ?? "?",
        reason: "Not your turn.",
      });
      return;
    }
    switch (action.kind) {
      case "attack":
        this.resolveAttackShortcut(actor);
        return;
      case "cast":
        this.resolveCast(actor, action.spellId, action.targetId);
        return;
      case "use_ability":
        this.resolveAbility(actor, action.abilityId);
        return;
      case "end_turn":
        this.endTurn();
        return;
    }
  }

  /** Advance to the next alive combatant. Public so the host can
   *  invoke it as the explicit "End Turn" action. */
  endTurn(): void {
    if (this.state.outcome.kind !== "in_progress") return;
    const n = this.state.initiativeOrder.length;
    if (n === 0) return;
    let i = (this.state.activeIndex + 1) % n;
    const startedAt = this.state.activeIndex;
    let wrapped = false;
    for (let step = 0; step < n; step++) {
      if (i <= startedAt && step > 0 && !wrapped) {
        wrapped = true;
      }
      const id = this.state.initiativeOrder[i];
      const c = this.state.combatants.find((x) => x.id === id);
      if (c && !c.dead) {
        this.state.activeIndex = i;
        if (wrapped) {
          this.state.round += 1;
          this.emit({ kind: "round_started", round: this.state.round });
        }
        this.refillMovePoints();
        this.emitTurnStart();
        return;
      }
      i = (i + 1) % n;
    }
    // Every combatant is dead — let outcome detection handle it.
    this.maybeFinish();
  }

  /** Step-by-step monster AI. Caller pumps this method, resolves the
   *  returned intent via tryMove (for "step"/"bump"), and calls
   *  again until the kernel returns "wait" — then endTurn(). Pattern
   *  matches v1's CombatScene monster loop. */
  nextMonsterIntent(): MonsterIntent {
    const actor = this.activeCombatant();
    if (!actor || actor.dead || !actor.aiControlled) {
      return { kind: "wait" };
    }
    if (this.state.movePoints <= 0) return { kind: "wait" };

    // Pick a hostile target on the opposing side.
    const enemySide = actor.side === "monster" ? "party" : "monster";
    const enemies = this.state.combatants.filter(
      (c) => c.side === enemySide && !c.dead,
    );
    if (enemies.length === 0) return { kind: "wait" };

    // Adjacent? Bump the lowest-HP one (focus fire).
    const adjacent = enemies
      .filter((e) => chebyshev(actor.pos, e.pos) === MELEE_RANGE)
      .sort((a, b) => a.hp - b.hp);
    if (adjacent.length > 0) {
      const target = adjacent[0];
      const dc = Math.sign(target.pos.col - actor.pos.col);
      const dr = Math.sign(target.pos.row - actor.pos.row);
      const dir = directionFor(dc, dr);
      if (dir)
        return { kind: "bump", direction: dir, targetId: target.id };
      // Diagonally adjacent (Chebyshev=1 but not cardinal). Step
      // closer cardinally first.
      return this.stepTowardIntent(actor, target.pos);
    }
    // Pursue the nearest target with a cardinal step.
    const nearest = enemies.reduce((best, e) =>
      chebyshev(actor.pos, e.pos) < chebyshev(actor.pos, best.pos) ? e : best,
    );
    return this.stepTowardIntent(actor, nearest.pos);
  }

  /** Helper for monster AI: returns the best cardinal step toward
   *  `target.pos`, or wait when no direction makes progress. */
  private stepTowardIntent(
    actor: BattleCombatant,
    targetPos: BattlePos,
  ): MonsterIntent {
    let bestDir: BattleDirection | null = null;
    let bestDist = chebyshev(actor.pos, targetPos);
    const dirs: BattleDirection[] = ["n", "s", "e", "w"];
    for (const dir of dirs) {
      const [dc, dr] = BATTLE_DIR_DELTAS[dir];
      const nc = actor.pos.col + dc;
      const nr = actor.pos.row + dr;
      if (nc < 0 || nc >= this.state.cols) continue;
      if (nr < 0 || nr >= this.state.rows) continue;
      if (this.walkable && !this.walkable(nc, nr)) continue;
      const occupant = this.combatantAt(nc, nr);
      if (occupant && occupant.side === actor.side) continue;
      const d = chebyshev({ col: nc, row: nr }, targetPos);
      if (d < bestDist) {
        bestDir = dir;
        bestDist = d;
      }
    }
    if (!bestDir) return { kind: "wait" };
    // If the chosen step lands on the target, it's a bump-attack.
    const [dc, dr] = BATTLE_DIR_DELTAS[bestDir];
    const occ = this.combatantAt(
      actor.pos.col + dc,
      actor.pos.row + dr,
    );
    if (occ && occ.side !== actor.side && !occ.dead) {
      return { kind: "bump", direction: bestDir, targetId: occ.id };
    }
    return { kind: "step", direction: bestDir };
  }

  addGold(amount: number): void {
    this.goldPool += amount;
  }

  // ── Resolution helpers ─────────────────────────────────────────

  /** Find any adjacent enemy and bump into them — v1's Attack menu
   *  action behavior. No adjacency → log a hint, turn doesn't end. */
  private resolveAttackShortcut(actor: BattleCombatant): void {
    const dirs: BattleDirection[] = ["n", "s", "e", "w"];
    for (const dir of dirs) {
      const [dc, dr] = BATTLE_DIR_DELTAS[dir];
      const occ = this.combatantAt(
        actor.pos.col + dc,
        actor.pos.row + dr,
      );
      if (occ && occ.side !== actor.side && !occ.dead) {
        this.tryMove(dir); // resolves bump-attack inline
        return;
      }
    }
    this.emit({
      kind: "log",
      message: `${actor.name} has no adjacent enemy to attack.`,
    });
  }

  /** Resolve a melee swing from `attacker` to `target`. Returns the
   *  attack outcome and emits the corresponding event + log. */
  private attackCombatant(
    attacker: BattleCombatant,
    target: BattleCombatant,
  ): { hit: boolean; damage: number; killed: boolean } {
    const targetAc = target.ac;
    const { roll, total, hit } = rollAttack(attacker.attackBonus, targetAc);
    if (!hit) {
      this.emit({
        kind: "attack",
        attackerId: attacker.id,
        targetId: target.id,
        hit: false,
        roll,
        total,
        attackerAttackBonus: attacker.attackBonus,
        targetAc,
        damage: 0,
        killed: false,
        weaponName: attacker.weaponName ?? undefined,
      });
      const bonusStr = signed(attacker.attackBonus);
      this.emit({
        kind: "log",
        message: `${attacker.name} swings at ${target.name} (d20:${roll}${bonusStr}=${total} vs AC${targetAc}) — miss.`,
      });
      return { hit: false, damage: 0, killed: false };
    }
    const dmg = rollDamage(
      attacker.damage.dice,
      attacker.damage.sides,
      attacker.damage.bonus,
    );
    target.hp = Math.max(0, target.hp - dmg);
    const killed = target.hp <= 0;
    if (killed) target.dead = true;
    this.emit({
      kind: "attack",
      attackerId: attacker.id,
      targetId: target.id,
      hit: true,
      roll,
      total,
      attackerAttackBonus: attacker.attackBonus,
      targetAc,
      damage: dmg,
      killed,
      weaponName: attacker.weaponName ?? undefined,
    });
    const bonusStr = signed(attacker.attackBonus);
    this.emit({
      kind: "log",
      message: `${attacker.name} hits ${target.name} (d20:${roll}${bonusStr}=${total} vs AC${targetAc}) — ${dmg} dmg${killed ? ", defeated!" : "."}`,
    });
    if (killed) {
      this.emit({ kind: "killed", combatantId: target.id });
      this.maybeFinish();
    }
    return { hit: true, damage: dmg, killed };
  }

  private resolveCast(
    actor: BattleCombatant,
    spellId: string,
    targetId: string | null,
  ): void {
    const spell = this.spellById.get(spellId);
    if (!spell) {
      this.emit({
        kind: "illegal",
        combatantId: actor.id,
        reason: `Unknown spell "${spellId}".`,
      });
      return;
    }
    if (!(spell.usable_in ?? []).includes("battle")) {
      this.emit({
        kind: "illegal",
        combatantId: actor.id,
        reason: `${spell.name ?? spellId} can't be cast in battle.`,
      });
      return;
    }
    const cost = spell.mp_cost ?? 0;
    if (actor.mp < cost) {
      this.emit({
        kind: "illegal",
        combatantId: actor.id,
        reason: "Not enough MP.",
      });
      return;
    }
    actor.mp -= cost;
    const target = targetId
      ? this.state.combatants.find((c) => c.id === targetId) ?? null
      : null;
    const ap = (spell.action_params ?? {}) as Record<string, unknown>;
    let value: number | undefined;
    let effectLabel = spell.name ?? spell.id;
    if (spell.action === "damage" && target && !target.dead) {
      const dice = num(ap.dice_count, 1);
      const sides = num(ap.dice_sides, 6);
      const stat = String(ap.stat_bonus ?? "intelligence");
      const bonus = abilityMod(
        actor[stat as keyof BattleCombatant] as number,
      );
      const min = num(ap.min_damage, 1);
      const dmg = rollDamage(dice, sides, bonus, min);
      target.hp = Math.max(0, target.hp - dmg);
      value = dmg;
      effectLabel = `damage ${dmg}`;
      if (target.hp <= 0) {
        target.dead = true;
        this.emit({ kind: "killed", combatantId: target.id });
      }
    } else if (spell.action === "heal" && target && !target.dead) {
      const dice = num(ap.dice_count, 1);
      const sides = num(ap.dice_sides, 6);
      const stat = String(ap.stat_bonus ?? "wisdom");
      const bonus = abilityMod(
        actor[stat as keyof BattleCombatant] as number,
      );
      const min = num(ap.min_heal, 1);
      const healed = rollDamage(dice, sides, bonus, min);
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + healed);
      value = target.hp - before;
      effectLabel = `heal ${value}`;
    } else if (spell.action === "apply_effect") {
      effectLabel = `applied ${String(ap.effect_id ?? "effect")}`;
    } else {
      effectLabel = "preview only";
    }
    this.emit({
      kind: "cast",
      casterId: actor.id,
      spellId: spell.id,
      targetId: target?.id ?? null,
      effect: effectLabel,
      value,
    });
    this.emit({
      kind: "log",
      message: `${actor.name} casts ${spell.name ?? spellId}${
        target ? ` on ${target.name}` : ""
      } — ${effectLabel}.`,
    });
    // v1 casting consumes the turn — end it after the resolve.
    this.maybeFinish();
    if (this.state.outcome.kind === "in_progress") {
      this.state.movePoints = 0;
    }
  }

  private resolveAbility(
    actor: BattleCombatant,
    abilityId: string,
  ): void {
    const ability = this.abilityById.get(abilityId);
    if (!ability) {
      this.emit({
        kind: "illegal",
        combatantId: actor.id,
        reason: `Unknown ability "${abilityId}".`,
      });
      return;
    }
    if (!(ability.usable_in ?? []).includes("battle")) {
      this.emit({
        kind: "illegal",
        combatantId: actor.id,
        reason: `${ability.name ?? abilityId} isn't usable in battle.`,
      });
      return;
    }
    let effect = "preview only";
    if (abilityId === "turn_undead") {
      const undeadAlive = this.state.combatants.filter(
        (c) => !c.dead && c.side === "monster",
      );
      effect = `targeted ${undeadAlive.length} enemy/enemies`;
    }
    this.emit({
      kind: "ability",
      casterId: actor.id,
      abilityId,
      effect,
    });
    this.emit({
      kind: "log",
      message: `${actor.name} uses ${ability.name ?? abilityId} — ${effect}.`,
    });
    // Abilities also consume the turn in v1.
    this.state.movePoints = 0;
  }

  // ── Internals ──────────────────────────────────────────────────

  private combatantAt(col: number, row: number): BattleCombatant | null {
    for (const c of this.state.combatants) {
      if (c.dead) continue;
      if (c.pos.col === col && c.pos.row === row) return c;
    }
    return null;
  }

  private refillMovePoints(): void {
    const c = this.activeCombatant();
    this.state.movePoints = c?.moveRange ?? 0;
  }

  private emit(event: BattleEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  private emitTurnStart(): void {
    const c = this.activeCombatant();
    if (c) this.emit({ kind: "turn_started", combatantId: c.id });
  }

  private advanceToAlive(startIndex: number): void {
    const n = this.state.initiativeOrder.length;
    if (n === 0) return;
    for (let k = 0; k < n; k++) {
      const i = (startIndex + k) % n;
      const id = this.state.initiativeOrder[i];
      const c = this.state.combatants.find((x) => x.id === id);
      if (c && !c.dead) {
        this.state.activeIndex = i;
        return;
      }
    }
  }

  private maybeFinish(): void {
    if (this.state.outcome.kind !== "in_progress") return;
    const partyAlive = this.state.combatants.some(
      (c) => c.side === "party" && !c.dead,
    );
    const monsterAlive = this.state.combatants.some(
      (c) => c.side === "monster" && !c.dead,
    );
    if (!monsterAlive) {
      this.state.outcome = {
        kind: "victory",
        xpEarned: this.xpPool,
        goldEarned: this.goldPool,
      };
      this.emit({ kind: "outcome", outcome: this.state.outcome });
    } else if (!partyAlive) {
      this.state.outcome = { kind: "defeat" };
      this.emit({ kind: "outcome", outcome: this.state.outcome });
    }
  }
}

// ── Inline helpers ─────────────────────────────────────────────────

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function directionFor(dc: number, dr: number): BattleDirection | null {
  if (dc === 0 && dr === -1) return "n";
  if (dc === 0 && dr === 1) return "s";
  if (dc === 1 && dr === 0) return "e";
  if (dc === -1 && dr === 0) return "w";
  return null;
}

