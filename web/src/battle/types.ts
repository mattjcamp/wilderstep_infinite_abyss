/**
 * Shared types for the combat layer. Mirrors the relevant subset of the
 * Python Monster / Fighter classes — only the fields combat actually
 * needs. Other gameplay state (terrain, spells, on-hit effects, etc.)
 * will be added as later slices port more behaviour.
 */

export type Side = "party" | "enemies";

export interface DamageRoll {
  dice: number;
  sides: number;
  bonus: number;
}

export interface Combatant {
  /** Stable id for matching across UI and engine state. */
  id: string;
  name: string;
  side: Side;
  maxHp: number;
  hp: number;
  ac: number;
  attackBonus: number;
  damage: DamageRoll;
  /** D&D ability modifier for DEX, used for initiative. */
  dexMod: number;
  /** PartyMember class (capitalised — "Thief", "Ranger", …) for
   *  combatants on the party side. Optional because monster
   *  combatants and legacy test fixtures omit it. Read by class-
   *  gated mechanics like Thief Backstab + Shadow Step. */
  charClass?: string;
  /** Race id (snake_case) — references races.json. Stamped from
   *  the PartyMember for party-side combatants. Optional for
   *  monsters and legacy fixtures. Read by race-gated rendering
   *  like the infravision overlay (Dwarf only). */
  race?: string;
  /** Character level, used by class-gated ability cutoffs
   *  (Backstab @ 3+, Shadow Step @ 7+, Ranger Pick Locks @ 3+).
   *  Optional for the same reason as `charClass`. */
  level?: number;
  /** Name of the weapon equipped in the active hand at combat-start.
   *  Read by Backstab (the dagger gate). Null when fighting unarmed;
   *  undefined for monsters and legacy fixtures. */
  weaponName?: string | null;
  /** Extra damage dice the equipped weapon adds on hit — Sun Sword's
   *  1d6 fire, etc. Accepts the same int / "NdM" forms as the
   *  items.json `bonus_damage` field. Crits double the dice count.
   *  Absent for ordinary weapons. */
  weaponBonusDamage?: string | number;
  /** Damage school the equipped weapon deals — "fire", "cold", …
   *  Surfaced in the combat log so the player sees the magical flavor.
   *  Treated as "physical" when absent. */
  weaponDamageType?: string;
  /** True when the equipped weapon is a ranged weapon (`ranged: true`
   *  in items.json — bows, crossbows, slings, wands). The melee
   *  `attack()` path reads this to SKIP the weapon's `bonus_damage`
   *  on a bump attack: a crossbow's lightning (etc.) is a ranged
   *  payload and should only fire on a Range shot (see
   *  `resolveThrow`), not when the wielder clubs someone with the
   *  stock. Absent / false for melee weapons, so their bonus still
   *  lands on every swing. */
  weaponRanged?: boolean;
  /** Packed RGB for the relic-tier "this weapon is powerful" aura
   *  the CombatScene draws beneath the wielder's body. Stamped on
   *  by the CombatBridge from the equipped weapon's `combat_aura`
   *  field; the scene re-pulses a ring of this color every ~0.7s
   *  while the combatant is alive. Absent for ordinary weapons —
   *  the scene falls through to its no-aura render path. */
  wieldAuraColor?: number;
  /** Full ability scores carried over from the PartyMember (or
   *  monster spec). Optional because legacy fixtures and some of the
   *  combat tests omit them — combat helpers default each to 10
   *  (modifier +0) when they're missing. Used by spell-damage code so
   *  Magic Arrow can read the caster's INT and Heal can read WIS. */
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  /** Fallback portrait colour (RGB 0-255) if no sprite is loaded. */
  color: [number, number, number];
  /**
   * Optional path to a 32×32 sprite under `/assets/`. When present the
   * combat scene draws the image; when absent it falls back to the
   * coloured rectangle. Test fixtures omit this freely.
   */
  sprite?: string;
  /**
   * Tile movement budget per turn. Refreshed at the start of every turn
   * by the Combat controller. For party members this comes from the
   * class template's `range`; for monsters from `move_range`.
   */
  baseMoveRange: number;
  /** Additional tiles added on top of `baseMoveRange` at every
   *  turn refill — race-granted passive movement, today only the
   *  Elf's Nimble ability (+3). Kept as a separate field rather
   *  than folded into baseMoveRange so the HUD's `Moves: x/base`
   *  readout can still expose the class-natural budget if it ever
   *  wants to, and so a future "stat sheet" surface can show the
   *  racial contribution as a discrete line. Absent for
   *  combatants whose race grants no movement bonus. */
  extraMoveRange?: number;
  /**
   * Position on the arena grid. Initial value is irrelevant — the
   * Combat constructor lays out party and enemies into starting
   * formations and overwrites whatever the caller passed.
   */
  position: { col: number; row: number };
  /**
   * True for undead monsters (skeletons, zombies, liches, …). Mirrors
   * the `undead` flag in monsters.json. Read by Turn Undead so the
   * spell only affects creatures it's supposed to.
   */
  undead?: boolean;
  /**
   * Elite undead's bonus on Turn Undead saving throws (vampires,
   * liches, …). Mirrors `turn_resistance` in monsters.json. Any
   * value > 0 also marks the creature as too powerful to destroy
   * outright: a failed save TURNS it (flees/cowers for 1d4 turns)
   * instead of setting HP to 0. Lesser undead omit the field.
   */
  turnResistance?: number;
  /**
   * Runtime counter — turns remaining of the "turned" state applied
   * by Turn Undead on a resistant elite. While > 0 the AI flees from
   * the party (or cowers when cornered) instead of acting; ticked
   * down at the end of each of the creature's own turns in
   * `Combat.endTurn`. Never persisted; combat-local only.
   */
  turnedTurns?: number;
  /** XP awarded to each surviving party member when this enemy dies.
   *  Summed across all defeated enemies on victory and shared with
   *  every alive party member (matches the Python game). */
  xpReward?: number;
  /** Gold this enemy drops on death. Rolled once at spawn so it stays
   *  stable for the encounter; summed across kills on victory. */
  goldReward?: number;
  /**
   * When true, the Combat controller / scene drive this actor through
   * the monster-AI loop instead of the player input UI. Defaults to
   * false for party members and true for enemies. Summoned allies
   * (Animate Dead) live on `side: "party"` but with this flag set so
   * they fight on their own without the player picking actions.
   */
  aiControlled?: boolean;
  /**
   * Multi-tile sprite scale (default 1). Read by CombatScene so a
   * Dragon (`battle_scale: 2`) renders at 2× the normal tile size on
   * the arena grid.
   */
  battleScale?: number;
  /** Spell-casting AI table (Dragon's Fire Breath, Lich's Fireball,
   *  Troll's Self Heal, …). Forwarded from `MonsterSpec` so the AI
   *  loop can roll cast_chance without re-looking-up the catalog. */
  monsterSpells?: import("./data/monsters").MonsterSpell[];
  /** Always-on effects applied each round in `Combat.endTurn` —
   *  regen, fire_resistance, poison_immunity. */
  passives?: import("./data/monsters").MonsterPassive[];
  /** Effects rolled on a successful melee hit — drain HP from victim,
   *  Man Eater "consume" debuff, …. */
  onHitEffects?: import("./data/monsters").MonsterOnHit[];
  /** Tiles the actor has left to spend AFTER a bump-attack, in
   *  place of the normal "attack zeros all movement" rule. Set on
   *  party members whose race grants Nimble (`post_attack_range`
   *  from abilities.json — Elves get 2) and on monster specs
   *  declaring `post_attack_move` (Dragons: 2, for hit-and-run).
   *
   *  Composition with Thief Shadow Step: a level-7+ Thief who
   *  KILLS with a bump retains ALL their remaining movement,
   *  short-circuiting this field. On any other bump-attack
   *  outcome (hit, miss, hit-but-no-kill), `postAttackMove` is
   *  what the engine sets `movePoints` to (replacing the
   *  default-zero). Absent / 0 = legacy behaviour: the attack
   *  ends the turn. */
  postAttackMove?: number;
  /** True for humanoid monsters (Orcs, Goblins, Trolls, Dark Mages…).
   *  Charm-style spells filter on this. */
  humanoid?: boolean;
  /**
   * Generic runtime status effects sitting on this combatant, applied
   * through the effect runtime (`combat/effects/EffectRuntime.ts`) and
   * keyed by `effect_id`. The handler for each id owns its mechanics —
   * e.g. `consumed` (swallowed whole) moves the bearer off-board to
   * `{-1,-1}`, takes over their turn, and ticks crush damage until they
   * save free. Read via the effect helpers (`isConsumed`,
   * `consumedEffect`, `findEffect`) rather than poking at this directly.
   *
   * This replaces the old bespoke `consumed` field; see
   * `docs/dev_guides/effect_decoupling_proposal.md`.
   */
  effects?: import("./combat/effects/EffectRuntime").ActiveEffect[];
}

/**
 * Result of a single attack action — what the engine returns to the
 * scene so it can animate hit/miss/crit feedback.
 */
export interface AttackResult {
  attackerId: string;
  targetId: string;
  hit: boolean;
  /** Raw d20 roll, before modifiers. */
  roll: number;
  /** d20 + attackBonus. */
  total: number;
  critical: boolean;
  /** True when a Thief's Backstab promoted a normal hit to a crit.
   *  Always implies `critical === true`. The scene reads this flag to
   *  play the dedicated stinger animation/log line. */
  backstab?: boolean;
  /** True when the attacker met the Backstab prerequisites
   *  (`canBackstab` passed) AND the engine actually rolled the DEX-
   *  vs-DC-12 save — regardless of whether the save succeeded. The
   *  scene reads this to surface a "missed the opening" floater on
   *  failure so the player can SEE that the ability was attempted
   *  (the user reported confusion about whether Backstab was firing
   *  at all when the save kept failing silently). When
   *  `backstabAttempted` is true and `backstab` is false, the save
   *  rolled but missed; when `backstab` is true, `backstabAttempted`
   *  is also true. */
  backstabAttempted?: boolean;
  /** True when the attack triggered the Thief's Shadow Step — a
   *  killing bump that left the attacker's remaining movement
   *  intact instead of zeroing it. Set inside `Combat.tryMove`'s
   *  bump branch (the field rides on the same AttackResult the
   *  scene already consumes for backstab / killed / damage). The
   *  scene reads this flag to start a brief "thief is in shadow
   *  step" pulse on the attacker's body sprite — a subtle visual
   *  cue that the ability fired without overshadowing the
   *  Backstab punch. */
  shadowStepped?: boolean;
  /** True when the Paladin's Smite Undead doubled the rolled damage
   *  on this swing (attacker is a Paladin, target carries the
   *  `undead` flag, and the strike landed). The scene reads this to
   *  paint a holy / gold burst over the target plus a "SMITE!" label
   *  — the cue family that matches Backstab / Shadow Step so the
   *  player can recognise "an active ability just fired" at a
   *  glance. The damage field on the result already reflects the
   *  doubled total, so no separate "smite damage" math is needed. */
  smiteUndead?: boolean;
  /** Damage dealt; 0 on miss. */
  damage: number;
  /** Portion of `damage` that came from the weapon's magic
   *  `bonus_damage` roll (Sun Sword's fire, Stormbolt Crossbow's
   *  lightning, …). 0 / absent when the weapon has no bonus or the
   *  attack missed. Surfaced so ranged/throw log lines can show the
   *  "[base+bonus]" breakdown the melee path already prints. */
  bonusDamage?: number;
  /** Damage school of the weapon's bonus damage ("fire", "lightning",
   *  …) — drives the "(lightning)" tag in the log. Absent for plain
   *  physical attacks. */
  damageType?: string;
  /** Was the target reduced to 0 HP by this attack? */
  killed: boolean;
}

export interface InitiativeRoll {
  combatantId: string;
  total: number;
  raw: number;
}
