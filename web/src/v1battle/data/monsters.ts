/**
 * Monster catalog — reads v2's module-scoped monsters.json natively.
 *
 * v2 differences (canonical model):
 *   - One flat `monsters` array (not a name-keyed dict). Primary key
 *     is `id` (snake_case).
 *   - JSON field names are snake_case throughout (`attack_bonus`,
 *     `damage_dice`, `xp_reward`, `gold_min`, `move_range`, `sprite`,
 *     `battle_scale`, `post_attack_move`, …).
 *   - `sprite` is a folder-relative path under `/sprites/` (v2's
 *     asset root) — e.g. `"monster/giant_rat.png"`. v1 used a `tile`
 *     field pointing at `/assets/monsters/...`; we resolve v2's
 *     shape to a full `/sprites/<path>` URL at load time.
 *   - v1 had `color` (RGB fallback) and `terrain` (land/sea). v2
 *     dropped both. The Combatant model still carries `color` as a
 *     sprite-missing fallback, so makeMonsterByName seeds it from a
 *     neutral default.
 *   - v1's `spells` / `passives` / `on_hit_effects` arrays aren't in
 *     v2's monsters.json yet. Their TypeScript shapes stay on the
 *     spec so v2 can layer them back in without code churn.
 */

import type { Combatant } from "../types";
import { modulePath, withBase } from "../world/Module";

export interface MonsterSpec {
  /** Snake_case identifier from v2's monsters.json (Map key). */
  id: string;
  name: string;
  hp: number;
  ac: number;
  attack_bonus: number;
  damage_dice: number;
  damage_sides: number;
  damage_bonus: number;
  /** Resolved URL the Phaser preloader can pull. Built at load time
   *  from the v2 `sprite` field. */
  sprite: string;
  move_range: number;
  undead?: boolean;
  humanoid?: boolean;
  xp_reward?: number;
  gold_min?: number;
  gold_max?: number;
  /** Multi-tile sprite scale (1 = 32×32, 2 = 64×64 for bosses). */
  battle_scale?: number;
  post_attack_move?: number;
  difficulty?: string;
  /** Spell-casting AI table. Each entry has a `cast_chance` (0-100)
   *  the engine rolls against on the monster's turn. Reserved for v2
   *  to layer back in; absent today. */
  spells?: MonsterSpell[];
  /** Always-on effects — regen, fire/poison resistance. Reserved. */
  passives?: MonsterPassive[];
  /** Triggered effects on a successful melee hit. Reserved. */
  on_hit_effects?: MonsterOnHit[];
}

export type MonsterSpellType =
  | "breath_fire"
  | "magic_dart"
  | "magic_arrow"
  | "fireball"
  | "lightning_bolt"
  | "sleep"
  | "curse"
  | "poison"
  | "heal_self"
  | "heal_ally";

export interface MonsterSpell {
  type: MonsterSpellType;
  name: string;
  cast_chance: number;
  range?: number;
  damage_dice?: number;
  damage_sides?: number;
  damage_bonus?: number;
  heal_dice?: number;
  heal_sides?: number;
  heal_bonus?: number;
  save_dc?: number;
  duration?: number;
  max_target_hp?: number;
  ac_penalty?: number;
  attack_penalty?: number;
  damage_per_turn?: number;
}

export type MonsterPassive =
  | { type: "regen"; amount: number }
  | { type: "fire_resistance" }
  | { type: "poison_immunity" };

export type MonsterOnHit =
  | { type: "drain"; chance: number; amount: number }
  | {
      type: "consume";
      chance: number;
      damage_per_turn: number;
      save_dc: number;
    };

interface RawMonsterSpell {
  type?: string;
  name?: string;
  cast_chance?: number;
  range?: number;
  damage_dice?: number;
  damage_sides?: number;
  damage_bonus?: number;
  heal_dice?: number;
  heal_sides?: number;
  heal_bonus?: number;
  save_dc?: number;
  duration?: number;
  max_target_hp?: number;
  ac_penalty?: number;
  attack_penalty?: number;
  damage_per_turn?: number;
}

interface RawMonsterPassive {
  type?: string;
  amount?: number;
}

interface RawMonsterOnHit {
  type?: string;
  chance?: number;
  amount?: number;
  damage_per_turn?: number;
  save_dc?: number;
}

interface RawMonster {
  id?: string;
  name?: string;
  hp?: number;
  ac?: number;
  attack_bonus?: number;
  damage_dice?: number;
  damage_sides?: number;
  damage_bonus?: number;
  /** v2's sprite path under `/sprites/` (e.g. "monster/giant_rat.png"). */
  sprite?: string;
  move_range?: number;
  undead?: boolean;
  humanoid?: boolean;
  xp_reward?: number;
  gold_min?: number;
  gold_max?: number;
  battle_scale?: number;
  post_attack_move?: number;
  difficulty?: string;
  spells?: RawMonsterSpell[] | null;
  passives?: RawMonsterPassive[] | null;
  on_hit_effects?: RawMonsterOnHit[] | null;
}

const KNOWN_SPELL_TYPES: ReadonlySet<string> = new Set([
  "breath_fire",
  "magic_dart",
  "magic_arrow",
  "fireball",
  "lightning_bolt",
  "sleep",
  "curse",
  "poison",
  "heal_self",
  "heal_ally",
]);

function spellFromRaw(s: RawMonsterSpell): MonsterSpell | null {
  if (!s.type || !KNOWN_SPELL_TYPES.has(s.type)) return null;
  return {
    type: s.type as MonsterSpellType,
    name: s.name ?? s.type,
    cast_chance: typeof s.cast_chance === "number" ? s.cast_chance : 0,
    range: s.range,
    damage_dice: s.damage_dice,
    damage_sides: s.damage_sides,
    damage_bonus: s.damage_bonus,
    heal_dice: s.heal_dice,
    heal_sides: s.heal_sides,
    heal_bonus: s.heal_bonus,
    save_dc: s.save_dc,
    duration: s.duration,
    max_target_hp: s.max_target_hp,
    ac_penalty: s.ac_penalty,
    attack_penalty: s.attack_penalty,
    damage_per_turn: s.damage_per_turn,
  };
}

function passiveFromRaw(p: RawMonsterPassive): MonsterPassive | null {
  if (p.type === "regen") {
    return {
      type: "regen",
      amount: typeof p.amount === "number" ? p.amount : 1,
    };
  }
  if (p.type === "fire_resistance") return { type: "fire_resistance" };
  if (p.type === "poison_immunity") return { type: "poison_immunity" };
  return null;
}

function onHitFromRaw(h: RawMonsterOnHit): MonsterOnHit | null {
  if (h.type === "drain") {
    return {
      type: "drain",
      chance: typeof h.chance === "number" ? h.chance : 0,
      amount: typeof h.amount === "number" ? h.amount : 0,
    };
  }
  if (h.type === "consume") {
    return {
      type: "consume",
      chance: typeof h.chance === "number" ? h.chance : 0,
      damage_per_turn:
        typeof h.damage_per_turn === "number" ? h.damage_per_turn : 1,
      save_dc: typeof h.save_dc === "number" ? h.save_dc : 12,
    };
  }
  return null;
}

/** Resolve v2's sprite path ("monster/giant_rat.png") into a runtime
 *  URL Phaser's loader can fetch. v2 assets live under `/sprites/`. */
function resolveSpriteUrl(sprite: string | undefined): string {
  if (!sprite) return "";
  if (sprite.startsWith("http://") || sprite.startsWith("https://")) {
    return sprite;
  }
  if (sprite.startsWith("/")) return withBase(sprite);
  return withBase(`/sprites/${sprite}`);
}

let _catalog: Map<string, MonsterSpec> | null = null;

/** Build a typed spec from a raw v2 monsters.json entry. */
export function specFromRaw(raw: RawMonster): MonsterSpec | null {
  if (!raw.id || !raw.name) return null;
  return {
    id: raw.id,
    name: raw.name,
    hp: raw.hp ?? 10,
    ac: raw.ac ?? 11,
    attack_bonus: raw.attack_bonus ?? 2,
    damage_dice: raw.damage_dice ?? 1,
    damage_sides: raw.damage_sides ?? 6,
    damage_bonus: raw.damage_bonus ?? 0,
    sprite: resolveSpriteUrl(raw.sprite),
    move_range: raw.move_range ?? 3,
    undead: !!raw.undead,
    humanoid: !!raw.humanoid,
    xp_reward: raw.xp_reward,
    gold_min: raw.gold_min,
    gold_max: raw.gold_max,
    battle_scale: typeof raw.battle_scale === "number" ? raw.battle_scale : 1,
    post_attack_move:
      typeof raw.post_attack_move === "number" ? raw.post_attack_move : 0,
    difficulty: raw.difficulty,
    spells: Array.isArray(raw.spells)
      ? raw.spells
          .map(spellFromRaw)
          .filter((x): x is MonsterSpell => x !== null)
      : undefined,
    passives: Array.isArray(raw.passives)
      ? raw.passives
          .map(passiveFromRaw)
          .filter((x): x is MonsterPassive => x !== null)
      : undefined,
    on_hit_effects: Array.isArray(raw.on_hit_effects)
      ? raw.on_hit_effects
          .map(onHitFromRaw)
          .filter((x): x is MonsterOnHit => x !== null)
      : undefined,
  };
}

export async function loadMonsters(
  url = modulePath("monsters.json"),
): Promise<Map<string, MonsterSpec>> {
  if (_catalog) return _catalog;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as { monsters?: RawMonster[] };
  const m = new Map<string, MonsterSpec>();
  for (const r of raw.monsters ?? []) {
    const spec = specFromRaw(r);
    if (spec) m.set(spec.id, spec);
  }
  _catalog = m;
  return _catalog;
}

/** Test-only escape hatch. */
export function _clearMonstersCache(): void {
  _catalog = null;
}

/**
 * Build a fresh Combatant from a monster `id`. Falls back to a
 * generic stub if the id isn't in the loaded catalog so the scene
 * never crashes on missing data.
 */
export function makeMonsterByName(id: string, idSuffix = ""): Combatant {
  const spec: MonsterSpec =
    (_catalog && _catalog.get(id)) ?? {
      id,
      name: id,
      hp: 10,
      ac: 11,
      attack_bonus: 2,
      damage_dice: 1,
      damage_sides: 6,
      damage_bonus: 0,
      sprite: withBase("/sprites/monster/goblin.png"),
      move_range: 3,
      battle_scale: 1,
      post_attack_move: 0,
    };
  // Roll gold per-spawn so duplicate monsters carry different purses.
  const goldMin = spec.gold_min ?? 0;
  const goldMax = spec.gold_max ?? goldMin;
  const goldReward =
    goldMax > goldMin
      ? goldMin + Math.floor(Math.random() * (goldMax - goldMin + 1))
      : goldMin;
  return {
    id: `${spec.id}${idSuffix}`,
    name: spec.name,
    side: "enemies",
    maxHp: spec.hp,
    hp: spec.hp,
    ac: spec.ac,
    attackBonus: spec.attack_bonus,
    damage: {
      dice: spec.damage_dice,
      sides: spec.damage_sides,
      bonus: spec.damage_bonus,
    },
    dexMod: 0,
    // v2 doesn't model an RGB fallback; pick a neutral that reads as
    // "missing sprite" without screaming any specific creature type.
    color: [140, 140, 140],
    sprite: spec.sprite,
    baseMoveRange: spec.move_range,
    position: { col: 0, row: 0 }, // overwritten by Combat
    undead: spec.undead,
    xpReward: spec.xp_reward,
    goldReward,
    battleScale: spec.battle_scale,
    monsterSpells: spec.spells,
    passives: spec.passives,
    onHitEffects: spec.on_hit_effects,
    postAttackMove: spec.post_attack_move,
    humanoid: spec.humanoid,
  };
}

/** Pre-seed list of monster sprite URLs the Phaser preloader needs
 *  before the loader runs. Empty until `loadMonsters` populates the
 *  catalog; the scene preloads the rest dynamically. */
export const MONSTER_SPRITES: string[] = [];

/** Sprites for every monster currently in the loaded catalog. */
export function loadedMonsterSprites(): string[] {
  if (!_catalog) return [];
  const set = new Set<string>();
  for (const s of _catalog.values()) if (s.sprite) set.add(s.sprite);
  return [...set];
}

export function makeSampleEncounter(): Combatant[] {
  return [
    makeMonsterByName("goblin", "-1"),
    makeMonsterByName("goblin", "-2"),
    makeMonsterByName("skeleton"),
  ];
}
