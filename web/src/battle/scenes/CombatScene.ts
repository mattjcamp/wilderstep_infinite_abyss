/**
 * Tactical combat scene.
 *
 *   ┌─ Top status bar ──────────────────────────────────────────┐
 *   │  BATTLE                                                   │
 *   ├─ Arena (left) ─────────────┬─ Right HUD ──────────────────┤
 *   │  18×21 grid of terrain     │ PARTY                        │
 *   │  tiles matching the        │ ┌──┐ Gimli   ▓▓▓ 20/20       │
 *   │  encounter location.       │ │  │                          │
 *   │  Party at the bottom,      │ ├──┤ Merry   ▓▓▓ 20/20       │
 *   │  enemies at the top.       │ │…│                          │
 *   │                            │ ├──┤ Gandolf ▓▓▓ 20/20  ▓▓ MP│
 *   │                            │ │…│                          │
 *   │                            │ ├──┤ Selina  ▓▓▓ 20/20  ▓▓ MP│
 *   │                            │ │…│                          │
 *   │                            │ -- Gimli'S TURN --            │
 *   │                            │ > Attack                      │
 *   │                            │   End Turn                    │
 *   │                            │   Flee                        │
 *   │                            │   Throw    (coming soon)      │
 *   │                            │   Defend   (coming soon)      │
 *   ├────────────────────────────┴───────────────────────────────┤
 *   │ Battle log (full-width — last ~7 lines, dice + mods)       │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Movement uses arrow keys / WASD or tap-to-step (cardinal only).
 * The action menu uses UP/DOWN/Enter and works on top of the action
 * buttons we already had (End Turn, Flee, Attack via bump).
 */

import Phaser from "phaser";
import { Combat, isAiControlled } from "../combat/Combat";
import {
  ARENA_COLS,
  ARENA_ROWS,
  isWall,
  DIR_DELTAS,
  type Direction,
} from "../combat/Arena";
import { makeSampleParty, PARTY_SPRITES, preloadPartyMemberSprites } from "../data/fighters";
import {
  makeSampleEncounter,
  makeMonsterByName,
  loadMonsters,
  loadedMonsterSprites,
  MONSTER_SPRITES,
} from "../data/monsters";
import { gameState } from "../state";
import {
  isAuthoredEncounterId,
  authoredDefeatKey,
} from "../world/InteriorSpawn";
import { assetUrl } from "../world/Module";
import { ANIMATION_CONFIGS } from "@/sim/tileAnimations";
import { loadItems, type Item } from "../world/Items";
import { loadCounters } from "../world/Counters";
import { rollLootDrop } from "../world/Loot";
import { addToStash } from "../world/TownActions";
import { loadSpells, minLevelFor, type Spell } from "../world/Spells";
import {
  loadAbilities,
  combatAbilitiesForMember,
  type Ability,
} from "../world/Abilities";
import {
  loadParty,
  compatibleAmmoIds,
  consumeAmmoFromStash,
  partyHasAmmo,
  swapToMeleeIfOutOfAmmo,
} from "../world/Party";
import { loadClass, loadRaces, type ClassTemplate } from "../world/Classes";
import type { ArenaCellInfo } from "../world/Maps";
import {
  brightnessAt,
  hasLineOfSight,
  type LightSource,
  PARTY_LIGHT_RADIUS,
} from "../world/Lighting";
import { awardXp, type LevelUpEvent } from "../world/Leveling";
import { defaultRng } from "../rng";
import {
  resolveThrow,
  isThrowable,
  isRanged,
  maxRangeFor,
  spellIsCombatCastable,
  classifyCombatCast,
  describeStatusCast,
  rollSpellSave,
  resolveDamageSpell,
  resolveHealSpell,
  resolveTurnUndead,
  makeSummonedSkeleton,
  traceDirectionalRay,
  useCombatItem,
} from "../combat/CombatActions";
import { isCombatUsable } from "../world/Items";
import type { Buff } from "../combat/Buffs";
import { combatantsFromParty, syncCombatHpBack, abilityMod, refreshCombatantGear } from "../combat/CombatBridge";
import {
  useEquippedDurability,
  equipItemFromInventory,
  equippableSlots,
} from "../world/PartyActions";
import {
  flashTarget,
  castGlow,
  projectileLine,
  radialBurst,
  breathOfFire,
  healingSparkles,
  glowAura,
  screenShake,
  floatingX,
  shatterEffect,
  partyDeathSlump,
  partyDeathBanner,
  VFX_COLOURS,
} from "@/vfx/Vfx";
import { resolveProjectileEffect } from "@/vfx/effectRegistry";
import {
  loadAnimations,
  getAnimationById,
} from "@/vfx/animationsCatalog";
import { Sfx } from "../audio/Sfx";
import type { Combatant, AttackResult } from "../types";
import type { PartyMember } from "../world/Party";
import { consumeOneFromStackAt } from "../world/Party";

/** Outcome the React-mounted host receives when the combat scene
 *  resolves. The v1 scene-switching path mutates `gameState.partyData`
 *  in place during the fight; the host can read post-fight HP/MP from
 *  there before unmounting. This payload focuses on the parts the
 *  host can't easily infer otherwise. */
export interface CombatResolved {
  /** Who lived through the encounter. `enemies` means a party wipe —
   *  the host routes to the end screen. `party` means the host marks
   *  the trigger encounter defeated and resumes the world. */
  winner: "party" | "enemies";
  /** XP awarded to the alive party members (already added to
   *  `gameState.partyData` by the time the host reads this). */
  xp: number;
  /** Gold added to the party. Same caveat — mutated in place; this
   *  is the delta for surfacing in a "you found X gold" toast. */
  gold: number;
}

interface CombatSceneData {
  /** True when launched from the overworld; false for the /combat demo. */
  fromWorld?: boolean;
  /** The "col,row" key of the trigger tile that started this fight. */
  triggerKey?: string;
  /**
   * When set, build the encounter from these catalog names instead
   * of the random sample. Used by Monster Spawn boss fights and
   * roamer engagements so the player faces the right creatures.
   */
  monsterNames?: string[];
  /**
   * "col,row" of the Monster Spawn tile that triggered this fight.
   * On victory, OverworldScene will rewrite that tile to grass and
   * mark it as destroyed so it never spawns again.
   */
  destroySpawnKey?: string;
  /**
   * Id of the roaming monster the party engaged. On victory the
   * overworld removes it from gameState.roamingMonsters.
   */
  roamerId?: string;
  /**
   * Scene to launch on combat exit instead of OverworldScene. The
   * dungeon flow uses this to re-enter DungeonScene with the same
   * (overworldCol, overworldRow) so the cached level is reloaded.
   * `returnPayload` is forwarded as the next scene's init data.
   */
  returnSceneKey?: string;
  returnPayload?: Record<string, unknown>;
  /**
   * Id of a dungeon monster the party engaged. On victory the
   * dungeon removes it from `level.monsters`. Independent from
   * `roamerId` so dungeon and overworld kill bookkeeping don't clash.
   */
  dungeonMonsterId?: string;
  /**
   * Id of a town-interior quest monster the party engaged. On
   * victory the matching entry in `gameState.interiorMonsters` is
   * removed so re-entering the interior doesn't respawn it.
   */
  interiorMonsterId?: string;
  /**
   * Town/interior path the engaged monster lives on (e.g.
   * `"Plainstown/General Shop Interior"`). Paired with
   * `interiorMonsterId`; together they identify which list entry to
   * remove.
   */
  interiorPath?: string;
  /**
   * Carried over from the v1 audio era — when true, the scene skips
   * any soundtrack work. The v2 audio system isn't wired up yet, so
   * this currently affects nothing, but the simulator still sets it
   * so the flag is preserved for the future music layer.
   */
  silent?: boolean;
  /**
   * v2 hook for the React-mounted play flow. When set, the scene
   * calls `onResolved` with the fight outcome INSTEAD of bouncing
   * to `returnSceneKey` via `scene.start`. The host then unmounts
   * the Phaser game on its own schedule and routes the player back
   * to the world / end screen.
   *
   * Passing this also disables the camera fade-out before exit so
   * the host can run its own transition.
   */
  onResolved?: (result: CombatResolved) => void;
  /**
   * Per-cell arena data when launched against a custom arena map.
   *
   * Carries the resolved floor sprite URL plus the two gameplay
   * flags combat consults: `walkable` (movement) and `obstructs`
   * (projectile / spell line-of-sight). Index order is `[row][col]`,
   * sized to fit the arena grid. Cells set to `null` (or rows
   * shorter than ARENA_COLS, etc.) fall back to walkable open
   * ground with the scene's default fill — so a smaller map still
   * boots; the corners just look bare.
   *
   * The perimeter wall ring (`isWall` from Arena.ts) still applies
   * unconditionally — `arenaCells` augments the interior only.
   */
  arenaCells?: ReadonlyArray<ReadonlyArray<ArenaCellInfo | null>>;
  /**
   * When true the scene paints a darkness overlay over the arena.
   * Cells flagged `lightSource` in the arena matrix emit pools of
   * light (radius from `lightRange`, default 3 tiles, Chebyshev),
   * and the active party member emits a small self-light so the
   * player can always see what they're doing. Off (default) keeps
   * the legacy fully-bright look — overworld/dungeon callers don't
   * pass this flag.
   */
  darkness?: boolean;
  /**
   * When true the party is treated as if their infravision ability
   * is currently engaged. Only matters in darkness mode: cells the
   * party has Bresenham LOS to but no light source reaches are
   * highlighted in red (infravision "sees" the heat) AND become
   * targetable by the action picker. Outside darkness mode the
   * flag is inert. Defaults to false — infravision is opt-in even
   * for parties whose members have the race trait.
   */
  partyInfravisionActive?: boolean;
}

// ── Debug cheats ──────────────────────────────────────────────────
//
// `SMITE_ALL_CHEAT` enables the Shift+K shortcut that zeros every
// alive enemy's HP and routes through the standard victory flow so
// playtesting can tear through encounters quickly. Flip to `false`
// before shipping to disable the binding entirely; the constant is
// used as a guard so removing the cheat at release time is one
// edit (or, eventually, a build-config gate). Not surfaced in the
// action menu — it's deliberately a hidden key chord so a curious
// player can't trip into it.
const SMITE_ALL_CHEAT = true;

// ── Layout (canvas is 960×720) ────────────────────────────────────
// TILE matches the rest of the engine (overworld + town interiors)
// so monster / character sprites — which ship as native 32×32 PNGs
// — render at their native size, not stretched.
const TILE = 32;
const HEADER_H = 32;
const ARENA_X = 12;
const ARENA_Y = HEADER_H + 8;             // 40
const ARENA_W = ARENA_COLS * TILE;        // 18 × 32 = 576
const ARENA_H = ARENA_ROWS * TILE;        // 16 × 32 = 512
const HUD_X = ARENA_X + ARENA_W + 12;     // 600
const HUD_W = 960 - HUD_X - 12;           // 348
const HUD_Y = ARENA_Y;
const HUD_H = ARENA_H;
const LOG_X = 12;
const LOG_Y = ARENA_Y + ARENA_H + 8;      // 560
const LOG_W = 960 - 24;                   // 936
const LOG_H = 720 - LOG_Y - 12;           // 148

// ── Web-app theme palette (matches PartyScene + TownScene) ────────
const C = {
  bgFull:    0x0c0c14,
  panel:     0x161629,
  panelEdge: 0x2a2a3a,
  accent:    0xc8553d,
  gold:      0xffd470,
  body:      0xf6efd6,
  // dim is for "enabled but not under cursor" rows in the action
  // menu. The previous tan (0xbdb38a) read too close to `faint` on
  // the dark panel, making selectable actions look greyed out — see
  // the "Range/Cast disappeared" report. Pulling it up to a soft
  // cream restores the "yes you can pick this" cue while still
  // keeping the cursor row visibly distinct.
  dim:       0xe8dfb6,
  // faint is for truly disabled rows (no ranged weapon, no
  // throwables, etc.). Pushed darker so it contrasts cleanly with
  // the new dim — readable but obviously off.
  faint:     0x4d473e,
  hpFull:    0x6acf6a,
  hpLow:     0xd14a4a,
  mp:        0x7aa6ff,
  cursor:    0xc8553d,
  moveHint:  0x44648a,
  // Gold-leaning highlight for weapon / spell reach. Distinct from
  // moveHint (cool blue) so the player can read at a glance whether
  // a cell is a step destination or a shot landing zone.
  rangeHint: 0xc89542,
  selectBg:  0x2a1f24,
} as const;

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
const FONT_TITLE = (color: number = C.gold) => ({ fontFamily: "Georgia, serif", fontSize: "20px", color: hex(color) });
const FONT_HEAD  = (color: number = C.gold) => ({ fontFamily: "Georgia, serif", fontSize: "16px", color: hex(color) });
const FONT_BODY  = (color: number = C.body) => ({ fontFamily: "Georgia, serif", fontSize: "14px", color: hex(color) });
const FONT_MONO  = (color: number = C.dim)  => ({ fontFamily: "monospace",     fontSize: "12px", color: hex(color) });

/** Action menu — what the active party member can do this turn.
 *  No "Flee" — once battle is joined, the party fights to win or
 *  loses (matches the Python game's combat loop). */
type ActionId =
  | "attack"
  | "range"
  | "throw"
  | "cast"
  | "ability"
  | "use"
  | "equip"
  | "end";

interface ActionEntry {
  id: ActionId;
  label: string;
}

const PARTY_ACTIONS: ActionEntry[] = [
  { id: "attack",  label: "Attack"          },
  { id: "range",   label: "Range"           },
  { id: "throw",   label: "Throw"           },
  { id: "cast",    label: "Cast"            },
  // "Abilities" surfaces combat-active class/race abilities
  // (today: Turn Undead). Separate from Cast because abilities
  // and spells are different concepts — abilities don't cost MP,
  // gate by class+level rather than casting catalog, and often
  // carry once-per-encounter limits or other ability-specific
  // rules the spell picker can't express.
  { id: "ability", label: "Abilities"       },
  // "Use" surfaces combat-usable consumables — Healing Potion, Mana
  // Potion, Antidote, Healing Herb, the throwable poisons. Party-only
  // items (Torch, Camping Supplies, Lockpick) are filtered out by
  // `isCombatUsable` so they never appear in this picker.
  { id: "use",    label: "Use Item"        },
  // "Equip" lets the active member swap weapons / armor mid-fight
  // out of their personal inventory (the shared stash isn't reachable
  // from combat — that mirrors how Throw and Use already work for
  // *equippable* items: shared stash items show up only for
  // throwables / consumables, not for gear). Consumes the turn.
  { id: "equip",  label: "Equip Item"      },
  { id: "end",    label: "End Turn  [SPACE]" },
];

/**
 * Sub-modes the scene can be in:
 *   - default:        action menu has focus, arrows move the avatar
 *   - pick-throw:     player is choosing which item to throw
 *   - pick-spell:     player is choosing which spell to cast
 *   - pick-target:    player is choosing the enemy/ally for the staged
 *                     action (numbered 1..N on the arena)
 */
type SceneMode =
  | "default" | "pick-throw" | "pick-spell" | "pick-use" | "pick-equip"
  | "pick-target" | "pick-tile"
  /** Magic Dart-style spells: player presses an arrow key to fire
   *  along that cardinal direction up to the spell's range. */
  | "pick-direction"
  /** Abilities picker — surfaces the active member's combat-active
   *  class + race abilities (today: Turn Undead). Dispatched by
   *  `runAbility`, NOT the spell pipeline. */
  | "pick-ability"
  /** Ammo picker — only opens when the player chooses Range AND
   *  the party carries multiple compatible ammo types (Arrows +
   *  Fire Arrows on any bow is the canonical case). The picked
   *  ammo id rides forward on the pending range action so the
   *  resolution code knows which one to consume + whether to
   *  ignite the landing cell. Skipped when the party has only
   *  one compatible ammo — no extra click for the common case. */
  | "pick-ammo";

/** What to do once a target is picked. */
type PendingAction =
  | { kind: "throw"; item: Item }
  /** Precision-targeted range shot. `ammoId` carries the player's
   *  pick from the ammo picker (omitted when the party only has
   *  one compatible ammo — the resolver falls back to
   *  `weapon.ammo` in that case). Set by `startRangeAttack` or
   *  the ammo picker's commit handler. */
  | { kind: "range"; weapon: Item; ammoId?: string }
  | { kind: "cast"; spell: Spell }
  /** Tile-targeted spell — resolution branches by effect_type. */
  | { kind: "tile"; spell: Spell }
  /** Tile-targeted throw — used for thrown items whose effect lands
   *  on the cell itself rather than on a creature. The canonical
   *  case is a lit torch with `ignite: true`: the player needs to
   *  be able to chuck it at any open cell in range — including dark
   *  and empty ones — so they can light up the arena. Resolution
   *  is in `resolveThrowTile`. */
  | { kind: "throw-tile"; item: Item }
  /** Tile-targeted RANGE shot — used when a precision bow fires
   *  an ignitable arrow (Silver Bow + Fire Arrows is the canonical
   *  case). Mirrors `throw-tile`'s "pick any cell in range" rule
   *  so the player can shoot a fire arrow into an empty / dark
   *  cell to light it up. `ammoId` is the ammo to consume +
   *  ignite-source (always set since the picker only enters this
   *  mode after the ammo has been chosen). Resolution lives in
   *  `resolveRangeTile`. */
  | { kind: "range-tile"; weapon: Item; ammoId: string }
  /** Directional spell — resolution waits on an arrow-key press. */
  | { kind: "direction"; spell: Spell }
  /** Volley-style ranged weapon — caster picks a cardinal direction,
   *  the projectile flies in a line and hits the first creature in
   *  its path (friendly fire risk, just like directional spells).
   *  Used when Item.targeting === "directional" (short bow, long
   *  bow, sling). Crossbow / silver bow remain `range` with a
   *  target picker. `ammoId` mirrors the picker on the precision
   *  range branch. */
  | { kind: "range-direction"; weapon: Item; ammoId?: string };

/** Map a weapon's `damage_type` to a themed ranged-shot visual:
 *  the projectile-effect key, the impact-burst tint, and the impact
 *  SFX. Keyed off `damage_type` (not `animation_id`) because the item
 *  editor preserves `damage_type` across a save while it strips
 *  `animation_id` — so an elemental relic stays themed even after the
 *  user re-saves items.json from the editor. Damage types with no
 *  entry fall through to the plain arrow streak. */
function elementalShotFx(
  damageType: string,
): { visual: string; color: number; sfx: string } | null {
  switch (damageType) {
    case "lightning":
      return { visual: "lightning_bolt", color: VFX_COLOURS.lightning, sfx: "explosion" };
    case "meteor":
      return { visual: "meteor_strike", color: VFX_COLOURS.fire, sfx: "explosion" };
    case "fire":
      return { visual: "fire_projectile", color: VFX_COLOURS.fire, sfx: "explosion" };
    case "arcane":
      return { visual: "magic_dart", color: VFX_COLOURS.arcane, sfx: "chirp" };
    case "ice":
    case "frost":
      return { visual: "magic_arrow", color: VFX_COLOURS.lightning, sfx: "chirp" };
    case "light":
      return { visual: "magic_arrow", color: VFX_COLOURS.buff, sfx: "chirp" };
    default:
      return null;
  }
}

/** Radius (tiles) of the Magic-Light pool a light-themed bow casts
 *  where its arrow lands. Reads the weapon's optional `light_range`
 *  (same field fire arrows use), defaulting to 5 — the Cleric's
 *  combat Light-spell radius — so the relic lights a generous pool. */
function lightArrowRange(weapon: Item): number {
  const lr = (weapon as { light_range?: number }).light_range;
  return typeof lr === "number" && lr > 0 ? lr : 5;
}

export class CombatScene extends Phaser.Scene {
  private combat!: Combat;
  private fromWorld = false;
  /** True when the launcher wants the scene to run without firing
   *  the combat soundtrack. Set from init-data; see `silent` on
   *  CombatSceneData. */
  private silent = false;
  /** Optional v2 host callback — see CombatSceneData.onResolved. */
  private onResolved: ((result: CombatResolved) => void) | null = null;
  /** Optional per-cell arena data — sprite + walkable + obstructs.
   *  See `arenaCells` on CombatSceneData for the contract. */
  private arenaCells: ReadonlyArray<ReadonlyArray<ArenaCellInfo | null>> | null = null;
  /** When true, paint a darkness overlay and use `arenaCells`-flagged
   *  light_source cells (plus a party self-light) to "punch" pools of
   *  light. Comes from CombatSceneData.darkness. */
  private darkness = false;
  /** Set true when the priest's Daylight spell is cast — floods the
   *  whole arena with light for the rest of the battle. While active,
   *  `refreshDarkness` clears the darkness overlay entirely so every
   *  cell reads as fully lit. Reset per encounter in init. */
  private daylightActive = false;
  /** When true AND in darkness mode, infravision-augmented vision
   *  applies — but only on turns where the active actor's race
   *  grants the ability. The flag is the player-controlled global
   *  switch (matches the overworld / dungeon activation); the
   *  per-turn gate is `infravisionRaces` below.
   *
   *  Comes from CombatSceneData.partyInfravisionActive. Has no
   *  effect when `darkness` is false; bright fights ignore it. */
  private partyInfravisionActive = false;
  /** Set of race ids that grant the `infravision` ability — read
   *  from races.json once at scene boot. The render path consults
   *  this against the *active actor's* race so the effect only
   *  applies on the Dwarf's turn (or whichever races authoring
   *  flags). Empty set means no race grants the ability for this
   *  fight, which silently disables the infravision pass. */
  private infravisionRaces: Set<string> = new Set();
  /** Full v2 races catalog (races.json) keyed by lowercase race id.
   *  The Abilities picker consults the active member's race entry
   *  via `combatAbilitiesForMember` to surface race-granted
   *  abilities (none of the shipped races have combat-active
   *  abilities today, but the field is wired up so a future
   *  module that adds, say, a Dragonborn breath weapon
   *  doesn't need a code change to show it in the picker). */
  private raceCatalog: Map<string, { abilities?: string[] }> = new Map();
  /** Separate Graphics layer that paints the infravision red
   *  rectangles in MULTIPLY blend mode — so the underlying floor
   *  texture's coloured detail pixels show through as red (the
   *  same look the dungeon / overworld get from `setTint`). Kept
   *  apart from `darknessGfx` because the black darkness overlay
   *  uses normal alpha blending. */
  private infravisionGfx: Phaser.GameObjects.Graphics | null = null;
  /** Static light sources collected from `arenaCells` at create time.
   *  Empty while `darkness` is off. Per-source the radius comes from
   *  the cell's `lightRange`, falling back to Lighting.ts's default.
   *  Dynamic sources (thrown-torch fires) get appended at runtime —
   *  the per-cell brightness pass treats authored + dynamic the same. */
  private staticLights: LightSource[] = [];
  /** Fire cells ignited mid-fight by thrown items (`ignite: true`).
   *  Keyed `"col,row"`. Each entry tracks:
   *    - lightRange: tiles the fire illuminates (Chebyshev radius)
   *    - damage: HP loss for combatants standing on / entering
   *    - emitter: the fire particle effect rendered on the cell
   *  The cell's contribution to `staticLights` lives in the array
   *  above; this map is the bookkeeping side for the damage pass +
   *  the emitter so we can clean both up if a fire ever burns out. */
  private fireCells = new Map<
    string,
    {
      lightRange: number;
      damage: number;
      emitter: Phaser.GameObjects.Particles.ParticleEmitter;
    }
  >();
  /** Combatant ids that have already taken fire damage this turn,
   *  keyed off the turn id so a single combatant can't get stung
   *  twice if they step on multiple fire cells in the same activation.
   *  Cleared on each new turn. Kept lazy — populated on first sting. */
  private fireDamagedThisTurn = new Set<string>();
  /** Graphics object that paints the darkness overlay. Rebuilt on every
   *  party move / turn change so the party's own light pool follows the
   *  active actor. Lives at depth 20 (above bodies/HP, below floaters). */
  private darknessGfx: Phaser.GameObjects.Graphics | null = null;
  private triggerKey: string | null = null;
  /** Catalog names for this fight; null falls back to makeSampleEncounter. */
  private monsterNames: string[] | null = null;
  /** Scene to launch on exit. Defaults to OverworldScene. */
  private returnSceneKey: string = "OverworldScene";
  private returnPayload: Record<string, unknown> | null = null;
  /** Dungeon monster id to remove from `level.monsters` on victory. */
  private dungeonMonsterId: string | null = null;
  /** Interior monster id + town/interior path — together they
   *  identify the entry in `gameState.interiorMonsters` to drop on
   *  victory. */
  private interiorMonsterId: string | null = null;
  private interiorPath: string | null = null;
  /** "col,row" of a Monster Spawn tile to destroy on victory. */
  private destroySpawnKey: string | null = null;
  /** Roaming monster id to remove from gameState.roamingMonsters on victory. */
  private roamerId: string | null = null;

  private bodies = new Map<string, Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle>();
  private selRings = new Map<string, Phaser.GameObjects.Rectangle>();
  private moveHintRects: Phaser.GameObjects.Rectangle[] = [];
  /** Repeating timers — one per combatant — that pulse a `glowAura`
   *  ring beneath their body every few hundred ms. Started in
   *  `drawCombatants` for any combatant whose equipped weapon
   *  declared a `combat_aura.color` (currently just the Sun Sword);
   *  paused-by-skip when the combatant drops to 0 HP so a corpse
   *  doesn't keep glowing. The pulse is intentionally a fresh ring
   *  per tick — we don't try to anchor a single sprite to the body,
   *  so the aura naturally tracks the wielder's position when they
   *  move across the arena. Cleared on scene init (defensive) and
   *  re-seeded each `drawCombatants` rebuild. */
  private wieldAuras = new Map<string, Phaser.Time.TimerEvent>();
  /** Alpha-yoyo tween that pulses a Thief's body sprite while
   *  Shadow Step is "active" — i.e. between the killing bump that
   *  triggered the ability and the moment the thief's turn ends.
   *  Single-slot because only the current actor can be mid-shadow-
   *  step at any time. Started in `tryPlayerStep` when the engine
   *  flags `result.shadowStepped`; cleared in `endActorTurn` (and
   *  defensively in `init()`) so a stale tween can't outlive the
   *  thief's turn or carry over into the next encounter. */
  private shadowStepPulse: Phaser.Tweens.Tween | null = null;
  /** Combatant id whose body the shadow-step pulse is currently
   *  tweening — kept so the cleanup path can restore the body's
   *  alpha cleanly even if the body sprite list got rebuilt under
   *  us. */
  private shadowStepPulseId: string | null = null;
  /** Per-party-member card UI, kept so we can refresh in place. The MP
   *  fields are absent for non-casters (Fighter / Thief / etc.). */
  private partyCards = new Map<string, {
    hpBar: Phaser.GameObjects.Rectangle;
    hpText: Phaser.GameObjects.Text;
    mpBar?: Phaser.GameObjects.Rectangle;
    mpText?: Phaser.GameObjects.Text;
    /** Inner-fill width when the bar is full — used to scale by HP/MP %. */
    fullBarW: number;
  }>();
  /** Floating HP bar above each enemy's body sprite. Position is
   *  re-synced from the body during move / bump tweens via onUpdate. */
  private monsterHpBars = new Map<string, {
    bg: Phaser.GameObjects.Rectangle;
    bar: Phaser.GameObjects.Rectangle;
    fullW: number;
    /** Pixels above the body sprite centre to anchor the bar. */
    offsetY: number;
  }>();
  /** Particle emitters keyed by `"col,row"` — one per arena cell
   *  whose `animation` field declared a torch / fire / fairy / smoke
   *  effect. Created once in the arena draw pass; visibility is
   *  re-gated in `refreshDarkness` so an emitter on a cell beyond
   *  the party's LOS doesn't poke a flame through the darkness. */
  private arenaEmitters = new Map<
    string,
    Phaser.GameObjects.Particles.ParticleEmitter
  >();

  private logText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private movePointsText!: Phaser.GameObjects.Text;
  private actionTexts: Phaser.GameObjects.Text[] = [];
  private actionRowHandles: Phaser.GameObjects.Rectangle[] = [];
  /**
   * Static decorations created during create() — panel backgrounds,
   * the "BATTLE" header label, "PARTY" subheader, party-card frames,
   * HP/MP bar backgrounds, dividers, the log frame. None of these
   * have natural per-cell tracking like `bodies` or `monsterHpBars`,
   * so they used to leak between scene boots when Phaser's shutdown
   * raced with a fast scene-start (the same race that produced
   * phantom HP bars and the "all action options look dim" report).
   * `track()` pushes everything here so `init()` can destroy them
   * defensively before the next create() rebuilds the layout.
   */
  private staticDecor: Phaser.GameObjects.GameObject[] = [];
  private actionCursor = 0;
  /** The subset of `PARTY_ACTIONS` currently rendered in the
   *  action menu — repopulated on every `refreshActionMenu` pass to
   *  contain only the rows whose enable check passes (Cast hides
   *  when out of MP, Range hides without ammo, etc.). The pointer-
   *  click + arrow-navigation paths read THIS list so a click on
   *  rendered row N maps to whatever's actually drawn there, not
   *  the static PARTY_ACTIONS[N]. Empty when it isn't the player's
   *  turn (the whole menu collapses then). */
  private visibleActions: ActionEntry[] = [];

  // Sub-mode + picker state
  private mode: SceneMode = "default";
  private pendingAction: PendingAction | null = null;
  /** Items the user can pick to throw — populated when entering pick-throw mode. */
  private throwOptions: Array<{ item: Item; source: "personal" | "stash"; index: number }> = [];
  /**
   * Items the user can pick from the Use Item action — combat-usable
   * consumables in personal inventory or shared stash. Filtered by
   * `isCombatUsable` so torches / camping supplies are excluded.
   * Same shape as `throwOptions` so the consumption helper can take
   * either list.
   */
  private useOptions: Array<{ item: Item; source: "personal" | "stash"; index: number }> = [];
  /**
   * Equippable items in the active member's PERSONAL inventory.
   * Personal-only because the shared stash isn't carried into combat
   * by anyone — that's the same boundary Throw / Use draw for non-
   * consumable gear. `index` is into `member.inventory`.
   */
  private equipOptions: Array<{ item: Item; index: number }> = [];
  private spellOptions: Spell[] = [];
  /** Combat-active class + race abilities the active member can use
   *  on this turn — populated when the player opens the Abilities
   *  picker. Filtered via `combatAbilitiesForMember` so passive
   *  abilities and out-of-combat ones never appear. Cleared when
   *  the picker closes or the turn ends. */
  private abilityOptions: Ability[] = [];
  /** Ammo ids the player can choose between when firing the active
   *  Range action — populated when entering `pick-ammo` mode and
   *  cleared when the picker closes. The picker only opens when
   *  this list has 2+ entries (single-ammo case skips straight to
   *  target selection). Indexes the same way the other picker
   *  options do; the Item def for each id is looked up via
   *  `this.items.get(...)`. */
  private ammoOptions: string[] = [];
  /** Weapon the ammo picker is staging for. Cached on entry so the
   *  commit handler can hand it to `startTargetingFor` without
   *  re-deriving from the active member. */
  private pendingRangeWeapon: Item | null = null;
  /** Shared cursor for the scrollable pickers (pick-throw / pick-spell
   *  / pick-ability). Index into the corresponding options array. */
  private pickerCursor = 0;
  /** Per-target arena badges shown during pick-target mode. */
  private targetBadges: Phaser.GameObjects.Text[] = [];
  /** Index into `currentTargetList()` currently highlighted by the
   *  arrow-key cursor in pick-target mode. Arrow keys cycle it;
   *  Enter / Space activate the highlighted target; 1-9 still
   *  resolves directly by absolute index. */
  private targetCursor = 0;
  /** Reticle drawn around the targetCursor target so the player can
   *  see which one Enter would fire on. Re-painted whenever badges
   *  redraw or the cursor moves; destroyed in clearTargetBadges. */
  private targetCursorGfx: Phaser.GameObjects.Graphics | null = null;
  /** Pick-tile state — current cursor position on the arena. */
  private tileCursorPos = { col: 0, row: 0 };
  /** Phaser objects rendered for the tile cursor + AOE preview.
   *  Cleared on every cursor move and on mode exit. */
  private tileCursorObjects: Phaser.GameObjects.GameObject[] = [];
  /** Items + Spells data, loaded lazily. */
  private items: Map<string, Item> = new Map();
  private spells: Spell[] = [];
  /** Full v2 abilities catalog (abilities.json — class + race +
   *  passive + active). The Abilities picker filters this down per
   *  active member via `combatAbilitiesForMember`; passive abilities
   *  in here are intentionally ignored by combat but kept on hand
   *  for parity with `spells` (one catalog field per data file). */
  private abilities: Ability[] = [];
  /** Class templates keyed by lowercased class name (e.g. "wizard").
   *  Loaded eagerly in create() so combatantsFromParty can read each
   *  class's per-turn movement budget. */
  private classTemplates: Map<string, ClassTemplate> = new Map();
  /** Picker overlay objects (cleared on mode transition). */
  private pickerObjects: Phaser.GameObjects.GameObject[] = [];

  private busy = false;
  private ended = false;
  /** Turn Undead is one-shot per encounter — the undead get used to
   *  the holy symbol after the first channel. Reset in init() when a
   *  fresh combat starts. */
  private turnUndeadUsed = false;
  private overlayText?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "CombatScene" });
  }

  init(data?: CombatSceneData): void {
    this.fromWorld = !!data?.fromWorld;
    this.silent = !!data?.silent;
    this.onResolved = data?.onResolved ?? null;
    this.arenaCells = data?.arenaCells ?? null;
    this.darkness = !!data?.darkness;
    this.daylightActive = false;
    this.partyInfravisionActive = !!data?.partyInfravisionActive;
    this.staticLights = [];
    this.triggerKey = data?.triggerKey ?? null;
    this.monsterNames = data?.monsterNames && data.monsterNames.length > 0
      ? [...data.monsterNames] : null;
    this.destroySpawnKey = data?.destroySpawnKey ?? null;
    this.roamerId = data?.roamerId ?? null;
    this.dungeonMonsterId = data?.dungeonMonsterId ?? null;
    this.interiorMonsterId = data?.interiorMonsterId ?? null;
    this.interiorPath = data?.interiorPath ?? null;
    this.returnSceneKey = data?.returnSceneKey ?? "OverworldScene";
    this.returnPayload = data?.returnPayload ?? null;
    this.busy = false;
    this.ended = false;
    this.turnUndeadUsed = false;
    this.classTemplates.clear();
    this.actionCursor = 0;
    // Defensive cleanup — `init()` runs whenever the scene boots,
    // including re-entries after combat → overworld → combat.
    // Phaser's shutdown is supposed to destroy all GameObjects, but
    // a "phantom HP bars" report (HP bars from a previous combat
    // showing up in the next one) points to a path where stale
    // GameObjects survived. Walking the maps and calling destroy()
    // belt-and-braces means a no-op when Phaser already cleaned
    // them, and a real cleanup when it didn't.
    for (const body of this.bodies.values()) body?.destroy();
    this.bodies.clear();
    for (const ring of this.selRings.values()) ring?.destroy();
    this.selRings.clear();
    // Stop any wielder-aura timers from the previous run before the
    // bodies they reference are gone — otherwise the next tick fires
    // a glowAura at a destroyed sprite's last-known coords.
    for (const t of this.wieldAuras.values()) t.remove();
    this.wieldAuras.clear();
    // Same belt-and-braces for the shadow-step pulse — Phaser's
    // shutdown should kill the tween, but a fast re-entry has been
    // known to leak. stopShadowStepPulse is safe to call when no
    // pulse is active.
    this.stopShadowStepPulse();
    for (const r of this.moveHintRects) r?.destroy();
    this.moveHintRects.length = 0;
    // Tear down the previous run's darkness overlay so a re-entry
    // doesn't stack a new Graphics on top of the old one.
    if (this.darknessGfx) {
      this.darknessGfx.destroy();
      this.darknessGfx = null;
    }
    if (this.infravisionGfx) {
      this.infravisionGfx.destroy();
      this.infravisionGfx = null;
    }
    // Party cards previously got `.clear()`'d but their child
    // GameObjects (hp bar, hp text, mp bar, mp text) were left to
    // Phaser's shutdown — same race the monster bars hit. Walk and
    // destroy explicitly so a fast scene swap can't leave bars
    // floating over the right-hand HUD when the next combat opens.
    for (const card of this.partyCards.values()) {
      card?.hpBar?.destroy();
      card?.hpText?.destroy();
      card?.mpBar?.destroy();
      card?.mpText?.destroy();
    }
    this.partyCards.clear();
    for (const b of this.monsterHpBars.values()) {
      b.bg?.destroy();
      b.bar?.destroy();
    }
    this.monsterHpBars.clear();
    for (const e of this.arenaEmitters.values()) e?.destroy();
    this.arenaEmitters.clear();
    // Fire emitters spawned mid-fight by thrown torches — same
    // teardown rule as authored cell emitters.
    for (const f of this.fireCells.values()) f.emitter?.destroy();
    this.fireCells.clear();
    this.fireDamagedThisTurn.clear();
    for (const t of this.actionTexts) t?.destroy();
    this.actionTexts.length = 0;
    for (const h of this.actionRowHandles) h?.destroy();
    this.actionRowHandles.length = 0;
    // Static panels / labels / dividers — every nearly-opaque
    // rectangle the layout creates AND the title/header text. Untracked
    // panels were the cause of the "every action row looks dim" bug:
    // a phantom 0.96-alpha panel from the previous combat layered on
    // top of the new action menu, washing every row to the disabled
    // tone regardless of actual playerTurn state.
    for (const obj of this.staticDecor) obj?.destroy();
    this.staticDecor.length = 0;
    this.mode = "default";
    this.pendingAction = null;
    this.throwOptions = [];
    this.useOptions = [];
    this.equipOptions = [];
    this.spellOptions = [];
    this.abilityOptions = [];
    this.pickerCursor = 0;
    // Picker / targeting / tile-cursor overlays are also
    // GameObjects — destroy them before resetting the arrays so a
    // swap that interrupted a picker mid-render doesn't leave
    // dangling badges over the next encounter.
    for (const obj of this.targetBadges) obj?.destroy();
    this.targetBadges = [];
    for (const obj of this.pickerObjects) obj?.destroy();
    this.pickerObjects = [];
    for (const obj of this.tileCursorObjects) obj?.destroy();
    this.tileCursorObjects = [];
    this.tileCursorPos = { col: 0, row: 0 };
  }

  preload(): void {
    for (const path of [...PARTY_SPRITES, ...MONSTER_SPRITES]) {
      this.load.image(path, path);
    }
    // The active party (when launched from the world) is built from
    // data/party.json, so we don't know which class sprites we'll
    // need until create() runs. Preload the whole shipped set so any
    // PartyMember.sprite path resolves immediately when drawn.
    for (const f of [
      "alchemist", "barbarian", "cleric", "fighter",
      "illusionist", "paladin", "ranger", "thief", "wizard",
    ]) {
      const path = assetUrl(`/assets/characters/${f}.png`);
      this.load.image(path, path);
    }
    // Arena floor sprites come from arenaCells (a v2 map matrix) and
    // are queued in create() once the per-cell URLs are known; nothing
    // to preload here statically. The NEAREST filter applied at texture
    // add time below keeps pixel art crisp regardless of who loads the
    // sprite.
    this.textures.on("addtexture", (key: string) => {
      const tex = this.textures.get(key);
      if (tex) tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    });
  }

  async create(): Promise<void> {
    // Live-debug hook — `window.__combat` is the running CombatScene
    // so the dev console / Claude-in-Chrome can introspect the
    // engine state when something looks off.
    if (typeof window !== "undefined") {
      (window as unknown as { __combat?: CombatScene }).__combat = this;
    }
    // Music: the v1 file-based manager is gone — the v2 audio system
    // isn't wired up yet. When that lands, hook the combat track here,
    // gated by `this.silent` (the simulator sets it so the visual-test
    // pane stays quiet).
    //
    // Items + spells back the action sub-menus and the
    // party-bridge's stat derivation, so load them up-front before
    // we build Combat.
    try {
      this.items = await loadItems();
      this.spells = await loadSpells();
      // Abilities catalog — backs the Abilities action picker. Read
      // for both class and race ability lookups via
      // `combatAbilitiesForMember`. Loaded eagerly here (the picker
      // wants synchronous access) and falls back to an empty list
      // when the module ships no abilities.json, in which case the
      // Abilities row stays greyed out — no crash.
      try {
        this.abilities = await loadAbilities();
      } catch {
        // Keep going with an empty list; the picker disables itself.
        this.abilities = [];
      }
      // Make sure partyData is loaded too — the world scenes load it
      // lazily but combat may be entered before any party screen has
      // been opened.
      if (!gameState.partyData) gameState.partyData = await loadParty();
      // The static class-sprite list above only covers the 9 shipped
      // class portraits. Characters created with avatars from npcs/
      // or monsters/ would otherwise render as a grey "missing
      // texture" rectangle — preload whatever each live PartyMember
      // actually points at so every avatar in the right-hand HUD and
      // on the arena resolves to a sprite.
      await preloadPartyMemberSprites(this, gameState.partyData);
      // Class templates back per-class movement ranges (Wizard 2,
      // Fighter 4, Thief 6, …). Per-class fetches in parallel; a
      // missing file falls back to the default in CombatBridge.
      if (gameState.partyData) {
        const klasses = new Set(gameState.partyData.roster.map((m) => m.class));
        await Promise.all([...klasses].map(async (k) => {
          try { this.classTemplates.set(k.toLowerCase(), await loadClass(k)); }
          catch { /* keep going — DEFAULT_MOVE_RANGE applies */ }
        }));
      }
      // Races map — used by the infravision render to decide
      // whether the current active actor's race grants the
      // ability. Loaded once at scene boot; falls back to an
      // empty map so a missing races.json silently disables the
      // ability check rather than crashing the fight.
      try {
        const races = await loadRaces();
        const infraIds = new Set<string>();
        const catalog = new Map<string, { abilities?: string[] }>();
        for (const [id, race] of races) {
          if ((race.abilities ?? []).includes("infravision")) {
            infraIds.add(id);
          }
          // Mirror into the abilities-picker catalog so race-granted
          // combat abilities resolve without a second loadRaces call.
          catalog.set(id.toLowerCase(), { abilities: race.abilities });
        }
        this.infravisionRaces = infraIds;
        this.raceCatalog = catalog;
      } catch {
        // Leave the defaults empty — no race-granted abilities
        // (infravision or otherwise) in the active fight.
      }
      // Spawn-tile fights use catalog names; warm the loader so
      // makeMonsterByName resolves stats / sprites correctly.
      await loadMonsters();
      // Make sure every monster sprite the catalog knows about is
      // queued — spawn lists can include creatures we didn't preload
      // in the static manifest.
      let queued = 0;
      for (const path of loadedMonsterSprites()) {
        if (!this.textures.exists(path)) {
          this.load.image(path, path);
          queued += 1;
        }
      }
      // Arena floor sprites — when the launcher supplied a map, every
      // unique URL in the matrix needs to live in the texture cache
      // before drawArena() runs, otherwise the per-cell stamp would
      // silently no-op. Dedupe so the same grass / stone / etc. tile
      // isn't queued 200×.
      if (this.arenaCells) {
        const seen = new Set<string>();
        for (const row of this.arenaCells) {
          for (const cell of row) {
            const url = cell?.sprite ?? null;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            if (!this.textures.exists(url)) {
              this.load.image(url, url);
              queued += 1;
            }
          }
        }
      }
      if (queued > 0) {
        await new Promise<void>((res) => {
          this.load.once("complete", () => res());
          this.load.start();
        });
      }
    } catch (err) {
      // Combat is still playable with melee only; just skip the
      // data-driven rows. But surface the failure — a silent swallow
      // here used to leave Range / Throw / Cast permanently disabled
      // on the second battle with no signal to the player or developer.
      console.error("CombatScene: data load failed (Range/Throw/Cast may be disabled)", err);
    }
    if (this.items.size === 0) {
      console.warn("CombatScene: items catalog is empty — Range / Throw will be disabled");
    }
    if (this.spells.length === 0) {
      console.warn("CombatScene: spells catalog is empty — Cast will be disabled");
    }
    if (this.fromWorld && !gameState.partyData) {
      console.warn("CombatScene: gameState.partyData missing — Range / Throw / Cast will be disabled");
    }

    // Use the real roster when launched from the world. The /combat
    // demo route still uses the hand-built sample party so it's
    // self-contained for testing.
    let party: Combatant[];
    if (this.fromWorld && gameState.partyData) {
      // Race + abilities catalogs flow through so race-passive
      // movement bonuses (Elf Nimble: +3 base, 2 post-attack) get
      // stamped onto each combatant at construction. Missing
      // catalogs degrade silently — combatants build the same way
      // they did before Nimble landed.
      party = combatantsFromParty(
        gameState.partyData,
        this.items,
        this.classTemplates,
        { races: this.raceCatalog, abilities: this.abilities },
      );
    } else {
      party = makeSampleParty();
    }
    // Boss list / single-roamer name vs the legacy random sample.
    const enemies = this.monsterNames
      ? this.monsterNames.map((n, i) => makeMonsterByName(n, `-${i}`))
      : makeSampleEncounter();
    // Snap to local refs so the predicates close over the matrix
    // that was current when combat was built; a later remount
    // installs fresh ones.
    const cellsForPredicates = this.arenaCells;
    const blockedPredicate = cellsForPredicates
      ? (col: number, row: number) => {
          const cell = cellsForPredicates[row]?.[col];
          return cell?.walkable === false;
        }
      : undefined;
    // Hand the blocked predicate to Combat up front so initial
    // formation placement skips authored unwalkable cells (rocks,
    // trees, hedges, etc.) — without this, monsters can spawn on top
    // of impassable terrain that they then can't step off of.
    this.combat = new Combat(party, enemies, undefined, blockedPredicate);

    // Plumb arena-map flags into combat so tryMove + AI step refuse
    // unwalkable cells and Range / damage-spell targeting filters
    // through line-of-sight. (Combat's constructor already installed
    // `blockedPredicate` for placement; this re-affirms it for the
    // movement / AI phase and adds the obstruct predicate which
    // placement doesn't need.)
    if (cellsForPredicates) {
      this.combat.setBlockedPredicate((col, row) => {
        const cell = cellsForPredicates[row]?.[col];
        return cell?.walkable === false;
      });
      this.combat.setObstructsPredicate((col, row) => {
        const cell = cellsForPredicates[row]?.[col];
        return cell?.obstructs === true;
      });
    }

    this.cameras.main.setBackgroundColor("#0c0c14");
    this.cameras.main.fadeIn(220, 0, 0, 0);

    // Belt-and-braces — destroy any leftover static decor (panels /
    // headers / labels) tracked from a previous create() pass before
    // any draw runs below. `init()` should have done this already on
    // scene boot, but a Phaser shutdown race can let create() run
    // with stale GameObjects still in the staticDecor pool. The
    // forest-dungeon → combat → forest-dungeon loop is where this
    // symptom surfaced; clearing here closes the race regardless of
    // init's timing.
    this.clearStaleDraws();

    this.drawHeader();
    this.drawArena();
    this.drawHud();
    this.drawLog();
    this.drawCombatants();
    this.installInput();

    this.refreshAll();
    // Encounter stinger — play once the scene has rendered.
    Sfx.play("encounter");
    // If an enemy won initiative the encounter opens on their turn —
    // hand control straight to the AI loop. Without this the screen
    // freezes on "GOBLIN'S TURN" with the action menu dimmed because
    // the player can't act and nothing schedules the monster turn.
    this.kickOffCurrentTurn();
  }

  /**
   * If the current actor is on the enemy side, schedule the monster
   * AI loop after a short pause. Used both at scene-create (in case
   * an enemy won initiative) and after every endTurn so consecutive
   * enemy turns chain cleanly.
   */
  private kickOffCurrentTurn(): void {
    if (this.combat.isOver || this.ended) return;
    // If the active combatant is currently inside a Man Eater they
    // skip their turn; the engine rolls the STR save automatically
    // and either spits them out or ticks the per-turn damage.
    if (this.combat.isCurrentConsumed()) {
      this.busy = true;
      this.time.delayedCall(450, () => void this.runConsumedTurn());
      return;
    }
    if (isAiControlled(this.combat.current)) {
      this.busy = true;
      this.time.delayedCall(450, () => void this.runMonsterTurn());
      return;
    }
    // Player turn opening — if the active member is wielding a
    // ranged weapon and the stash is out of matching ammo, swap
    // their offhand weapon into the main hand so they can melee
    // their way out of the encounter. Fires once at turn start (not
    // on every refresh) so the log doesn't get spammed.
    this.maybeSwapOutOfAmmo();
  }

  /**
   * Auto-swap a ranged-but-out-of-ammo wielder over to their offhand
   * weapon. No-op when the active member isn't a real PartyMember
   * (summons), when they're not holding a ranged weapon, when ammo
   * IS available, or when there's no usable offhand to swap with.
   * Logs the swap so the player understands their loadout changed.
   */
  private maybeSwapOutOfAmmo(): void {
    const member = this.memberForCurrent();
    const partyData = gameState.partyData;
    if (!member || !partyData) return;
    const swap = swapToMeleeIfOutOfAmmo(member, partyData, this.items);
    if (!swap) return;
    this.combat.log.push(
      `${member.name} is out of ${this.items.get(swap.from)?.ammo ?? "ammo"} — switches to ${swap.to}!`
    );
    // Update the live Combatant's damage profile so the new weapon
    // is what melee bumps actually use this turn. Without this, the
    // member would visibly hold the swapped weapon but still attack
    // with the bow's stats.
    this.refreshCombatantWeapon(member);
    this.refreshLog();
  }

  /**
   * Refresh the active Combatant's attack/damage stats from the live
   * PartyMember after an equipment change mid-fight. Mirrors the
   * derivation in CombatBridge but applied in place — we can't drop
   * and re-add the combatant because that'd lose buffs and position.
   */
  private refreshCombatantWeapon(member: PartyMember): void {
    const c = this.combat.combatants.find(
      (x) => x.side === "party" && x.name === member.name,
    );
    if (!c) return;
    const weapon = member.equipped.hands
      ? this.items.get(member.equipped.hands) ?? null
      : null;
    const isRangedWeapon = !!(weapon && weapon.ranged);
    const dexMod = abilityMod(member.dexterity);
    const strMod = abilityMod(member.strength);
    c.attackBonus = isRangedWeapon ? dexMod : strMod;
    if (!weapon || typeof weapon.power !== "number" || weapon.power <= 0) {
      c.damage = { dice: 0, sides: 0, bonus: 1 };
    } else {
      const statMod = isRangedWeapon ? dexMod : strMod;
      const wp = weapon.power;
      if (wp === 1)      c.damage = { dice: 1, sides: 4,  bonus: statMod - 1 };
      else if (wp <= 3)  c.damage = { dice: 1, sides: 4,  bonus: statMod };
      else if (wp <= 5)  c.damage = { dice: 1, sides: 6,  bonus: statMod };
      else if (wp <= 8)  c.damage = { dice: 1, sides: 8,  bonus: statMod };
      else               c.damage = { dice: 1, sides: 10, bonus: statMod };
    }
  }

  /**
   * Auto-resolve a consumed combatant's turn: ask the engine to roll
   * the save, drain the resulting events so the scene can flash the
   * outcome on screen (escape banner / damage floater / death), then
   * end the turn so initiative moves on.
   */
  private async runConsumedTurn(): Promise<void> {
    try {
      this.combat.runConsumedAutoTurn();
      this.flashConsumeEvents();
      this.refreshAll();
    } finally {
      this.busy = false;
    }
    if (this.combat.isOver) return this.endEncounter();
    this.endActorTurn();
  }

  // ── Static panels ───────────────────────────────────────────────

  /** Push every GameObject onto `staticDecor` and return it so the
   *  call site can keep chaining. The init() pass destroys them all
   *  before the next create() rebuilds the layout — without this,
   *  fast scene swaps that interrupted Phaser's shutdown left the
   *  old panel rectangles layered on top of the new ones. */
  private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.staticDecor.push(obj);
    return obj;
  }

  private panel(x: number, y: number, w: number, h: number, alpha = 0.96): void {
    this.track(
      this.add
        .rectangle(x, y, w, h, C.panel, alpha)
        .setOrigin(0)
        .setStrokeStyle(2, C.panelEdge),
    );
  }

  /**
   * Destroy every panel / label / divider tracked in `staticDecor`
   * so the draw functions below can repopulate from a clean slate.
   * Called once at the top of `create()` to defend against the
   * Phaser shutdown race that left phantom panels (and a missing
   * action menu) over the new combat. `init()` does the same on
   * scene boot — this is the second line of defense for paths
   * where init's destroy didn't catch everything.
   */
  private clearStaleDraws(): void {
    for (const obj of this.staticDecor) obj?.destroy();
    this.staticDecor.length = 0;
  }

  private drawHeader(): void {
    this.panel(0, 0, 960, HEADER_H);
    this.track(
      this.add.text(960 / 2, 6, "BATTLE", FONT_TITLE()).setOrigin(0.5, 0),
    );
  }

  private drawArena(): void {
    this.panel(ARENA_X - 4, ARENA_Y - 4, ARENA_W + 8, ARENA_H + 8);
    const mapCells = this.arenaCells;

    // Bake the per-cell floor sprites into one RenderTexture. Without
    // this, each non-wall interior cell adds its own Image GameObject —
    // 224 of them on an 18×16 grid. The display-list walk + extra
    // WebGL state cost pushed each frame over budget, which made the
    // 110ms move tweens feel ~1s in wall-clock time on the playtest
    // module. One RT is one display-list entry; the cells become
    // baked pixels, not live GameObjects.
    //
    // Phaser 4 RT API specifics this code depends on (different from
    // v3, fwiw):
    //   - `.stamp(key, frame, x, y, { originX, originY })` is the
    //     "draw a texture at top-left (x,y)" entrypoint. Plain
    //     `.draw(key, x, y)` treats x/y as the texture's CENTER and
    //     would offset every tile by 16 px.
    //   - The command buffer is flushed only when `.render()` runs.
    //     Stamps queued before `render()` are otherwise invisible.
    let floorRT: Phaser.GameObjects.RenderTexture | null = null;
    if (mapCells) {
      floorRT = this.add
        .renderTexture(ARENA_X, ARENA_Y, ARENA_W, ARENA_H)
        .setOrigin(0);
    }

    for (let row = 0; row < ARENA_ROWS; row++) {
      for (let col = 0; col < ARENA_COLS; col++) {
        const x = ARENA_X + col * TILE;
        const y = ARENA_Y + row * TILE;
        const wall = isWall(col, row);
        if (wall) {
          // Trees / boulders for the wall ring — simple dark fill so
          // the arena border reads as "edge of the world" without
          // overcomplicating the tile shop.
          this.add
            .rectangle(x, y, TILE, TILE, 0x14140f, 1)
            .setOrigin(0)
            .setStrokeStyle(1, 0x1a1a2a);
          continue;
        }
        // Open floor — priority is map-supplied per-cell sprite (baked
        // into the RT), else the moody dark-green fallback for the
        // no-map default arena. Map sprites are stamped once, not added
        // as live GameObjects, so the per-frame cost stays flat.
        const cell = mapCells?.[row]?.[col] ?? null;
        const cellUrl = cell?.sprite ?? null;
        if (floorRT && cellUrl && this.textures.exists(cellUrl)) {
          // Coordinates are RT-local (origin at ARENA_X/Y), so no
          // arena offset here. `originX/Y: 0` stamps from the
          // texture's top-left rather than its center.
          floorRT.stamp(cellUrl, undefined, col * TILE, row * TILE, {
            originX: 0,
            originY: 0,
          });
        } else if (!floorRT) {
          // Default arena (no map picked) keeps the legacy
          // rectangle fill. With a map picked, missing cells fall
          // through silently — the RT's dark background shows through.
          this.add
            .rectangle(x, y, TILE, TILE, 0x14241a, 1)
            .setOrigin(0)
            .setStrokeStyle(1, 0x1a2a20);
        }
        // Per-tile click target for cardinal-step movement / attack.
        // Skip on unwalkable interior cells so the player can't click
        // into a rock or pit — combat would refuse the move anyway,
        // but suppressing the hit zone keeps the cursor honest.
        if (cell && cell.walkable === false) continue;
        const hit = this.add
          .rectangle(x, y, TILE, TILE, 0xffffff, 0)
          .setOrigin(0)
          .setInteractive({ useHandCursor: false });
        hit.on("pointerdown", () => this.onTileClicked(col, row));
      }
    }

    // Flush the stamp command buffer to the RT's internal texture.
    // Without this, all stamps queued above are buffered but never
    // painted, leaving the arena black.
    if (floorRT) floorRT.render();

    // Per-cell particle emitters — torches, fire, fairy, smoke.
    // Same `ANIMATION_CONFIGS` table the overworld + dungeon scenes
    // consume so a torch on the arena reads exactly like a torch on
    // the world map. Anchored at the cell's centre, depth 160 sits
    // above the floor RT but below party / monster bodies (250)
    // and the darkness overlay (20) — wait, below darkness, so
    // `refreshDarkness` re-gates each emitter's visibility against
    // `isCellVisibleToParty` to make sure an emitter on an unseen
    // cell doesn't pokes a flame through the darkness anyway.
    if (mapCells) {
      // Lazy white-circle source texture for the emitters. One-shot
      // init; idempotent on re-mount.
      if (!this.textures.exists("__particle")) {
        const g = this.add.graphics();
        g.fillStyle(0xffffff, 1);
        g.fillCircle(8, 8, 8);
        g.generateTexture("__particle", 16, 16);
        g.destroy();
      }
      for (let r = 0; r < ARENA_ROWS; r++) {
        for (let c = 0; c < ARENA_COLS; c++) {
          if (isWall(c, r)) continue;
          const cell = mapCells[r]?.[c];
          const animation = cell?.animation;
          if (!animation || animation === "none") continue;
          const cfg = (
            ANIMATION_CONFIGS as Record<string, unknown>
          )[animation];
          if (!cfg) continue;
          const ex = ARENA_X + c * TILE + TILE / 2;
          const ey = ARENA_Y + r * TILE + TILE / 2;
          const emitter = this.add.particles(
            ex,
            ey,
            "__particle",
            cfg as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
          );
          emitter.setDepth(160);
          this.arenaEmitters.set(`${c},${r}`, emitter);
        }
      }
    }

    // Darkness overlay — only when the launcher's Darkness toggle is
    // on. Collect every cell flagged `lightSource` into a static
    // LightSource list (party self-light is added per-redraw in
    // refreshDarkness) and create the Graphics that paints the
    // overlay. Slotted at depth 20 so it covers floor + bodies + HP
    // bars (a creature hiding in pitch black should genuinely
    // disappear) but stays under floating damage text (depth 50) and
    // the HUD pickers.
    if (this.darkness) {
      const lights: LightSource[] = [];
      if (this.arenaCells) {
        for (let r = 0; r < ARENA_ROWS; r++) {
          const sourceRow = this.arenaCells[r];
          if (!sourceRow) continue;
          for (let c = 0; c < ARENA_COLS; c++) {
            const cell = sourceRow[c];
            if (!cell?.lightSource) continue;
            const radius = typeof cell.lightRange === "number" && cell.lightRange > 0
              ? cell.lightRange
              : 3;
            lights.push({ col: c, row: r, radius });
          }
        }
      }
      this.staticLights = lights;
      this.darknessGfx = this.add.graphics().setDepth(20);
      // Sibling Graphics for the infravision red. MULTIPLY blend
      // means a red rectangle drawn here multiplies the underlying
      // floor pixel by red — black stays black, coloured floor
      // detail pixels surface as red specks. Same visual model as
      // the dungeon scene's `setTint` on per-cell Images, applied
      // here on a single Graphics rather than per-Image (the
      // arena bakes the floor into a RenderTexture). Depth 21
      // sits just above the black darkness fill so red rectangles
      // composite over any partial darkness at the same cell.
      this.infravisionGfx = this.add.graphics().setDepth(21);
      this.infravisionGfx.setBlendMode(Phaser.BlendModes.MULTIPLY);
      this.refreshDarkness();
    }
  }

  /**
   * "Can the party see this cell?" — the player-facing visibility gate
   * used by the target picker and the gold reach-hint overlay.
   *
   *   - Off when `darkness` is disabled (returns true unconditionally
   *     so legacy bright-fight behaviour is untouched).
   *   - On in darkness mode: a cell is visible iff `brightnessAt` says
   *     so — i.e. any static light source reaches it, or it falls
   *     inside the party's self-light pool around the active actor.
   *
   * Deliberately NOT consulted by directional attacks (magic_dart,
   * lightning_bolt, bows / crossbows / slings fired in a cardinal
   * direction) — those route through `traceDirectionalRay` and "fire
   * blind into the dark" is the whole point. AOE tile picks
   * (fireball) also skip this gate because the target is a coordinate
   * the player aims at, not a creature they're spotting.
   *
   * Uses the same `partyAnchor` rule as `refreshDarkness` so what the
   * player SEES is exactly what they can TARGET.
   */
  private isCellVisibleToParty(col: number, row: number): boolean {
    if (!this.darkness) return true;
    const cur = this.combat?.current;
    const partyAnchor =
      cur && cur.side === "party" && cur.hp > 0
        ? cur.position
        : this.combat?.combatants.find((c) => c.side === "party" && c.hp > 0)
            ?.position ?? { col: 1, row: 1 };
    const lit = brightnessAt(
      col, row, this.staticLights, partyAnchor, PARTY_LIGHT_RADIUS,
    ) > 0;
    if (lit) return true;
    // Infravision band — a cell in the active actor's LOS is
    // targetable when (a) the activation toggle is on AND (b) the
    // active actor's race grants the ability. Other actors don't
    // share the dwarf's heat vision; their turns see only the
    // standard lit cells.
    const infravisionOn =
      this.partyInfravisionActive &&
      !!cur &&
      cur.side === "party" &&
      cur.hp > 0 &&
      !!cur.race &&
      this.infravisionRaces.has(cur.race);
    if (infravisionOn) {
      const isBlocking = (c: number, r: number): boolean => {
        if (isWall(c, r)) return true;
        const cell = this.arenaCells?.[r]?.[c];
        return cell?.obstructs === true;
      };
      if (
        hasLineOfSight(
          partyAnchor.col,
          partyAnchor.row,
          col,
          row,
          isBlocking,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Re-paint the arena darkness overlay using the static light sources
   * from `arenaCells` plus a party self-light centred on the active
   * party member. Called whenever the active actor changes or moves so
   * the party's pool follows them around the map.
   *
   * Brightness per cell comes from Lighting.ts `brightnessAt`. The
   * cell's opacity is `(1 - brightness) * MAX_DARKNESS` so fully-lit
   * cells (right under a torch) read clear and cells outside every
   * pool sit at full darkness. Tile-quantised — there's no per-pixel
   * gradient, but that matches the engine's Chebyshev-distance light
   * model and the tactical grid the player is already reading.
   */
  /**
   * Turn the cell at (col, row) into a fire tile. Three pieces:
   *
   *   1. A new LightSource appended to `staticLights` so the
   *      darkness pass reads it like any authored torch.
   *   2. A fire particle emitter at the cell, depth 160 (same band
   *      as cell animations elsewhere — above the floor tint,
   *      below party / monsters / darkness).
   *   3. A `fireCells` entry tracking lightRange + damage + the
   *      emitter handle so a future burnout pass can clear the
   *      light source + destroy the emitter together.
   *
   * Re-igniting an already-fire cell just bumps the damage/range
   * if the new throw is hotter — keeps the fire from compounding
   * into multiple emitters on the same tile.
   *
   * Calls `refreshDarkness` so the new pool of light lands the
   * frame the torch hits. Lighting outside the darkness mode is
   * a no-op (the helper bails early when `!this.darkness`).
   */
  private igniteCell(
    col: number,
    row: number,
    lightRange: number,
    damage: number,
  ): void {
    const key = `${col},${row}`;
    const existing = this.fireCells.get(key);
    if (existing) {
      existing.lightRange = Math.max(existing.lightRange, lightRange);
      existing.damage = Math.max(existing.damage, damage);
      // Update the matching staticLight entry's radius.
      for (const light of this.staticLights) {
        if (light.col === col && light.row === row) {
          light.radius = existing.lightRange;
          break;
        }
      }
      this.refreshDarkness();
      return;
    }
    this.staticLights.push({ col, row, radius: lightRange });
    // Lazy white-circle particle source — shared with the cell-
    // emitter pass that runs in drawArena. Idempotent on existing
    // texture so a fire ignited late doesn't re-generate it.
    if (!this.textures.exists("__particle")) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 8);
      g.generateTexture("__particle", 16, 16);
      g.destroy();
    }
    const ex = ARENA_X + col * TILE + TILE / 2;
    const ey = ARENA_Y + row * TILE + TILE / 2;
    const cfg = ANIMATION_CONFIGS.fire;
    const emitter = this.add.particles(
      ex,
      ey,
      "__particle",
      cfg as unknown as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
    );
    emitter.setDepth(160);
    this.fireCells.set(key, { lightRange, damage, emitter });
    // Anyone already standing on the cell (the target of the throw,
    // most commonly) gets the first damage tick immediately rather
    // than waiting until their next move into the cell.
    this.applyFireDamageOnEntry(col, row);
    // Light pool needs to re-pool now that this source exists.
    this.refreshDarkness();
  }

  /**
   * Drop a persistent, damage-free light pool on a cell — the
   * "magical light" counterpart to {@link igniteCell}. Pushes a
   * LightSource, mounts a fairy particle emitter on the tile, and
   * re-pools the darkness overlay so the cell (and its radius) light
   * up. Unlike fire there's no `fireCells` entry, no damage tick, and
   * no per-turn bookkeeping — magical light hurts nothing.
   *
   * Used by the Cleric's combat Light spell AND by light-themed
   * ranged weapons (Dawnlight Bow) that cast Light wherever the arrow
   * lands. `tag` disambiguates the emitter key so two lights on the
   * same cell (or a light on a cell with an authored animation) don't
   * clobber each other — refreshDarkness only reads the first two
   * comma-separated tokens, so the trailing tag is free-form.
   */
  private lightCell(
    col: number,
    row: number,
    lightRange: number,
    tag = "light",
  ): void {
    this.staticLights.push({ col, row, radius: lightRange });
    if (!this.textures.exists("__particle")) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 8);
      g.generateTexture("__particle", 16, 16);
      g.destroy();
    }
    const ex = ARENA_X + col * TILE + TILE / 2;
    const ey = ARENA_Y + row * TILE + TILE / 2;
    const cfg = ANIMATION_CONFIGS.fairy;
    const emitter = this.add.particles(
      ex,
      ey,
      "__particle",
      cfg as unknown as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
    );
    emitter.setDepth(160);
    this.arenaEmitters.set(
      `${col},${row},${tag}_${this.staticLights.length}`,
      emitter,
    );
    this.refreshDarkness();
  }

  /**
   * Themed on-hit burst for a MELEE relic weapon, keyed off the
   * attacker's `weaponDamageType` (Sun Sword → fire, Rimefang Dagger →
   * ice, Meteorfall Mace → meteor). Ranged weapons don't route here —
   * their elemental payload plays on the shot (see resolveTarget /
   * fireDirectionalRange), so the caller gates on `!weaponRanged`.
   * Physical / untyped weapons get no extra burst (the normal hit
   * flash from `animateHit` still plays). Best-effort visual only;
   * never throws into the turn flow.
   */
  private playMeleeWeaponBurst(
    damageType: string,
    pos: { col: number; row: number },
  ): void {
    const dt = (damageType ?? "").toLowerCase();
    // Anchor to the TILE centre, not the target's body sprite — a
    // killing blow removes the sprite as part of the hit/death
    // animation, so reading `bodies.get(id)` here would either miss
    // or paint on a ghost. The cell stays put.
    const at = { x: this.tileX(pos.col), y: this.tileY(pos.row) };
    switch (dt) {
      case "fire":
        void radialBurst(this, at, VFX_COLOURS.fire, VFX_COLOURS.ember, 44);
        Sfx.play("explosion");
        break;
      case "ice":
      case "frost":
        // Icy shards — cool blue scatter with a white core.
        void radialBurst(this, at, VFX_COLOURS.lightning, VFX_COLOURS.white, 40);
        Sfx.play("chirp");
        break;
      case "meteor": {
        // Call a small meteor down onto the struck tile — reuses the
        // Starfall Sling's falling-star visual so the mace's "fallen
        // star" flavour reads at the point of impact.
        const fx = resolveProjectileEffect({ effect_type: "meteor_strike" });
        void fx(this, at, at);
        Sfx.play("explosion");
        break;
      }
      case "lightning":
        void radialBurst(this, at, VFX_COLOURS.lightning, VFX_COLOURS.white, 40);
        Sfx.play("explosion");
        break;
      case "arcane":
        void radialBurst(this, at, VFX_COLOURS.arcane, VFX_COLOURS.white, 40);
        Sfx.play("chirp");
        break;
      default:
        break;
    }
  }

  /**
   * Apply fire damage to every combatant currently standing on the
   * given cell. Called once when the cell ignites (catches anyone
   * the projectile landed on) and once per move when a combatant
   * enters a fire cell. Each combatant takes at most one fire hit
   * per turn — the `fireDamagedThisTurn` Set is the gate, cleared
   * each turn transition. No-op if `combat` hasn't been built yet.
   */
  private applyFireDamageOnEntry(col: number, row: number): void {
    if (!this.combat) return;
    const fire = this.fireCells.get(`${col},${row}`);
    if (!fire) return;
    for (const c of this.combat.combatants) {
      if (c.hp <= 0) continue;
      if (c.position.col !== col || c.position.row !== row) continue;
      if (this.fireDamagedThisTurn.has(c.id)) continue;
      this.fireDamagedThisTurn.add(c.id);
      const before = c.hp;
      c.hp = Math.max(0, c.hp - fire.damage);
      this.combat.log.push(
        c.hp <= 0
          ? `${c.name} burns to death in the fire (${before} → 0).`
          : `${c.name} burns in the fire (${before} → ${c.hp}).`,
      );
      this.refreshHp(c);
    }
  }

  private refreshDarkness(): void {
    // When the fight isn't dark — a bright arena, or Daylight has
    // banished the dark (it flips `this.darkness` off) — there's no
    // overlay to paint. The cast site already cleared the graphics and
    // re-showed sprites, so simply bail.
    if (!this.darkness || !this.darknessGfx) return;
    const g = this.darknessGfx;
    const ig = this.infravisionGfx;
    g.clear();
    ig?.clear();
    // Anchor the party self-light on the active actor when they're on
    // the party side; otherwise centre it on whichever party member is
    // alive so monsters' turns don't strand the player in the dark.
    const cur = this.combat?.current;
    const partyAnchor = (() => {
      if (cur && cur.side === "party" && cur.hp > 0) return cur.position;
      const fallback = this.combat?.combatants.find(
        (c) => c.side === "party" && c.hp > 0,
      );
      return fallback ? fallback.position : { col: 1, row: 1 };
    })();
    // Infravision applies ONLY when the active actor is a party
    // member whose race grants the ability AND the player has
    // engaged it via the launcher's Infravision toggle. Other
    // characters' turns (Selina, Pippin, Elminster) and monster
    // turns get pure darkness — they don't see in the dark.
    const infravisionOn =
      this.partyInfravisionActive &&
      !!cur &&
      cur.side === "party" &&
      cur.hp > 0 &&
      !!cur.race &&
      this.infravisionRaces.has(cur.race);
    // Predicate for `hasLineOfSight` — walls and `arenaCells`
    // obstructs entries block the Bresenham walk. Used by the
    // infravision pass to decide which dark cells the active
    // actor can actually "feel" the heat through.
    const isBlocking = (col: number, row: number): boolean => {
      if (isWall(col, row)) return true;
      const cell = this.arenaCells?.[row]?.[col];
      return cell?.obstructs === true;
    };
    const MAX_DARKNESS = 0.92;
    for (let r = 0; r < ARENA_ROWS; r++) {
      for (let c = 0; c < ARENA_COLS; c++) {
        // Wall ring already paints itself as solid dark fill, no point
        // double-darkening it.
        if (isWall(c, r)) continue;
        const b = brightnessAt(
          c, r, this.staticLights, partyAnchor, PARTY_LIGHT_RADIUS,
        );
        // Infravision band — cell is dark (no light source reached
        // it) but the active actor has LOS to it. Painted on the
        // sibling `infravisionGfx` which uses MULTIPLY blend, so
        // the underlying floor's coloured detail pixels surface as
        // red (matches the dungeon's `setTint(0xff0000)` look —
        // black sprite pixels stay black, green specks become red
        // specks). The black-darkness pass is skipped for these
        // cells; the multiply red effectively replaces it.
        if (
          infravisionOn &&
          b <= 0.001 &&
          ig &&
          hasLineOfSight(
            partyAnchor.col,
            partyAnchor.row,
            c,
            r,
            isBlocking,
          )
        ) {
          ig.fillStyle(0xff0000, 1);
          ig.fillRect(ARENA_X + c * TILE, ARENA_Y + r * TILE, TILE, TILE);
          continue;
        }
        const alpha = (1 - b) * MAX_DARKNESS;
        if (alpha <= 0.001) continue;
        g.fillStyle(0x000000, alpha);
        g.fillRect(ARENA_X + c * TILE, ARENA_Y + r * TILE, TILE, TILE);
      }
    }
    // Monster HP bars float 20 px above their body's cell — which
    // can lift them *outside* the arena's row-bound darkness paint
    // when the monster is near the top edge. Per-cell fillRect
    // doesn't cover that gap, so an unseen creature gives itself
    // away with a bright green bar. Gate visibility directly on
    // the bar pair using the same predicate the target picker
    // already uses (lit by torch / party self-light, or visible
    // through the active actor's infravision LOS).
    if (this.combat) {
      for (const c of this.combat.combatants) {
        if (c.side !== "enemies") continue;
        const bars = this.monsterHpBars.get(c.id);
        if (!bars) continue;
        // Dead monsters stay hidden regardless of visibility —
        // refreshHp already turns the bars off on HP <= 0; the
        // visibility flag here would otherwise turn the corpse's
        // empty bar back on if the party walked into LOS.
        if (c.hp <= 0) continue;
        const visible = this.isCellVisibleToParty(c.position.col, c.position.row);
        bars.bg.setVisible(visible);
        bars.bar.setVisible(visible);
      }
    }
    // Cell particle emitters render at depth 160 — above the
    // darkness graphics (20) — so a torch on an unseen cell would
    // poke its flame straight through the dark. Hide each emitter
    // whose cell isn't currently visible to the party. Same
    // predicate as the HP bars + the target picker.
    for (const [key, emitter] of this.arenaEmitters) {
      const [cs, rs] = key.split(",");
      emitter.setVisible(
        this.isCellVisibleToParty(Number(cs), Number(rs)),
      );
    }
    // Party sprite gate in darkness — same predicate the monster
    // bodies / HP bars / emitters use: a body is drawn iff its cell
    // is currently visible to the party (lit by a torch pool, by the
    // active actor's self-light, or seen through infravision LOS).
    //
    // Earlier this hid every non-anchor party member outright, which
    // gave a tell that was bad enough to file a bug against: a
    // teammate sitting in a cell the active actor's light bubble
    // clearly covered would still be invisible, so the actor could
    // bump into them ("blocked") without seeing what they'd bumped.
    // Gating on isCellVisibleToParty lines the party up with the
    // rest of the darkness-aware draws — what the player sees lit on
    // the floor is what they see standing on it.
    if (this.combat) {
      for (const c of this.combat.combatants) {
        if (c.side !== "party") continue;
        const body = this.bodies.get(c.id);
        if (!body) continue;
        if (!this.darkness) {
          // Daylight / lit scene — restore normal visibility (alive
          // sprites shown, dead bodies handled by refreshHp's tint).
          body.setVisible(true);
          continue;
        }
        if (c.hp <= 0) {
          // Dead party member — refreshHp owns the corpse rendering;
          // don't fight it here.
          continue;
        }
        body.setVisible(
          this.isCellVisibleToParty(c.position.col, c.position.row),
        );
      }
    }
  }

  private drawHud(): void {
    // Idempotent rebuild — destroy any leftover party cards / action
    // rows that survived from a previous create() pass before
    // stamping fresh ones. `init()` already does this on scene boot,
    // but a Phaser shutdown race can leave the new create() path
    // running with stale entries still in the maps; the user-reported
    // "action menu missing" symptom shows up specifically in the
    // forest-dungeon → combat → forest-dungeon → combat loop where
    // the timing is tight. Clearing here means a duplicate draw pass
    // can never leave us in a half-state.
    //
    // `staticDecor` is NOT cleared here because drawHeader / drawArena
    // already contributed to it before us — see `clearStaleDraws()`,
    // which runs once at the top of create() to handle that pool.
    for (const card of this.partyCards.values()) {
      card?.hpBar?.destroy();
      card?.hpText?.destroy();
      card?.mpBar?.destroy();
      card?.mpText?.destroy();
    }
    this.partyCards.clear();
    for (const t of this.actionTexts) t?.destroy();
    this.actionTexts.length = 0;
    for (const h of this.actionRowHandles) h?.destroy();
    this.actionRowHandles.length = 0;

    this.panel(HUD_X, HUD_Y, HUD_W, HUD_H);
    let cy = HUD_Y + 12;

    // PARTY header + mini cards
    this.track(this.add.text(HUD_X + 14, cy, "PARTY", FONT_HEAD()));
    cy += 24;
    const cardH = 60;
    const cardW = HUD_W - 24;
    const partySide = this.combat.combatants.filter((c) => c.side === "party");
    for (const c of partySide) {
      this.drawPartyCard(c, HUD_X + 12, cy, cardW, cardH);
      cy += cardH + 4;
    }

    cy += 8;
    this.track(
      this.add
        .rectangle(HUD_X + 12, cy, HUD_W - 24, 1, C.panelEdge)
        .setOrigin(0),
    );
    cy += 10;

    // -- Name'S TURN --
    this.turnText = this.track(
      this.add.text(HUD_X + 14, cy, "", FONT_HEAD()).setOrigin(0, 0),
    );
    cy += 22;
    this.movePointsText = this.track(
      this.add.text(HUD_X + 14, cy, "", FONT_MONO()).setOrigin(0, 0),
    );
    cy += 24;

    // Action menu — one Phaser row per slot in PARTY_ACTIONS. The
    // upper bound stays fixed so the layout reserves enough screen
    // real estate for every action even when most are hidden; the
    // refresh pass below blanks out rows it isn't using.
    for (let i = 0; i < PARTY_ACTIONS.length; i++) {
      const ry = cy + i * 22;
      const handle = this.add
        .rectangle(HUD_X + 12, ry, HUD_W - 24, 22, C.selectBg, 0)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      // The captured `i` is the RENDERED row index — `refreshActionMenu`
      // packs `visibleActions` into those rows top-down, so clicking
      // row 2 means "whichever action is currently drawn at row 2."
      // We look up the live action via the scene field so a refresh
      // that just shifted rows (e.g. running out of MP hid Cast) still
      // routes the click correctly.
      handle.on("pointerdown", () => {
        const action = this.visibleActions[i];
        if (!action) return; // blank slot — nothing rendered, ignore.
        // Translate back to the action's index in PARTY_ACTIONS so the
        // arrow-key navigation (which still operates on the canonical
        // list) stays consistent with what was just clicked.
        const cursorIdx = PARTY_ACTIONS.findIndex((a) => a.id === action.id);
        if (cursorIdx >= 0) this.actionCursor = cursorIdx;
        try {
          this.activateAction();
        } catch (err) {
          // Don't let a thrown exception in the per-action handler
          // tear down the scene loop. Log + surface in the combat log
          // so the player sees something happened, and the developer
          // can grab the stack from the console.
          // eslint-disable-next-line no-console
          console.error("[CombatScene] action dispatch failed:", err);
          this.combat.log.push(`(internal) action failed — see console.`);
          this.refreshLog();
        }
      });
      const t = this.add.text(HUD_X + 24, ry + 2, "", FONT_BODY());
      this.actionRowHandles.push(handle);
      this.actionTexts.push(t);
    }
  }

  private drawPartyCard(
    c: Combatant, x: number, y: number, w: number, h: number,
  ): void {
    // Card frame.
    this.track(
      this.add
        .rectangle(x, y, w, h, 0x1c1c2a, 1)
        .setOrigin(0)
        .setStrokeStyle(1, C.panelEdge),
    );
    // Avatar
    const avatar = 44;
    if (c.sprite && this.textures.exists(c.sprite)) {
      const img = this.add.image(x + 8, y + 8, c.sprite).setOrigin(0);
      img.setDisplaySize(avatar, avatar);
      this.track(img);
    } else {
      const colorHex = Phaser.Display.Color.GetColor(...c.color);
      this.track(
        this.add.rectangle(x + 8, y + 8, avatar, avatar, colorHex).setOrigin(0),
      );
    }
    const tx = x + avatar + 16;
    this.track(this.add.text(tx, y + 4, c.name, FONT_BODY()));

    // HP bar (always present). Inner fill width = barW - 2 to leave a
    // 1px panel-edge frame on either side. Stored as fullBarW so
    // refreshHp can recompute from %.
    const barW = w - (tx - x) - 12;
    const fullBarW = barW - 2;
    const hpBarY = y + 22;
    this.track(
      this.add.rectangle(tx, hpBarY, barW, 8, 0x1c1c2a, 1).setOrigin(0)
        .setStrokeStyle(1, C.panelEdge),
    );
    const hpBar = this.add
      .rectangle(tx + 1, hpBarY + 1, fullBarW, 6, C.hpFull, 1)
      .setOrigin(0);
    const hpText = this.add
      .text(tx + barW - 2, hpBarY - 14, `${c.hp}/${c.maxHp}`,
            FONT_MONO(C.dim))
      .setOrigin(1, 0);

    // MP bar — drawn only for casters (members with maxMp set). Combat
    // doesn't carry MP on Combatant; we read the live PartyMember.
    let mpBar: Phaser.GameObjects.Rectangle | undefined;
    let mpText: Phaser.GameObjects.Text | undefined;
    const member = this.memberByCombatantId(c.id);
    if (member && member.max_mp > 0) {
      const mpBarY = y + 44;
      this.track(
        this.add.rectangle(tx, mpBarY, barW, 8, 0x1c1c2a, 1).setOrigin(0)
          .setStrokeStyle(1, C.panelEdge),
      );
      mpBar = this.add
        .rectangle(tx + 1, mpBarY + 1, fullBarW, 6, C.mp, 1)
        .setOrigin(0);
      mpText = this.add
        .text(tx + barW - 2, mpBarY - 14, `${member.mp}/${member.max_mp}`,
              FONT_MONO(C.dim))
        .setOrigin(1, 0);
    }

    // hpBar / hpText / mpBar / mpText are tracked via partyCards
    // (their map already gets defensively destroyed in init()), so
    // they don't need to go on staticDecor.
    this.partyCards.set(c.id, { hpBar, hpText, mpBar, mpText, fullBarW });
  }

  private drawLog(): void {
    this.panel(LOG_X, LOG_Y, LOG_W, LOG_H);
    this.logText = this.track(
      this.add.text(LOG_X + 14, LOG_Y + 10, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: hex(C.body),
        lineSpacing: 2,
        wordWrap: { width: LOG_W - 28, useAdvancedWrap: true },
      }),
    );
  }

  // ── Combatants ───────────────────────────────────────────────────

  private tileX(col: number): number { return ARENA_X + col * TILE + TILE / 2; }
  private tileY(row: number): number { return ARENA_Y + row * TILE + TILE / 2; }

  private drawCombatants(): void {
    // Idempotent rebuild — see drawHud() for the rationale. Phaser
    // races during forest-dungeon → combat re-entry could leave
    // bodies / selection rings / monster HP bars from the previous
    // encounter in the maps even after init()'s defensive destroy,
    // producing the "phantom green bars floating over empty grass"
    // visual the user reported. Clearing at the top of the draw
    // closes that race regardless of init's timing.
    for (const body of this.bodies.values()) body?.destroy();
    this.bodies.clear();
    for (const ring of this.selRings.values()) ring?.destroy();
    this.selRings.clear();
    // Re-seed wielder auras too. Same idempotent-rebuild reasoning
    // as bodies / selection rings — the timer references a body
    // we're about to destroy, so cancelling here closes the race.
    for (const t of this.wieldAuras.values()) t.remove();
    this.wieldAuras.clear();
    for (const b of this.monsterHpBars.values()) {
      b.bg?.destroy();
      b.bar?.destroy();
    }
    this.monsterHpBars.clear();
    // Note: arenaEmitters live for the lifetime of the arena draw
    // (they're cell-bound, not actor-bound), so this combatant-
    // refresh path doesn't touch them. The wholesale teardown in
    // `clearStaleDraws` handles their disposal on scene exit.

    for (const c of this.combat.combatants) {
      const x = this.tileX(c.position.col);
      const y = this.tileY(c.position.row);
      const ring = this.add
        .rectangle(x, y, TILE, TILE, C.cursor, 0)
        .setStrokeStyle(2, C.cursor)
        .setVisible(false);
      this.selRings.set(c.id, ring);
      let body: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
      // `battleScale` is set by monsters.ts for boss-class creatures
      // (Dragons / Man Eaters at 2 → 64×64). Default 1 keeps the
      // existing 32×32 silhouette for everyone else.
      const scale = c.battleScale && c.battleScale > 1 ? c.battleScale : 1;
      if (c.sprite && this.textures.exists(c.sprite)) {
        // Sprites are native 32×32 — render unscaled so transparency
        // holds and the pixel art stays crisp.
        body = this.add.image(x, y, c.sprite);
        if (scale !== 1) {
          body.setDisplaySize(TILE * scale, TILE * scale);
          body.setDepth(2); // above same-tile fellows so the giant reads
        }
      } else {
        const colorHex = Phaser.Display.Color.GetColor(...c.color);
        const size = (TILE - 4) * scale;
        body = this.add
          .rectangle(x, y, size, size, colorHex)
          .setStrokeStyle(2, 0x0a0a14);
      }
      this.bodies.set(c.id, body);

      // Relic-tier wielder aura — Sun Sword draws a pulsing gold
      // halo beneath the wielder each ~700ms so the player can see
      // at a glance "this character is wielding something powerful."
      // The pulse is a fresh ring per tick, anchored at the body's
      // CURRENT coordinates, so the aura naturally tracks movement
      // without per-frame position sync. Skipped at hp <= 0 inside
      // the callback so a corpse doesn't keep glowing — and resumes
      // automatically if the character is raised mid-fight.
      if (typeof c.wieldAuraColor === "number") {
        this.startWielderAura(c.id, c.wieldAuraColor);
      }

      // Floating HP bar above each enemy. The party gets full HP/MP
      // cards in the HUD, so we keep the arena uncluttered for them.
      if (c.side === "enemies") {
        const fullW = 26;
        const offsetY = 20;
        const bg = this.add
          .rectangle(x, y - offsetY, 30, 5, 0x10101a, 0.85)
          .setOrigin(0.5, 0.5)
          .setStrokeStyle(1, C.panelEdge)
          .setDepth(15);
        const bar = this.add
          .rectangle(x - fullW / 2, y - offsetY, fullW, 3, C.hpFull, 1)
          .setOrigin(0, 0.5)
          .setDepth(16);
        this.monsterHpBars.set(c.id, { bg, bar, fullW, offsetY });
      }
    }
  }

  // ── Input ────────────────────────────────────────────────────────

  private installInput(): void {
    const k = this.input.keyboard;
    if (!k) return;
    // Phaser doesn't auto-clean keyboard listeners across scene.start
    // cycles — each combat → dungeon → combat re-entry would stack
    // another `keydown-ENTER` handler on top of the previous one.
    // After a few rounds, pressing Enter on the Cast row would fire
    // activateAction twice in a row: first call opens the spell
    // picker, second call immediately dispatches whatever the cursor
    // is on (the first spell), so the player never sees the picker.
    // Same risk for every other key. Remove all listeners up front so
    // each create() starts from a clean slate.
    k.removeAllListeners();
    const stepMap: Record<string, Direction> = {
      W: "n", A: "w", S: "s", D: "e",
      UP: "n", DOWN: "s", LEFT: "w", RIGHT: "e",
    };
    Object.entries(stepMap).forEach(([key, dir]) => {
      k.on(`keydown-${key}`, () => this.onArrowKey(key, dir));
    });
    k.on("keydown-ENTER", () => this.activateAction());
    // SPACE is a quick "end turn" shortcut from the main action menu —
    // skips having to navigate the cursor down to "End Turn". Inside
    // any picker sub-mode it still activates the cursored row, so the
    // keyboard flow there isn't disrupted.
    k.on("keydown-SPACE", () => this.onSpacePressed());
    k.on("keydown-ESC",   () => this.cancelSubMode());
    // Number keys 1..9 dispatch through pick-throw / pick-spell /
    // pick-target sub-modes. We register a handler per digit since
    // Phaser keys are individual.
    for (let i = 1; i <= 9; i++) {
      k.on(`keydown-${["ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE"][i-1]}`, () => this.onDigit(i));
    }
    // [T] — while picking a target for a precision shot with
    // ignitable ammo (Silver Bow + Fire Arrows, crossbow + Fire
    // Bolts), switch to the free tile picker so the burning shaft
    // can flare an empty / dark cell instead of a creature. No-op
    // in every other mode.
    k.on("keydown-T", () => this.onTileAimKey());
    // Debug cheat: Shift+K instantly defeats every alive enemy and
    // routes through the standard victory path (so quest credit,
    // dungeon-monster cleanup, XP/loot drops all run normally). Hidden
    // chord — a player who happens to mash K won't trigger it without
    // also holding Shift. Gated by `SMITE_ALL_CHEAT` for an easy
    // disable when we ship.
    if (SMITE_ALL_CHEAT) {
      k.on("keydown-K", (event: KeyboardEvent) => {
        if (event.shiftKey) this.cheatSmiteAll();
      });
    }
  }

  /**
   * Debug-only "Smite All" — zero every alive enemy's HP, refresh
   * the HP bars, log a flavor line, and ride the standard
   * `endEncounter` flow. Bound to Shift+K via `installInput`.
   *
   * Skips when the encounter is already over (avoid double-firing
   * the victory transition) or when player input is locked (mid-
   * animation, in a picker sub-mode, etc. — we don't want a stray
   * Shift+K mashing through during a tween).
   */
  private cheatSmiteAll(): void {
    if (this.combat.isOver || this.ended) return;
    if (this.busy) return;
    const alive = this.combat.combatants.filter(
      (c) => c.side === "enemies" && c.hp > 0,
    );
    if (alive.length === 0) return;
    for (const e of alive) {
      e.hp = 0;
      this.refreshHp(e);
    }
    this.combat.log.push(
      `*** Divine wrath descends — ${alive.length} foe${alive.length === 1 ? "" : "s"} smitten! ***`
    );
    this.refreshLog();
    Sfx.play("critical");
    // Standard victory path — endEncounter shows the "Victory!"
    // overlay, plays the victory sting, and chains into
    // awardRewardsThenExit for XP / loot / quest credit / dungeon
    // monster cleanup. Setting every enemy hp to 0 above is enough
    // for `combat.isOver` to be true and `combat.winner` to read
    // "party", which is all endEncounter checks.
    this.endEncounter();
  }

  /** ESC backs out of any sub-mode, or does nothing in default mode. */
  private cancelSubMode(): void {
    if (this.mode === "default") return;
    this.mode = "default";
    this.pendingAction = null;
    this.throwOptions = [];
    this.useOptions = [];
    this.equipOptions = [];
    this.spellOptions = [];
    this.abilityOptions = [];
    this.ammoOptions = [];
    this.pendingRangeWeapon = null;
    this.pickerCursor = 0;
    this.clearPicker();
    this.clearTargetBadges();
    this.clearTileCursor();
    this.refreshAll();
  }

  /**
   * Number-key dispatch — meaning depends on current sub-mode.
   *
   * In the scrollable pickers (pick-throw / pick-spell), 1-9 picks
   * the Nth row of the *visible window* (relative to scroll), not
   * the Nth absolute index. This keeps the shortcut consistent with
   * what the player sees on screen.
   */
  private onDigit(n: number): void {
    if (this.mode === "pick-throw" || this.mode === "pick-spell"
        || this.mode === "pick-use" || this.mode === "pick-equip"
        || this.mode === "pick-ammo") {
      const total =
        this.mode === "pick-throw" ? this.throwOptions.length :
        this.mode === "pick-use"   ? this.useOptions.length :
        this.mode === "pick-equip" ? this.equipOptions.length :
        this.mode === "pick-ammo"  ? this.ammoOptions.length :
        this.spellOptions.length;
      if (total === 0) return;
      const visibleMax = 12;
      const visibleCount = Math.min(visibleMax, total);
      const half = Math.floor(visibleCount / 2);
      const topRow = Math.max(0, Math.min(total - visibleCount, this.pickerCursor - half));
      const absIndex = topRow + (n - 1);
      if (absIndex < 0 || absIndex >= total) return;
      this.pickerCursor = absIndex;
      this.activateAction();
      return;
    }
    if (this.mode === "pick-target") {
      const targets = this.currentTargetList();
      const target = targets[n - 1];
      if (target) this.resolveTarget(target);
      return;
    }
  }

  /**
   * Arrow-key dispatch — when the action cursor is sitting on a menu
   * row, UP/DOWN walks the menu. Otherwise (for WASD or any time the
   * cursor isn't in the menu), the keys move the active fighter.
   *
   * The "is the menu focused?" rule is implicit: UP and DOWN always
   * walk the menu when it's the player's turn (since vertical
   * movement on the arena is also UP/DOWN — disambiguated by holding
   * shift in a future slice; for V1 the menu wins).
   *
   * To keep movement available, only WASD steps the avatar; arrow
   * keys navigate the menu.
   */
  private onArrowKey(key: string, dir: Direction): void {
    if (!this.canTakePlayerInput()) return;
    // In a scrollable picker UP/DOWN walks the picker cursor — not
    // the avatar.
    if (this.mode === "pick-throw" || this.mode === "pick-spell"
        || this.mode === "pick-use" || this.mode === "pick-equip"
        || this.mode === "pick-ammo") {
      if (key === "UP")   return this.movePickerCursor(-1);
      if (key === "DOWN") return this.movePickerCursor(1);
      return; // ignore left/right in pickers
    }
    // In pick-target mode arrow keys cycle the highlighted target
    // — the 1-9 number row stays available too, but arrows + Enter
    // give the player a keyboard path that doesn't depend on tiny
    // badge digits being legible on top of monster sprites.
    if (this.mode === "pick-target") {
      // Map UP/LEFT → previous, DOWN/RIGHT → next. Wraps around the
      // ends so a long thumb-press feels predictable.
      if (key === "UP" || key === "LEFT") return this.moveTargetCursor(-1);
      if (key === "DOWN" || key === "RIGHT") return this.moveTargetCursor(1);
      return;
    }
    // In tile-pick mode all four arrows nudge the reticle.
    if (this.mode === "pick-tile") {
      if (key === "UP")    return this.moveTileCursor(0, -1);
      if (key === "DOWN")  return this.moveTileCursor(0, 1);
      if (key === "LEFT")  return this.moveTileCursor(-1, 0);
      if (key === "RIGHT") return this.moveTileCursor(1, 0);
      // WASD fall through to the same handler.
      if (dir === "n") return this.moveTileCursor(0, -1);
      if (dir === "s") return this.moveTileCursor(0, 1);
      if (dir === "w") return this.moveTileCursor(-1, 0);
      if (dir === "e") return this.moveTileCursor(1, 0);
      return;
    }
    // Direction-pick mode: ANY of the four arrows fires the staged
    // action. Both directional spells (magic_dart, lightning_bolt)
    // and directional weapons (short bow / long bow / sling) share
    // the same pick-direction mode; the pending action's kind tells
    // us which fire path to take.
    if (this.mode === "pick-direction") {
      if (this.pendingAction?.kind === "range-direction") {
        void this.fireDirectionalRange(dir);
      } else {
        void this.fireDirectionalSpell(dir);
      }
      return;
    }
    if (key === "UP")    return this.moveActionCursor(-1);
    if (key === "DOWN")  return this.moveActionCursor(1);
    if (key === "LEFT" || key === "RIGHT") return;
    void this.tryPlayerStep(dir);
  }

  /** [T] inside the enemy target picker — only when the staged
   *  action is a precision range shot with ignitable ammo — swaps
   *  to the free tile picker (`startRangeTilePicking`). Lets the
   *  player choose between "shoot the monster" (default, crossbow-
   *  style picker) and "flare that dark corner" without backing
   *  out to the action menu. */
  private onTileAimKey(): void {
    if (!this.canTakePlayerInput()) return;
    if (this.mode !== "pick-target") return;
    const pending = this.pendingAction;
    if (pending?.kind !== "range" || !pending.ammoId) return;
    const ammoDef = this.items.get(pending.ammoId);
    if (!ammoDef?.ignite) return;
    this.clearTargetBadges();
    this.startRangeTilePicking(pending.weapon, pending.ammoId);
  }

  /** Walk the target-picker cursor through `currentTargetList()`
   *  with wrap-around. Repaints the badges so the highlighted index
   *  swaps from one target to the next and the ring follows. No-op
   *  when there are no targets (the picker shows "no valid targets"
   *  hint in that case and Enter would do nothing). */
  private moveTargetCursor(delta: number): void {
    const targets = this.currentTargetList();
    if (targets.length === 0) return;
    this.targetCursor =
      (this.targetCursor + delta + targets.length) % targets.length;
    // Re-render badges so the bold-cursor highlight + ring follow
    // the cursor. drawTargetBadges destroys + recreates the badge
    // text nodes; cheap on a list capped at 9.
    const side =
      this.pendingAction?.kind === "cast" &&
      classifyCombatCast(this.pendingAction.spell) === "pick-ally"
        ? "party"
        : "enemies";
    this.drawTargetBadges(side);
  }

  /** Move the picker cursor through the active option list. Re-renders
   *  the picker so the highlight + scroll window update. */
  private movePickerCursor(delta: number): void {
    const total =
      this.mode === "pick-throw" ? this.throwOptions.length :
      this.mode === "pick-spell" ? this.spellOptions.length :
      this.mode === "pick-use"   ? this.useOptions.length :
      this.mode === "pick-equip" ? this.equipOptions.length :
      this.mode === "pick-ammo"  ? this.ammoOptions.length : 0;
    if (total === 0) return;
    this.pickerCursor = (this.pickerCursor + delta + total) % total;
    if (this.mode === "pick-throw") this.refreshThrowPicker();
    else if (this.mode === "pick-spell") this.refreshSpellPicker();
    else if (this.mode === "pick-use") this.refreshUsePicker();
    else if (this.mode === "pick-equip") this.refreshEquipPicker();
    else if (this.mode === "pick-ammo") this.refreshAmmoPicker();
  }

  private moveActionCursor(delta: number): void {
    if (this.mode !== "default") return;
    // Shared source of truth with `refreshActionMenu` — both consult
    // the same enable predicates so the cursor can never land on a
    // hidden row. Earlier this method duplicated the predicate list
    // and silently drifted (the Abilities row wasn't in its skip
    // table, so up/down would stop on an invisible "Abilities" slot
    // for any non-Cleric/Paladin). Centralising kills the drift.
    const visible = this.computeVisibleActions();
    if (visible.length === 0) return;
    const enabledIdx = visible.map((a) =>
      PARTY_ACTIONS.findIndex((p) => p.id === a.id),
    );
    let cur = enabledIdx.indexOf(this.actionCursor);
    if (cur < 0) cur = 0;
    const next = (cur + delta + enabledIdx.length) % enabledIdx.length;
    this.actionCursor = enabledIdx[next];
    this.refreshActionMenu();
  }

  /**
   * SPACE is a shortcut for "end this character's turn" from the main
   * action menu — saves the player navigating the cursor down to End
   * Turn. Inside any picker sub-mode (throw, spell, tile, target) it
   * falls through to `activateAction` so the cursor's row still fires,
   * preserving the existing keyboard ergonomics there.
   */
  private onSpacePressed(): void {
    if (!this.canTakePlayerInput()) return;
    if (this.mode === "default") {
      this.onEndTurnClicked();
      return;
    }
    this.activateAction();
  }

  private activateAction(): void {
    if (!this.canTakePlayerInput()) return;
    // Enter inside a scrollable picker activates the cursored row.
    if (this.mode === "pick-throw") {
      const opt = this.throwOptions[this.pickerCursor];
      if (!opt) return;
      // Items whose effect lands on the cell (a lit torch that
      // ignites the ground) need pick-tile mode — the player has to
      // be able to aim at any open square in range, dark or empty,
      // not just a visible enemy. Drains the item the same way the
      // creature-target path does (`consumeThrowItem` is the rule
      // we don't refund mis-thrown items).
      if (opt.item.ignite) {
        this.startThrowTilePicking(opt.item);
        this.consumeThrowItem(opt);
        return;
      }
      this.startTargetingFor({ kind: "throw", item: opt.item }, "enemies");
      this.consumeThrowItem(opt);
      return;
    }
    if (this.mode === "pick-target") {
      // Enter / Space inside pick-target activates the highlighted
      // target. Mirrors how 1-9 jumps to a specific row but uses
      // the arrow-key cursor as the source of truth. No-op when
      // the list is empty (the player still has Esc / End Turn).
      const targets = this.currentTargetList();
      const t = targets[this.targetCursor];
      if (t) void this.resolveTarget(t);
      return;
    }
    if (this.mode === "pick-spell") {
      const spell = this.spellOptions[this.pickerCursor];
      if (!spell) return;
      void this.dispatchSpell(spell);
      return;
    }
    if (this.mode === "pick-ability") {
      const ability = this.abilityOptions[this.pickerCursor];
      if (!ability) return;
      void this.dispatchAbility(ability);
      return;
    }
    if (this.mode === "pick-ammo") {
      this.commitAmmoPick();
      return;
    }
    if (this.mode === "pick-use") {
      const opt = this.useOptions[this.pickerCursor];
      if (!opt) return;
      this.applyUseItem(opt);
      return;
    }
    if (this.mode === "pick-equip") {
      const opt = this.equipOptions[this.pickerCursor];
      if (!opt) return;
      this.applyEquipItem(opt);
      return;
    }
    if (this.mode === "pick-tile") {
      // pick-tile is shared between AOE / teleport / summon spells
      // (kind: "tile"), ignitable thrown items (kind: "throw-tile"),
      // and precision-bow fire arrows shot at a tile
      // (kind: "range-tile") — the Silver Bow flavour that lets the
      // player ignite empty cells to light up dark arenas. Branch
      // on the pending action kind so the right resolver runs.
      if (this.pendingAction?.kind === "throw-tile") {
        void this.resolveThrowTile();
      } else if (this.pendingAction?.kind === "range-tile") {
        void this.resolveRangeTile();
      } else {
        void this.resolveTileSpell();
      }
      return;
    }
    if (this.mode !== "default") return; // other sub-modes use number keys
    const a = PARTY_ACTIONS[this.actionCursor];
    if (!a) return;
    if (a.id === "attack") {
      const me = this.combat.current;
      const dirs: Direction[] = ["n", "s", "e", "w"];
      const offsets: Record<Direction, [number, number]> = {
        n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
      };
      for (const d of dirs) {
        const [dc, dr] = offsets[d];
        const occ = this.combat.combatantAt(me.position.col + dc, me.position.row + dr);
        if (occ && occ.side !== me.side && occ.hp > 0) {
          void this.tryPlayerStep(d);
          return;
        }
      }
      this.combat.log.push(`${me.name} has no adjacent enemy to attack.`);
      this.refreshLog();
      return;
    }
    if (a.id === "range")   return this.startRangeAttack();
    if (a.id === "throw")   return this.openThrowPicker();
    if (a.id === "cast")    return this.openSpellPicker();
    if (a.id === "ability") return this.openAbilityPicker();
    if (a.id === "use")     return this.openUsePicker();
    if (a.id === "equip")   return this.openEquipPicker();
    if (a.id === "end")     return this.onEndTurnClicked();
  }

  /**
   * Begin a ranged attack with the currently equipped weapon —
   * skip the item picker (the weapon is already chosen) and go
   * straight to target select. Only valid enemies within the
   * weapon's `maxRangeFor` distance get badges.
   */
  private startRangeAttack(): void {
    const member = this.memberForCurrent();
    if (!member) return;
    const weaponName = member.equipped.hands;
    if (!weaponName) {
      this.combat.log.push(`${this.combat.current.name} has no weapon equipped.`);
      this.refreshLog();
      return;
    }
    const weapon = this.items.get(weaponName);
    if (!weapon || !isRanged(weapon)) {
      this.combat.log.push(`${this.combat.current.name}'s ${weaponName} is not a ranged weapon.`);
      this.refreshLog();
      return;
    }
    // Ammo picker — only opens when the party carries multiple
    // compatible ammos for this weapon (Arrows + Fire Arrows on
    // any bow is the canonical case). Single-ammo case skips
    // straight to target / direction selection so the common
    // path stays one-click. When the player picks an ammo the
    // commit handler routes back through `proceedRangeWithAmmo`
    // with the chosen id stamped on the pending action.
    const partyData = gameState.partyData;
    const ammos = partyData ? compatibleAmmoIds(weapon, partyData) : [];
    if (ammos.length > 1) {
      this.ammoOptions = ammos;
      this.pendingRangeWeapon = weapon;
      this.pickerCursor = 0;
      this.mode = "pick-ammo";
      this.refreshAmmoPicker();
      return;
    }
    // Zero / one ammo — proceed directly. `ammos[0]` may be
    // undefined if the gating was already wrong somehow; the
    // resolver falls back to `weapon.ammo` in that case.
    this.proceedRangeWithAmmo(weapon, ammos[0]);
  }

  /** Continue the Range flow once the ammo is decided. Pulled out
   *  of `startRangeAttack` so the ammo picker's commit can reuse
   *  the directional-vs-precision branch without duplicating it.
   *
   *  Two sub-paths today:
   *    1. Directional weapon (short bow, long bow, sling) → pick a
   *       direction; the arrow flies in a line.
   *    2. Precision weapon (crossbow, Silver Bow) → enemy target
   *       picker (number keys / arrows + Enter) regardless of ammo.
   *       Ignitable ammo (Fire Arrows / Fire Bolts) resolves the
   *       same attack and then sets the target's tile on fire;
   *       pressing [T] inside the picker switches to the free tile
   *       picker so the burning shaft can flare an empty / dark
   *       cell instead. */
  private proceedRangeWithAmmo(weapon: Item, ammoId?: string): void {
    if (weapon.targeting === "directional") {
      this.pendingAction = { kind: "range-direction", weapon, ammoId };
      this.mode = "pick-direction";
      this.clearPicker();
      const ammoDef = ammoId ? this.items.get(ammoId) : undefined;
      const ammoLabel = ammoDef?.name ?? weapon.name;
      this.combat.log.push(
        `${this.combat.current.name} nocks ${ammoLabel} on their ${weapon.name} — pick a direction.`,
      );
      this.refreshLog();
      this.drawActionHints();
      return;
    }
    // Precision branch — ALL ammo (regular and ignitable) uses the
    // standard enemy target picker: number keys / arrow keys + Enter,
    // exactly like the crossbow. The range resolution already handles
    // ignitable ammo (full d20 attack, then the target's tile catches
    // fire hit-or-miss), so fire arrows don't need a separate flow to
    // hurt monsters. What they DO keep is the free tile picker as an
    // opt-in: pressing [T] inside the target picker switches to it so
    // the player can still flare an empty / dark cell.
    const ammoDef = ammoId ? this.items.get(ammoId) : undefined;
    this.startTargetingFor({ kind: "range", weapon, ammoId }, "enemies");
    if (ammoId && ammoDef?.ignite) {
      this.combat.log.push(
        `Pick a target for ${ammoDef.name ?? ammoId} — or press [T] to aim at a tile instead.`,
      );
      this.refreshLog();
    }
  }

  /** Begin tile selection for a precision-bow fire-arrow shot —
   *  identical UX to `startThrowTilePicking` but the projectile is
   *  a bow shot (ammo consumed from the stash) and the range
   *  comes from the weapon, not the ammo. Cursor starts one tile
   *  north of the caster so a quick Enter ignites the ground in
   *  front of them. */
  private startRangeTilePicking(weapon: Item, ammoId: string): void {
    const me = this.combat.current;
    const start = {
      col: Math.max(1, Math.min(ARENA_COLS - 2, me.position.col)),
      row: Math.max(1, Math.min(ARENA_ROWS - 2, me.position.row - 1)),
    };
    this.tileCursorPos = start;
    this.pendingAction = { kind: "range-tile", weapon, ammoId };
    this.mode = "pick-tile";
    this.clearPicker();
    this.refreshTileCursor();
    this.renderRangeTilePickerHint(weapon, ammoId);
    // Range overlay — same painter the throw-tile picker uses.
    // drawActionHints reads the pending action's kind to size the
    // reach grid; range-tile uses the weapon's max range.
    this.drawActionHints();
  }

  /** Bottom-of-HUD prompt for the range-tile picker — describes the
   *  weapon + ammo, the range, and the keyboard controls. Mirrors
   *  the throw-tile hint so both pickers feel the same. */
  private renderRangeTilePickerHint(weapon: Item, ammoId: string): void {
    this.clearPicker();
    const range = maxRangeFor(weapon);
    const ammoDef = this.items.get(ammoId);
    const ammoName = ammoDef?.name ?? ammoId;
    const lines = [
      `Firing: ${ammoName}`,
      `Bow: ${weapon.name} (range ${range})`,
      "[↑↓←→] move reticle",
      "[Enter] fire (attacks creature on tile)",
      "[ESC]   cancel",
    ];
    const w = HUD_W - 12, h = lines.length * 18 + 28;
    const x = HUD_X + 6, y = HUD_Y + HUD_H - 6 - h;
    this.pickerObjects.push(
      this.add.rectangle(x, y, w, h, 0x10101a, 0.98)
        .setOrigin(0)
        .setStrokeStyle(2, C.accent)
    );
    this.pickerObjects.push(
      this.add.text(x + 10, y + 8, "PICK A TILE OR TARGET", FONT_HEAD(C.accent))
    );
    lines.forEach((line, i) => {
      this.pickerObjects.push(
        this.add.text(x + 10, y + 30 + i * 18, line, FONT_BODY())
      );
    });
  }

  /** Resolve a confirmed range-tile fire-arrow shot. Mirrors
   *  `resolveThrowTile` but consumes ammo from the party stash
   *  (instead of decrementing a thrown-item stack) and uses the
   *  weapon's projectile SFX. If a creature occupies the picked
   *  cell, the shot resolves as a full d20 attack against it (same
   *  as the enemy-picker range branch — friendly fire included).
   *  The cell is then unconditionally ignited, hit or miss; anyone
   *  standing there also takes the first fire tick via
   *  `igniteCell → applyFireDamageOnEntry`. */
  private async resolveRangeTile(): Promise<void> {
    const action = this.pendingAction;
    if (!action || action.kind !== "range-tile") return;
    const me = this.combat.current;
    const weapon = action.weapon;
    const ammoId = action.ammoId;
    const target = { ...this.tileCursorPos };
    // If a living enemy stands on the picked tile, resolve the shot
    // as a proper ranged attack (d20 roll + bow damage) instead of
    // just lighting the ground — the `range` branch of resolveTarget
    // already handles fire-arrow ignition on hit OR miss, so the
    // burning-tile behaviour is preserved. Without this check the
    // Silver Bow couldn't shoot AT monsters with Fire Arrows nocked
    // (the reported bug): the tile picker only ever ran the ignite
    // path. Ammo is NOT consumed here — resolveTarget's range branch
    // does its own stash deduction; consuming in both spots would
    // double-charge the shot.
    const occupant = this.combat.combatantAt(target.col, target.row);
    if (occupant && occupant.side !== me.side && occupant.hp > 0) {
      this.mode = "default";
      this.clearTileCursor();
      this.clearPicker();
      this.pendingAction = { kind: "range", weapon, ammoId };
      await this.resolveTarget(occupant);
      return;
    }
    // Consume ammo first — if the stash is empty (race condition
    // between the picker entry + this commit) fizzle cleanly.
    const partyData = gameState.partyData;
    if (partyData && !consumeAmmoFromStash(partyData, ammoId)) {
      this.combat.log.push(`${me.name} is out of ${ammoId}!`);
      this.refreshLog();
      this.pendingAction = null;
      this.mode = "default";
      this.clearTileCursor();
      this.clearPicker();
      this.refreshActionMenu();
      return;
    }
    const ammoDef = this.items.get(ammoId) ?? null;
    this.busy = true;
    this.mode = "default";
    this.pendingAction = null;
    this.clearTileCursor();
    this.clearPicker();
    this.clearMoveHints();
    try {
      // Bow whistle + ember-trail projectile from shooter → cell.
      Sfx.play("arrow");
      await this.animateBump(me, me.position, target);
      const start = this.bodyXY(me);
      const endPx = {
        x: this.tileX(target.col),
        y: this.tileY(target.row),
      };
      await projectileLine(this, start, endPx, VFX_COLOURS.ember, 240);
      const ammoName = ammoDef?.name ?? ammoId;
      // If a creature occupies the picked tile, the shot is a real
      // attack: full d20 roll vs AC (same resolution as the enemy-
      // picker range branch), THEN the tile ignites regardless of
      // the outcome. This lets a precision bow target monsters with
      // fire arrows — previously the tile picker only lit the
      // ground, so the arrow sailed harmlessly through anything
      // standing there.
      const occupant = this.combat.combatantAt(target.col, target.row);
      if (occupant) {
        const result = resolveThrow(me, occupant, weapon, defaultRng);
        const friendly = occupant.side === me.side;
        const ffTag = friendly ? " — FRIENDLY FIRE!" : "";
        const rType = result.damageType;
        const rTypeSuffix = rType && rType !== "physical" ? ` (${rType})` : "";
        const rBonus = result.bonusDamage ?? 0;
        const rBreakdown =
          rBonus > 0
            ? `${result.damage} dmg${rTypeSuffix} [${result.damage - rBonus}+${rBonus} bonus]`
            : `${result.damage} dmg${rTypeSuffix}`;
        this.combat.log.push(
          result.hit
            ? `${me.name} fires ${ammoName} at ${occupant.name} (d20:${result.roll}=${result.total} vs AC${occupant.ac})${ffTag} — ${rBreakdown}${result.killed ? ", defeated!" : "."}`
            : `${me.name} fires ${ammoName} at ${occupant.name} — miss.`,
        );
        await this.animateHit(occupant, result);
        this.refreshHp(occupant);
        if (result.hit) {
          this.applyWeaponDurability(me.id);
          this.applyArmorDurability(occupant.id);
        }
      } else {
        this.combat.log.push(
          `${me.name} fires ${ammoName} from ${weapon.name} at (${target.col}, ${target.row}).`,
        );
      }
      // Ignite the cell. Same engine path the throw-torch + creature-
      // shot branches use.
      this.igniteCell(
        target.col,
        target.row,
        ammoDef?.light_range ?? 3,
        ammoDef?.power ?? 3,
      );
      const endX = this.tileX(target.col);
      const endY = this.tileY(target.row);
      radialBurst(
        this,
        { x: endX, y: endY },
        VFX_COLOURS.fire,
        VFX_COLOURS.ember,
        44,
      ).catch(() => undefined);
      this.combat.log.push(
        occupant
          ? `${ammoName} ignites ${occupant.name}'s tile — fire spreads!`
          : `The ${ammoName} catches the ground at (${target.col}, ${target.row}) on fire.`,
      );
      this.combat.movePoints = 0;
      this.refreshAll();
      if (this.combat.isOver) return this.endEncounter();
      this.endActorTurn();
    } finally {
      this.busy = false;
    }
  }

  /** Render the ammo picker — same numbered-list shape the throw /
   *  use / spell pickers use. Each row carries the ammo's display
   *  name, the count remaining in the stash, and a one-word tag
   *  for fire-arrow variants so the player can see at a glance
   *  which row plants a fire on impact. */
  private refreshAmmoPicker(): void {
    const partyData = gameState.partyData;
    const lines = this.ammoOptions.map((id) => {
      const def = this.items.get(id);
      const name = def?.name ?? id;
      let count = 0;
      if (partyData) {
        for (const e of partyData.inventory) {
          if (e.item === id) count += e.charges ?? 1;
        }
      }
      const tag = def?.ignite ? "  [ignites]" : "";
      return `${name} ×${count}${tag}`;
    });
    this.renderPicker("PICK AMMO", lines, this.pickerCursor);
  }

  /** Commit the player's ammo pick and continue into target /
   *  direction selection. Called by the picker-key dispatch when
   *  the player presses Enter on a row (or the matching number
   *  key for direct selection). */
  private commitAmmoPick(): void {
    const ammoId = this.ammoOptions[this.pickerCursor];
    const weapon = this.pendingRangeWeapon;
    this.ammoOptions = [];
    this.pendingRangeWeapon = null;
    this.clearPicker();
    if (!ammoId || !weapon) {
      // Defensive: a click into an empty picker drops back to
      // default mode rather than crashing.
      this.mode = "default";
      this.refreshActionMenu();
      return;
    }
    this.proceedRangeWithAmmo(weapon, ammoId);
  }

  // ── Throw / Cast / Target sub-modes ──────────────────────────────

  /** PartyMember matched to the active combatant by name (best-effort). */
  private memberForCurrent(): PartyMember | null {
    return this.memberByCombatantId(this.combat.current.id);
  }

  /**
   * PartyMember matched to a combatant id (party-side only). Used by
   * the durability hooks that need to apply wear to whichever fighter
   * landed (or absorbed) the hit, not just the active turn-taker.
   * Summons share `side: "party"` but have no PartyMember row, so
   * the lookup returns null for them — durability simply skips.
   */
  private memberByCombatantId(id: string): PartyMember | null {
    const c = this.combat.combatants.find((x) => x.id === id);
    if (!c || c.side !== "party") return null;
    const data = gameState.partyData;
    if (!data) return null;
    return data.roster.find((m) => m.name === c.name) ?? null;
  }

  /**
   * Decrement durability for the weapon a party member just hit with.
   * Called after every successful melee bump or ranged shot. Iterates
   * the hand slots so dual-wield setups still wear the right item, and
   * logs a "X's Y shatters!" line if the weapon breaks.
   *
   * Skips silently for monsters and summons — they don't carry the
   * PartyMember durability tracker.
   */
  private applyWeaponDurability(attackerId: string): void {
    const member = this.memberByCombatantId(attackerId);
    if (!member) return;
    // v2 collapsed offhand into the single `hands` slot.
    if (!member.equipped.hands) return;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- `useEquippedDurability` is a plain helper, not a React hook
    const r = useEquippedDurability(member, "hands", this.items);
    if (r.kind === "broke") {
      this.combat.log.push(`*** ${member.name}'s ${r.itemName} shatters! ***`);
      this.spawnShatterVfx(attackerId, r.itemName, "weapon");
    }
  }

  /**
   * Decrement body-armor durability when a party member is hit. The
   * Python game has the same hook in `_apply_armor_durability`; here
   * we mirror only the body slot — head/hand armor wear isn't tracked
   * yet because no shipped pieces define durability for those slots.
   */
  private applyArmorDurability(targetId: string): void {
    const member = this.memberByCombatantId(targetId);
    if (!member) return;
    if (!member.equipped.body) return;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- `useEquippedDurability` is a plain helper, not a React hook
    const r = useEquippedDurability(member, "body", this.items);
    if (r.kind === "broke") {
      this.combat.log.push(`*** ${member.name}'s ${r.itemName} is destroyed! ***`);
      this.spawnShatterVfx(targetId, r.itemName, "armor");
    }
  }

  /**
   * Trigger the shatter VFX on the combatant's body sprite, color-
   * coded by gear type so weapons read different from armor. Plays
   * the critical SFX in tandem so the audio + visual cue land
   * together. No-op when the combatant is already off-screen (a
   * downed actor whose sprite was destroyed).
   */
  private spawnShatterVfx(
    combatantId: string, itemName: string, kind: "weapon" | "armor",
  ): void {
    const c = this.combat.combatants.find((x) => x.id === combatantId);
    if (!c) return;
    const at = this.bodyXY(c);
    const color  = kind === "weapon" ? VFX_COLOURS.fire     : VFX_COLOURS.shield;
    const accent = kind === "weapon" ? VFX_COLOURS.ember    : VFX_COLOURS.white;
    shatterEffect(this, at, itemName, color, accent);
    Sfx.play("critical");
  }

  private openThrowPicker(): void {
    const member = this.memberForCurrent();
    const party = gameState.partyData;
    const opts: typeof this.throwOptions = [];
    // Personal inventory first, then shared stash. Filter to throwables.
    if (member) {
      member.inventory.forEach((it, idx) => {
        const def = this.items.get(it.item);
        if (def && isThrowable(def)) {
          opts.push({ item: def, source: "personal", index: idx });
        }
      });
    }
    if (party) {
      party.inventory.forEach((it, idx) => {
        const def = this.items.get(it.item);
        if (def && isThrowable(def)) {
          opts.push({ item: def, source: "stash", index: idx });
        }
      });
    }
    if (opts.length === 0) {
      this.combat.log.push(`${this.combat.current.name} has nothing to throw.`);
      this.refreshLog();
      return;
    }
    this.throwOptions = opts;
    this.pickerCursor = 0;
    this.mode = "pick-throw";
    this.refreshThrowPicker();
  }

  /** Rebuild the throw picker so the cursor + scroll window update. */
  private refreshThrowPicker(): void {
    const lines = this.throwOptions.map(
      (o) => `${o.item.name} (pwr ${o.item.power ?? 1})`
    );
    this.renderPicker("PICK ITEM TO THROW", lines, this.pickerCursor);
  }

  /**
   * Build the Use-Item picker — combat-usable consumables in the
   * active member's personal inventory plus the shared stash. Filters
   * by `isCombatUsable` so torches / camping supplies / lockpicks
   * never show up; throwables WITH effects (poisons, fire oils) DO
   * show up here AND on the Throw picker, since either action is a
   * valid way to use them. Picker entries collapse duplicate items
   * within the same source so a stack of three Healing Potions reads
   * as `Healing Potion ×3`.
   */
  private openUsePicker(): void {
    const member = this.memberForCurrent();
    const party = gameState.partyData;
    const opts: typeof this.useOptions = [];
    if (member) {
      member.inventory.forEach((it, idx) => {
        const def = this.items.get(it.item);
        if (def && isCombatUsable(def)) {
          opts.push({ item: def, source: "personal", index: idx });
        }
      });
    }
    if (party) {
      party.inventory.forEach((it, idx) => {
        const def = this.items.get(it.item);
        if (def && isCombatUsable(def)) {
          opts.push({ item: def, source: "stash", index: idx });
        }
      });
    }
    if (opts.length === 0) {
      this.combat.log.push(`${this.combat.current.name} has nothing usable.`);
      this.refreshLog();
      return;
    }
    this.useOptions = opts;
    this.pickerCursor = 0;
    this.mode = "pick-use";
    this.refreshUsePicker();
  }

  /** Rebuild the use picker so the cursor + scroll window update. */
  private refreshUsePicker(): void {
    const member = this.memberForCurrent();
    const party = gameState.partyData;
    const lines = this.useOptions.map((o) => {
      const eff = o.item.effect ?? "—";
      const tag =
        eff === "heal_hp"      ? "+HP" :
        eff === "heal_mp"      ? "+MP" :
        eff === "cure_poison"  ? "cure poison" :
        eff === "buff_strength" ? "+STR" :
        eff === "buff_ac"       ? "+AC" :
        eff === "combat_only"   ? "splash" :
        eff;
      // Read charges live from the backing entry (not a snapshot) so
      // the count stays right if the picker is re-rendered mid-fight.
      const entry =
        o.source === "personal"
          ? member?.inventory[o.index]
          : party?.inventory[o.index];
      const n = entry?.charges ?? 1;
      const label = n > 1 ? `${o.item.name} ×${n}` : o.item.name;
      return `${label.padEnd(18, " ")} ${tag}`;
    });
    this.renderPicker("USE ITEM", lines, this.pickerCursor);
  }

  /**
   * Resolve a picked Use-item: consume it from inventory, apply the
   * effect via the pure helper, log + animate the outcome, then end
   * the turn. Refusals (already at full HP, no enemies for a splash,
   * unknown effect) bail out of the picker without burning the item
   * or the turn so the player can pick something else.
   */
  private applyUseItem(opt: typeof this.useOptions[number]): void {
    const me = this.combat.current;
    const member = this.memberForCurrent();
    const enemies = this.combat.combatants.filter(
      (c) => c.side !== me.side && c.hp > 0,
    );
    // Forward the buff hooks so Elixir of Strength / Warding can stage
    // their addBuff entries through the same path Bless / Shield use.
    // Bound methods so the helper can call them like plain functions.
    const buffHooks = {
      addBuff: (id: string, b: Buff): void => this.combat.addBuff(id, b),
      hasBuffFromSource: (id: string, src: string): boolean =>
        this.combat.hasBuffFromSource(id, src),
    };
    // eslint-disable-next-line react-hooks/rules-of-hooks -- `useCombatItem` is a plain helper, not a React hook
    const result = useCombatItem(me, member, enemies, opt.item, defaultRng, buffHooks);

    // Refusal: log, hold the picker open so the player can re-choose.
    if (!result.ok) {
      this.combat.log.push(result.message);
      this.refreshLog();
      this.mode = "default";
      this.clearPicker();
      this.refreshActionMenu();
      return;
    }

    // Item is consumed — Throw uses the same charges-aware helper on
    // selection, but for Use we consume AFTER resolving so a refusal
    // (already-full HP) doesn't burn the potion. A bare splice here
    // used to nuke the whole stack (3 Mana Potions gone after one
    // drink); `consumeOneFromStackAt` decrements `charges` and only
    // drops the row when the stack runs dry.
    if (opt.source === "personal" && member) {
      consumeOneFromStackAt(member.inventory, opt.index);
    } else if (opt.source === "stash" && gameState.partyData) {
      consumeOneFromStackAt(gameState.partyData.inventory, opt.index);
    }

    this.combat.log.push(result.message);
    this.refreshLog();
    this.mode = "default";
    this.clearPicker();

    // VFX + HP/MP refresh so the heal sparkle lands on the caster and
    // splash damage updates each enemy's bar.
    if (result.effect === "heal_hp") {
      void this.healTargetVfx(me);
      Sfx.play("heal");
      this.refreshHp(me);
    } else if (result.effect === "heal_mp") {
      void this.auraOn(me, VFX_COLOURS.arcane);
      // refreshHp re-reads the live PartyMember and resizes the MP
      // bar in tandem, so a single call covers both meters.
      this.refreshHp(me);
    } else if (result.effect === "buff_strength") {
      // Crimson surge for STR — same colour family the renderer uses
      // for damage flashes so the link to "you'll hit harder" reads.
      void this.auraOn(me, VFX_COLOURS.fire);
      Sfx.play("defend");
    } else if (result.effect === "buff_ac") {
      // Silver-tinged shield aura for AC.
      void this.auraOn(me, VFX_COLOURS.shield);
      Sfx.play("defend");
    } else if (result.effect === "combat_only" && result.enemyHits) {
      Sfx.play("attack");
      for (const hit of result.enemyHits) {
        const target = this.combat.combatants.find((c) => c.id === hit.id);
        if (!target) continue;
        const body = this.bodies.get(target.id);
        if (body) flashTarget(this, body, VFX_COLOURS.fire);
        this.refreshHp(target);
        if (hit.killed) {
          this.combat.log.push(`${target.name} is incinerated!`);
        }
      }
      this.refreshLog();
    }

    if (this.combat.isOver) return this.endEncounter();
    if (result.endsTurn) this.endActorTurn();
    else this.refreshActionMenu();
  }

  /**
   * Build the Equip-Item picker — equippable items in the active
   * member's PERSONAL inventory only. Shared stash is excluded; that
   * matches the design intent that combat-time gear swaps come from
   * "what's on your belt", not from the wagon.
   */
  private openEquipPicker(): void {
    const member = this.memberForCurrent();
    if (!member) return;
    const opts: typeof this.equipOptions = [];
    member.inventory.forEach((it, idx) => {
      const def = this.items.get(it.item);
      if (def && equippableSlots(def).length > 0) {
        opts.push({ item: def, index: idx });
      }
    });
    if (opts.length === 0) {
      this.combat.log.push(`${this.combat.current.name} has nothing to equip.`);
      this.refreshLog();
      return;
    }
    this.equipOptions = opts;
    this.pickerCursor = 0;
    this.mode = "pick-equip";
    this.refreshEquipPicker();
  }

  /** Rebuild the equip picker so the cursor + scroll window update. */
  private refreshEquipPicker(): void {
    const lines = this.equipOptions.map((o) => {
      // Use the first UI-supported slot — `equippableSlots` already
      // filtered out anything we can't surface, so this is always
      // the "where will this go?" answer the player needs.
      const fits = equippableSlots(o.item);
      const slot = fits[0];
      const tag =
        slot === "hands" ? "hands" :
        slot === "body"  ? "body"  :
        "—";
      return `${o.item.name.padEnd(18, " ")} ${tag}`;
    });
    this.renderPicker("EQUIP ITEM", lines, this.pickerCursor);
  }

  /**
   * Resolve a picked Equip option: hand off to the pure
   * `equipItemFromInventory` helper, refresh the Combatant's gear-
   * derived stats so the next swing reflects the new weapon/armor,
   * log, and end the turn. The pure helper handles the swap-into-
   * occupied-slot case (displaced item slides back into inventory at
   * the same index) so we don't have to track that here.
   */
  private applyEquipItem(opt: typeof this.equipOptions[number]): void {
    const me = this.combat.current;
    const member = this.memberForCurrent();
    if (!member) {
      this.cancelSubMode();
      return;
    }
    const r = equipItemFromInventory(
      member,
      opt.index,
      this.items,
      this.classTemplates.get(member.class)?.allowable_item_types,
    );
    if (!r.ok) {
      // Refusal — log and bounce back to the action menu without
      // ending the turn.
      this.combat.log.push(r.message);
      this.refreshLog();
      this.mode = "default";
      this.clearPicker();
      this.refreshActionMenu();
      return;
    }
    // Re-derive ac / attackBonus / damage on the live Combatant so
    // the new weapon's hit chance and damage land on the very next
    // attack. Position, HP, buffs, sprite, etc. are intentionally
    // left untouched.
    refreshCombatantGear(me, member, this.items);
    // refreshCombatantGear updated `wieldAuraColor` on the
    // combatant — sheathing the Sun Sword should kill its halo,
    // drawing it should start one. Sync the timer with the new
    // value so the visual matches the gear state on the very next
    // pulse.
    this.syncWielderAura(me);
    this.combat.log.push(r.message);
    this.refreshLog();
    this.mode = "default";
    this.clearPicker();
    Sfx.play("defend");
    if (this.combat.isOver) return this.endEncounter();
    this.endActorTurn();
  }

  /**
   * Spell-pick → action dispatch. Classifies the spell, and either
   * stages a target prompt (single-target) or casts immediately
   * (self / mass / unsupported). The async signature lets the
   * resolve-now branches await the animation catalog before
   * playing cast SFX / visuals; target-stage branches return
   * before any await runs and the function resolves synchronously.
   */
  private async dispatchSpell(spell: Spell): Promise<void> {
    const member = this.memberForCurrent();
    if (!member) return;
    const kind = classifyCombatCast(spell);
    if (kind === "pick-ally") {
      this.startTargetingFor({ kind: "cast", spell }, "party");
      return;
    }
    if (kind === "pick-enemy") {
      this.startTargetingFor({ kind: "cast", spell }, "enemies");
      return;
    }
    if (kind === "pick-tile") {
      this.startTilePicking(spell);
      return;
    }
    if (kind === "pick-direction") {
      this.startDirectionPicking(spell);
      return;
    }
    // Note: Turn Undead used to be back-routed through this picker
    // (with a synthetic `effect_type: "undead_damage"` spell). It
    // now lives in the Abilities picker — see `dispatchAbility` /
    // `runTurnUndead`. Nothing in the shipped spells.json declares
    // `undead_damage` anymore, so the mass-enemy branch below stays
    // for genuinely spell-shaped future effects.
    //
    // The remaining kinds resolve immediately. Spend MP, log, and
    // end the turn — same as a finished single-target cast would.
    if (member.max_mp > 0) {
      member.mp = Math.max(0, (member.mp) - spell.mp_cost);
    }
    this.clearPicker();
    this.mode = "default";

    const me = this.combat.current;

    // Animation-driven dispatch. Catalog is preloaded eagerly at the
    // top of any cast path so getAnimationById resolves synchronously.
    await loadAnimations();
    const animation = getAnimationById(spell.animation_id);
    const castSfx = animation?.cast_sfx ?? "";
    const hitSfx = animation?.hit_sfx ?? "";
    const animVisual = (animation?.visual ?? "").trim();
    const hasVisual = animVisual !== "" && animVisual !== "none";
    /** Play the animation's visual at a target's body position. Each
     *  branch below calls this with the appropriate target instead of
     *  hand-coding the visual helper. */
    const playVisualAt = async (point: { x: number; y: number }) => {
      if (!hasVisual) return;
      const fn = resolveProjectileEffect({ effect_type: animVisual });
      await fn(this, point, point);
    };

    if (castSfx) Sfx.play(castSfx);
    this.castGlowFor(me, this.colorForSpell(spell.effect_type));
    if (kind === "self") {
      if (spell.effect_type === "heal" || spell.effect_type === "major_heal") {
        const r = resolveHealSpell(me, me, spell, defaultRng);
        this.combat.log.push(`${me.name} casts ${spell.name} on self — heals ${r.heal} HP.`);
        void playVisualAt(this.bodyXY(me));
        this.refreshHp(me);
      } else if (spell.effect_type === "daylight") {
        // Banish darkness for the REST OF THE BATTLE — the whole arena
        // now reads as a bright fight, not a localized light pool.
        // `this.darkness` is the single lever every darkness-gated
        // check reads (the overlay paint, `isCellVisibleToParty`
        // targeting, the party-sprite gate), so flipping it off is
        // literally "as if there was no darkness at all."
        const wasDark = this.darkness;
        this.daylightActive = true;
        this.darkness = false;
        this.darknessGfx?.clear();
        this.infravisionGfx?.clear();
        // Re-show anything the dark had hidden — party sprites that
        // were standing in shadow and any visibility-gated arena
        // emitters — now that the whole field is lit.
        if (wasDark) {
          for (const c of this.combat.combatants) {
            const body = this.bodies.get(c.id);
            if (body && c.hp > 0) body.setVisible(true);
          }
          for (const [, emitter] of this.arenaEmitters) {
            emitter.setVisible(true);
          }
        }
        // Warm, arena-wide flash so the cast reads instantly and is
        // visibly distinct from Light's localized orb.
        this.cameras.main.flash(500, 255, 248, 205);
        this.combat.log.push(
          wasDark
            ? `${me.name} casts ${spell.name} — the battlefield floods with daylight!`
            : `${me.name} casts ${spell.name} — radiant light washes over the arena.`,
        );
      } else if (spell.effect_type === "invisibility") {
        // Caster fades from view: an "Invisibility"-tagged AC buff
        // hardens them to attacks, and the scene picks up the matching
        // buff source via refreshVisibility() to actually drop their
        // sprite alpha for the spell's full duration. Reappears
        // automatically when the buff ticks down.
        const turns = typeof spell.duration === "number" ? spell.duration : 3;
        this.combat.addBuff(me.id, {
          kind: "ac_bonus",
          value: 6,
          turnsLeft: turns,
          source: "Invisibility",
        });
        this.combat.log.push(
          `${me.name} casts ${spell.name} — fades from view (+6 AC for ${turns} turns).`
        );
      } else {
        void playVisualAt(this.bodyXY(me));
        this.combat.log.push(
          `${me.name} casts ${spell.name} — ${describeStatusCast(me, me, spell)}`
        );
      }
    } else if (kind === "mass-ally") {
      // Bless: party-wide attack-bonus buff. Mirrors the Python game's
      // bless_buffs dict — every alive ally gets +effect_value.attack_bonus
      // for `duration` rounds.
      if (spell.effect_type === "bless") {
        const ev = spell.effect_value ?? {};
        const value = typeof ev.attack_bonus === "number" ? ev.attack_bonus : 2;
        const turns = typeof spell.duration === "number" ? spell.duration : 4;
        let count = 0;
        for (const ally of this.combat.combatants) {
          if (ally.side !== "party" || ally.hp <= 0) continue;
          this.combat.addBuff(ally.id, {
            kind: "attack_bonus",
            value,
            turnsLeft: turns,
            source: "Bless",
          });
          // Stagger the per-ally aura so they sparkle in sequence
          // rather than all flashing at once — feels more "blessing
          // sweeping over the party".
          const allyPos = this.bodyXY(ally);
          this.time.delayedCall(count * 60, () => void playVisualAt(allyPos));
          count += 1;
        }
        this.combat.log.push(
          `${me.name} casts ${spell.name} — ${count} ${count === 1 ? "ally" : "allies"} gain +${value} to hit for ${turns} turns.`
        );
      } else if (spell.action === "restore") {
        // Restore: percentage HP + percentage MP top-up for every
        // alive ally, plus optionally cure listed status effects.
        // params: heal_percent (0..1), mp_percent (0..1), cure_effects
        // (array of effect ids), scope=all_allies. The status-effect
        // engine isn't built yet, so cure_effects is a noop — the
        // call shape is here so the field becomes live as soon as the
        // engine arrives.
        const ev = spell.effect_value ?? {};
        const healPct = typeof ev.heal_percent === "number" ? ev.heal_percent : 0;
        const mpPct = typeof ev.mp_percent === "number" ? ev.mp_percent : 0;
        let totalHp = 0;
        let totalMp = 0;
        let i = 0;
        for (const ally of this.combat.combatants) {
          if (ally.side !== "party" || ally.hp <= 0) continue;
          // HP top-up — clamp to maxHp.
          const hpGain = Math.min(
            ally.maxHp - ally.hp,
            Math.max(0, Math.floor(ally.maxHp * healPct)),
          );
          if (hpGain > 0) {
            ally.hp += hpGain;
            totalHp += hpGain;
          }
          // MP top-up — has to go through the PartyMember row since
          // MP lives there (combatants don't carry mp themselves).
          // The CASTER is excluded from the MP refill: Restore
          // refunding its own casting cost would make the spell free
          // (cast, refill to 100%, repeat forever). She still gets
          // the HP heal above — only the mana comes from others'
          // gratitude, not her own.
          const allyMember = this.memberByCombatantId(ally.id);
          if (allyMember && allyMember.max_mp > 0) {
            const isCaster = ally.id === me.id;
            const mpGain = isCaster
              ? 0
              : Math.min(
                  allyMember.max_mp - allyMember.mp,
                  Math.max(0, Math.floor(allyMember.max_mp * mpPct)),
                );
            if (mpGain > 0) {
              allyMember.mp += mpGain;
              totalMp += mpGain;
            }
            // Keep PartyMember.hp in sync with the combatant so the
            // post-battle roster reflects the heal.
            allyMember.hp = ally.hp;
          }
          const allyPos = this.bodyXY(ally);
          this.time.delayedCall(i * 70, () => void playVisualAt(allyPos));
          i += 1;
          this.refreshHp(ally);
        }
        const parts: string[] = [];
        if (totalHp > 0) parts.push(`${totalHp} HP`);
        if (totalMp > 0) parts.push(`${totalMp} MP`);
        this.combat.log.push(
          `${me.name} casts ${spell.name} — party restored ` +
            `${parts.length > 0 ? parts.join(" / ") : "nothing"}.`,
        );
      } else if (spell.action === "heal") {
        // Mass heal — every alive ally takes the spell's dice and
        // adds the rolled amount. Stagger the visuals so the bar
        // sweeps across the party instead of strobing simultaneously.
        let total = 0;
        let i = 0;
        for (const ally of this.combat.combatants) {
          if (ally.side !== "party" || ally.hp <= 0) continue;
          const r = resolveHealSpell(me, ally, spell, defaultRng);
          total += r.heal;
          const allyPos = this.bodyXY(ally);
          this.time.delayedCall(i * 70, () => void playVisualAt(allyPos));
          i += 1;
          this.refreshHp(ally);
        }
        this.combat.log.push(
          `${me.name} casts ${spell.name} — party heals ${total} HP total.`,
        );
      } else {
        this.combat.log.push(
          `${me.name} casts ${spell.name} — no mass-ally effect implemented.`,
        );
      }
    } else if (kind === "mass-enemy") {
      // Turn Undead used to live here; it now flows through the
      // Abilities picker. Anything else that classifies as
      // "mass-enemy" falls through to a generic per-foe damage
      // pass so a future spell-shaped mass attack doesn't drop
      // into the unsupported message.
      let total = 0;
      let hitIdx = 0;
      // Bombardment feel — the ground rumbles as the meteors fall.
      screenShake(this, 0.006, 360);
      for (const foe of this.combat.combatants) {
        if (foe.side !== "enemies" || foe.hp <= 0) continue;
        const r = resolveDamageSpell(me, foe, spell, defaultRng);
        total += r.damage;
        this.refreshHp(foe);
        // Stagger the per-foe impact (e.g. Meteor Shower's meteors) so
        // they land in sequence rather than all flashing at once, and
        // layer a fiery burst on each so a mass attack reads as a
        // sky-wide bombardment even against a single foe.
        const foePos = this.bodyXY(foe);
        const delay = hitIdx * 90;
        this.time.delayedCall(delay, () => {
          void playVisualAt(foePos);
          void radialBurst(this, foePos, VFX_COLOURS.fire, VFX_COLOURS.ember, 44);
        });
        hitIdx += 1;
      }
      this.combat.log.push(
        `${me.name} casts ${spell.name} — meteors rain down; enemies take ${total} HP total.`,
      );
    } else {
      // unsupported — needs a tile picker we haven't built.
      this.combat.log.push(
        `${me.name} casts ${spell.name} — needs tile selection (not yet supported).`
      );
    }
    this.combat.movePoints = 0;
    this.refreshAll();
    if (this.combat.isOver) return this.endEncounter();
    this.endActorTurn();
  }

  private openSpellPicker(): void {
    const member = this.memberForCurrent();
    if (!member) return;
    const opts = this.spells.filter(
      (s) =>
        spellIsCombatCastable(s, this.classTemplates.get(member.class.toLowerCase()) ?? null) &&
        member.level >= minLevelFor(s, member.class) &&
        member.max_mp > 0 &&
        (member.mp) >= s.mp_cost
    );
    if (opts.length === 0) {
      this.combat.log.push(`${this.combat.current.name} has no spell to cast.`);
      this.refreshLog();
      return;
    }
    this.spellOptions = opts;
    this.pickerCursor = 0;
    this.mode = "pick-spell";
    this.refreshSpellPicker();
  }

  /** Rebuild the spell picker so the cursor + scroll window update. */
  private refreshSpellPicker(): void {
    const tagFor = (s: Spell): string => {
      const k = classifyCombatCast(s);
      if (k === "self")        return "SELF";
      if (k === "pick-ally")   return "ALLY";
      if (k === "pick-enemy")  return "ENEMY";
      if (k === "mass-ally")   return "PARTY";
      if (k === "mass-enemy")  return "ENEMIES";
      return "—";
    };
    const lines = this.spellOptions.map(
      (s) => `${s.name.padEnd(18, " ")} ${s.mp_cost} MP   ${tagFor(s)}`
    );
    this.renderPicker("PICK SPELL", lines, this.pickerCursor);
  }

  // ── Abilities (class + race) ────────────────────────────────────
  //
  // Parallel to Cast, distinct from it. Class abilities (Turn Undead,
  // …) and race abilities (none combat-active in the shipped data,
  // but the path is wired) flow through `combatAbilitiesForMember`
  // and then dispatch via `dispatchAbility` to a per-action resolver.
  //
  // Per-encounter / per-day cadences live on the scene (e.g.
  // `turnUndeadUsed`), checked by the resolver — keeps the picker
  // a thin "what's available" view and the resolver the single
  // source of truth for "what happens when you click."

  /** True iff the active member has at least one combat-active
   *  ability granted by their class or race. Used by the action-menu
   *  enable check + the picker's empty-state log line. */
  private memberHasCombatAbility(): boolean {
    const member = this.memberForCurrent();
    if (!member) return false;
    const tpl = this.classTemplates.get(member.class.toLowerCase()) ?? null;
    const race = this.raceCatalog.get(member.race.toLowerCase()) ?? null;
    return combatAbilitiesForMember(
      member,
      tpl,
      race,
      this.abilities,
    ).length > 0;
  }

  private openAbilityPicker(): void {
    const member = this.memberForCurrent();
    if (!member) return;
    const tpl = this.classTemplates.get(member.class.toLowerCase()) ?? null;
    const race = this.raceCatalog.get(member.race.toLowerCase()) ?? null;
    const opts = combatAbilitiesForMember(
      member,
      tpl,
      race,
      this.abilities,
    );
    if (opts.length === 0) {
      // Empty-state log line — matches the spell picker's "nothing
      // to cast" UX. The player can still see WHY the picker didn't
      // open (class+level grant nothing combat-active yet, e.g. a
      // level-1 Cleric before Turn Undead unlocks at level 2).
      this.combat.log.push(
        `${this.combat.current.name} has no combat ability available.`,
      );
      this.refreshLog();
      return;
    }
    this.abilityOptions = opts;
    this.pickerCursor = 0;
    this.mode = "pick-ability";
    this.refreshAbilityPicker();
  }

  /** Rebuild the ability picker — cursor / scroll-window refresh,
   *  same shape as `refreshSpellPicker` so the player reads both
   *  panels at a glance. The right-column tag identifies the
   *  ability's grant lane (CLASS / RACE) since that's the most
   *  useful at-a-glance differentiator in the picker. */
  private refreshAbilityPicker(): void {
    const tagFor = (a: Ability): string =>
      a.type === "race" ? "RACE" : "CLASS";
    const lines = this.abilityOptions.map(
      (a) => `${a.name.padEnd(18, " ")}        ${tagFor(a)}`,
    );
    this.renderPicker("PICK ABILITY", lines, this.pickerCursor);
  }

  /** Route a picked ability to its resolver. Branches on
   *  `ability.params.action` — the per-ability dispatch discriminator
   *  declared in abilities.json. Unknown actions log a "not
   *  implemented" line and bail without ending the turn so a
   *  half-wired ability can't strand the player.
   *
   *  Today the only combat-active ability is Turn Undead; new
   *  abilities slot in as additional branches here (Lay on Hands,
   *  Wild Shape, etc.). */
  private async dispatchAbility(ability: Ability): Promise<void> {
    const member = this.memberForCurrent();
    if (!member) return;
    const action =
      ability.params && typeof ability.params.action === "string"
        ? ability.params.action
        : "";
    if (action === "turn_undead") {
      await this.runTurnUndead(member, ability);
      return;
    }
    this.combat.log.push(
      `${this.combat.current.name} tries ${ability.name} — not yet implemented.`,
    );
    this.refreshLog();
    this.mode = "default";
    this.clearPicker();
  }

  /** Resolve a Turn Undead activation — extracted from the previous
   *  spell-side path so the ability dispatcher can call it without
   *  going through the Cast pipeline. Mirrors the Python game's
   *  per-encounter cadence: undead get used to the holy symbol
   *  after the first channel, so a second activation in the same
   *  fight fizzles (caster keeps both their turn AND any MP — but
   *  Turn Undead has none to spend, so just the turn). Pre-flight
   *  filters out a fight with no undead at all so the player sees
   *  a clear log line instead of a silent no-op.
   *
   *  The resolution itself delegates to `resolveTurnUndead` (pure
   *  helper in CombatActions.ts); this method handles the scene-side
   *  bookkeeping — log lines, per-target VFX timing, the cast/hit
   *  SFX from the ability's animation_id, and end-of-turn cleanup. */
  private async runTurnUndead(
    member: PartyMember,
    ability: Ability,
  ): Promise<void> {
    const me = this.combat.current;
    // Pre-flight 1: already-used-this-encounter gate.
    if (this.turnUndeadUsed) {
      this.combat.log.push(
        `${me.name} channels ${ability.name} — the undead here are already cowed; the holy energy has no further effect.`,
      );
      this.refreshLog();
      this.mode = "default";
      this.clearPicker();
      return;
    }
    // Pre-flight 2: no undead at all → fizzle without burning the
    // turn or marking the ability used. The player can still spend
    // the turn on something else.
    const anyUndead = this.combat.combatants.some(
      (c) => c.side === "enemies" && c.hp > 0 && c.undead,
    );
    if (!anyUndead) {
      this.combat.log.push(
        `${me.name} channels ${ability.name} — no undead here, the holy energy has no effect.`,
      );
      this.refreshLog();
      this.mode = "default";
      this.clearPicker();
      return;
    }
    // Commit the activation — closes the picker and locks the
    // ability for the rest of the encounter.
    this.mode = "default";
    this.clearPicker();
    this.turnUndeadUsed = true;
    // Animation-driven dispatch. Same call shape as the spell path
    // uses so the audio/visual catalog stays the single source for
    // both pipelines.
    await loadAnimations();
    const animation = getAnimationById(ability.animation_id);
    const castSfx = animation?.cast_sfx ?? "";
    const hitSfx = animation?.hit_sfx ?? "";
    const animVisual = (animation?.visual ?? "").trim();
    const hasVisual = animVisual !== "" && animVisual !== "none";
    const playVisualAt = async (point: { x: number; y: number }) => {
      if (!hasVisual) return;
      const fn = resolveProjectileEffect({ effect_type: animVisual });
      await fn(this, point, point);
    };
    if (castSfx) Sfx.play(castSfx);
    // Buff-toned caster glow — same colour the previous spell-path
    // used for Turn Undead so the visual reads identically.
    this.castGlowFor(me, VFX_COLOURS.buff);
    const enemies = this.combat.combatants.filter((c) => c.side === "enemies");
    const wisMod = abilityMod(member.wisdom);
    const result = resolveTurnUndead(enemies, ability.params, wisMod, defaultRng);
    this.combat.log.push(`${me.name} channels ${ability.name}!`);
    let i = 0;
    for (const o of result.outcomes) {
      const target = this.combat.byId(o.targetId);
      const dice = `${o.saveRoll}+${o.saveBonus}=${o.saveTotal} vs DC ${o.saveDc}`;
      this.combat.log.push(
        o.saved
          ? `${target.name} resists (${dice}) — seared for ${o.damage} damage!`
          : o.turned
            ? `${target.name} fails its save (${dice}) — seared for ${o.damage} damage and TURNED! It recoils from the light for ${o.turnedTurns} ${o.turnedTurns === 1 ? "turn" : "turns"}.`
            : `${target.name} fails its save (${dice}) — DESTROYED!`,
      );
      const body = this.bodies.get(target.id);
      if (body) {
        const at = { x: body.x, y: body.y };
        this.time.delayedCall(i * 80, () => {
          flashTarget(this, body, VFX_COLOURS.buff);
          void playVisualAt(at);
        });
      }
      i += 1;
      this.refreshHp(target);
    }
    if (hitSfx) Sfx.play(hitSfx);
    // Burn the rest of the move budget — Turn Undead ends the turn.
    this.combat.movePoints = 0;
    this.refreshAll();
    if (this.combat.isOver) return this.endEncounter();
    this.endActorTurn();
  }

  /** Drain one unit of the picked throw item now (so the player can't
   *  pick it again if the throw misses). When the entry is a stack —
   *  e.g. `{ item: "Rock", charges: 20 }` — only one charge is
   *  consumed; the entry is spliced out only when the stack hits zero
   *  (or had no `charges` field to begin with). Previously this
   *  splice'd the whole entry, so throwing a single rock from a stack
   *  of 20 nuked all 20. */
  private consumeThrowItem(opt: typeof this.throwOptions[number]): void {
    const member = this.memberForCurrent();
    const party = gameState.partyData;
    if (opt.source === "personal" && member) {
      consumeOneFromStackAt(member.inventory, opt.index);
    } else if (opt.source === "stash" && party) {
      consumeOneFromStackAt(party.inventory, opt.index);
    }
  }

  private startTargetingFor(action: PendingAction, side: "party" | "enemies"): void {
    this.pendingAction = action;
    this.mode = "pick-target";
    // Fresh target picker → reset the arrow-key cursor to the first
    // valid target. `drawTargetBadges` clamps if the list is empty.
    this.targetCursor = 0;
    this.clearPicker();
    this.drawTargetBadges(side);
    // Empty target list (e.g. all enemies out of range or behind
    // cover) used to auto-revert to default mode, which also cleared
    // the range overlay before the player could read it. Now we
    // STAY in pick-target so the reach hints stick on screen — the
    // player sees the squares the weapon / spell could reach and
    // understands exactly why no target lit up. A log line spells
    // out the specific gate (out of range, no allies hurt, etc.),
    // and ESC cancels back to the action menu the usual way.
    if (this.targetBadges.length === 0) {
      const reason = this.noTargetReason(action, side);
      this.combat.log.push(reason);
      this.refreshLog();
    }
    // Reach-hint overlay: with the staged action set, redraw so the
    // overlay switches from movement-blue to range-gold over the
    // cells the chosen weapon / spell can reach.
    this.drawActionHints();
  }

  /**
   * Build a "why no targets" message for a picker that landed on an
   * empty list. The text is action-specific so the player knows
   * exactly what gate failed (out of range, no allies hurt, no foes
   * alive, etc.) — vague banners would just shift the confusion.
   */
  private noTargetReason(action: PendingAction, side: "party" | "enemies"): string {
    const sideHasAnyone = this.combat.combatants.some(
      (c) => c.side === side && c.hp > 0,
    );
    // Darkness gate — when the picker emptied out specifically because
    // every otherwise-valid target sits in shadow, say so. Range / LOS
    // failures still produce their own messages below; this only
    // fires when the visibility filter was THE gate.
    if (this.darkness) {
      const me = this.combat.current;
      const aliveOnSide = this.combat.combatants.filter(
        (c) => c.side === side && c.hp > 0,
      );
      const anyHidden = aliveOnSide.some(
        (c) => !this.isCellVisibleToParty(c.position.col, c.position.row),
      );
      const anyVisible = aliveOnSide.some(
        (c) => this.isCellVisibleToParty(c.position.col, c.position.row),
      );
      // Only call out darkness when there ARE hidden combatants and
      // NO visible ones — otherwise the visible-but-out-of-range case
      // would get a misleading "shadows hide them" message when
      // really the player just needs to walk closer.
      if (anyHidden && !anyVisible) {
        // Suppress unused-var warning for `me` — keeping the binding
        // for the parallel reason strings below.
        void me;
        return side === "party"
          ? `${this.combat.current.name}: can't see any allies — they're lost in shadow.`
          : `${this.combat.current.name}: can't see any enemies — they're hidden in shadow. Bring a light, or fire a directional shot blind.`;
      }
    }
    if (action.kind === "range") {
      const max = maxRangeFor(action.weapon);
      // Ignitable ammo can always fall back to the free tile picker
      // — remind the player the shot isn't wasted just because no
      // creature is in reach.
      const igniteHint =
        action.ammoId && this.items.get(action.ammoId)?.ignite
          ? " Press [T] to fire at a tile instead."
          : "";
      if (!sideHasAnyone) {
        return `${this.combat.current.name}: no enemies left to fire at.${igniteHint}`;
      }
      return `${this.combat.current.name}: no enemies within ${max} tiles — ${action.weapon.name} can't reach. Move closer first.${igniteHint}`;
    }
    if (action.kind === "throw") {
      const max = maxRangeFor(action.item);
      if (!sideHasAnyone) {
        return `${this.combat.current.name}: no enemies left to throw at.`;
      }
      return `${this.combat.current.name}: no enemies within ${max} tiles — ${action.item.name} can't reach. Move closer first.`;
    }
    if (action.kind === "cast") {
      if (side === "party") {
        return `${this.combat.current.name}: no valid ally targets for ${action.spell.name}.`;
      }
      return `${this.combat.current.name}: no valid enemy targets for ${action.spell.name}.`;
    }
    return `${this.combat.current.name}: no targets available.`;
  }

  private currentTargetList(): Combatant[] {
    if (!this.pendingAction) return [];
    let side: "party" | "enemies" = "enemies";
    if (this.pendingAction.kind === "cast") {
      const kind = classifyCombatCast(this.pendingAction.spell);
      side = kind === "pick-ally" ? "party" : "enemies";
    }
    let list = this.combat.combatants
      .filter((c) => c.side === side && c.hp > 0);
    const me = this.combat.current;
    // Range / Throw actions: only show targets within the weapon or
    // throwable's max range (Chebyshev distance from the active
    // member) AND with a clear line of sight. Arena cells flagged
    // `obstructs: true` block the shot — a tree / boulder in the
    // middle of the path drops the target from the picker. Both
    // branches read their range from the item's `range` field via
    // `maxRangeFor`, so throwables like Rock (range 4) and Dagger
    // (range 3) are capped to the same circle the gold reach overlay
    // already paints.
    if (
      this.pendingAction.kind === "range" ||
      this.pendingAction.kind === "throw"
    ) {
      const sourceItem =
        this.pendingAction.kind === "range"
          ? this.pendingAction.weapon
          : this.pendingAction.item;
      const max = maxRangeFor(sourceItem);
      list = list.filter((t) => {
        const dc = Math.abs(t.position.col - me.position.col);
        const dr = Math.abs(t.position.row - me.position.row);
        if (Math.max(dc, dr) > max) return false;
        return this.combat.hasLineOfSight(me.position, t.position);
      });
    } else if (this.pendingAction.kind === "cast") {
      // Damaging spells (projectile-shaped — magic_arrow, fireball,
      // lightning_bolt, magic_dart, fire_bolt, undead_damage, …)
      // honour cover. Heals + buffs are willed-into-place: caster's
      // intent reaches the ally regardless of intervening cells.
      const spell = this.pendingAction.spell;
      const e = spell.effect_type;
      const projectileSpell =
        e === "damage" ||
        e === "undead_damage" ||
        e === "lightning_bolt" ||
        e === "aoe_fireball";
      if (projectileSpell) {
        list = list.filter((t) =>
          this.combat.hasLineOfSight(me.position, t.position),
        );
      }
    }
    // Final visibility gate — only fires in darkness mode (the helper
    // is a no-op otherwise). Drops any target whose cell sits in
    // shadow from the party's POV so the player can't pick a creature
    // they shouldn't be able to see. Directional / tile attacks never
    // route through here, so firing a bow blind down a corridor still
    // works.
    list = list.filter((t) =>
      this.isCellVisibleToParty(t.position.col, t.position.row),
    );
    return list.slice(0, 9);
  }

  private async resolveTarget(target: Combatant): Promise<void> {
    const action = this.pendingAction;
    if (!action) return;
    const me = this.combat.current;
    this.busy = true;
    this.clearTargetBadges();
    // Drop the range/move hint grid BEFORE the projectile or spell
    // visual plays — the translucent reach overlay otherwise sits on
    // top of arrows, magic darts, and AOE bursts and washes them out.
    this.clearMoveHints();
    this.mode = "default";
    try {
      if (action.kind === "throw") {
        const result = resolveThrow(me, target, action.item, defaultRng);
        this.combat.log.push(
          result.hit
            ? `${me.name} throws ${action.item.name} at ${target.name} (d20:${result.roll}=${result.total} vs AC${target.ac}) — ${result.damage} dmg${result.killed ? ", defeated!" : "."}`
            : `${me.name} throws ${action.item.name} at ${target.name} — miss.`
        );
        // Throw whoosh + visible projectile arc from caster → target.
        Sfx.play("chirp");
        await this.animateBump(me, me.position, target.position);
        await this.flyProjectile(me, target, VFX_COLOURS.ember);
        await this.animateHit(target, result);
        this.refreshHp(target);
        // Ignite the landing cell when the thrown item declares
        // `ignite: true` — e.g. a lit torch. Drops a fire light
        // source there + a fire particle emitter + adds the cell
        // to fireCells for damage-on-entry. Future-proofed by
        // light_range coming from the item data; defaults to 3.
        if (action.item.ignite) {
          this.igniteCell(
            target.position.col,
            target.position.row,
            action.item.light_range ?? 3,
            action.item.power ?? 3,
          );
          this.combat.log.push(
            `The ${action.item.name} catches the ground at (${target.position.col}, ${target.position.row}) on fire.`,
          );
        }
      } else if (action.kind === "range") {
        // Same dice resolution as Throw — fire-and-forget projectile.
        // The weapon stays equipped (no consume) since it's reusable.
        // Ammo, however, IS consumed: one arrow per shot for bows,
        // one bolt for crossbows, one stone for slings. Ammo is
        // pooled in the shared party stash so any character with the
        // matching weapon can draw from it. The Range option is gated
        // upstream (refreshActions checks compatibleAmmoIds before
        // enabling the row), so reaching this branch with no ammo
        // shouldn't happen — but defend against it anyway with a
        // clean fizzle rather than a silent free shot.
        //
        // `action.ammoId` is set by the ammo picker when the party
        // carries multiple compatible ammo types; falls back to the
        // weapon's default ammo for the single-ammo case.
        const ammoName = action.ammoId ?? action.weapon.ammo;
        const partyData = gameState.partyData;
        if (ammoName && partyData && !consumeAmmoFromStash(partyData, ammoName)) {
          this.combat.log.push(`${me.name} is out of ${ammoName}!`);
          this.refreshLog();
          this.refreshActionMenu();
          return;
        }
        // Look up the ammo item's catalog entry so we can branch on
        // `ignite` (fire arrows leave a fire on the target's cell)
        // and pick a thematic projectile colour. Falls back to a
        // featherless silhouette when the ammo doesn't resolve.
        const ammoDef = ammoName ? this.items.get(ammoName) ?? null : null;
        const ignites = !!ammoDef?.ignite;
        const result = resolveThrow(me, target, action.weapon, defaultRng);
        const ammoLabel = ammoDef?.name ?? action.weapon.name;
        // Damage-type + bonus breakdown, mirroring the melee log line
        // so an elemental ranged weapon (Stormbolt Crossbow's
        // lightning, etc.) reads its magic damage at a glance.
        const rType = result.damageType;
        const rTypeSuffix = rType && rType !== "physical" ? ` (${rType})` : "";
        const rBonus = result.bonusDamage ?? 0;
        const rBreakdown =
          rBonus > 0
            ? ` — ${result.damage} dmg${rTypeSuffix} [${result.damage - rBonus}+${rBonus} bonus]`
            : ` — ${result.damage} dmg${rTypeSuffix}`;
        this.combat.log.push(
          result.hit
            ? `${me.name} fires ${ammoLabel} at ${target.name} (d20:${result.roll}=${result.total} vs AC${target.ac})${rBreakdown}${result.killed ? ", defeated!" : "."}`
            : `${me.name} fires ${ammoLabel} at ${target.name} — miss.`
        );
        // Elemental projectile visual for a relic ranged weapon.
        // Resolution priority:
        //   1. An explicit `animation_id` on the weapon (authored
        //      override) — its `visual` key wins when present.
        //   2. The weapon's `damage_type`, mapped to a themed visual.
        //      This is the DURABLE path: the item editor doesn't carry
        //      `animation_id` (it round-trips to null on save), but it
        //      DOES preserve `damage_type`, so a lightning crossbow
        //      stays lightning-themed even after a re-save.
        // Fire-arrow shots keep their ember trail + ignite path so the
        // two visuals don't fight over the projectile.
        await loadAnimations();
        const weaponAnim = getAnimationById(action.weapon.animation_id);
        const animVisual = (weaponAnim?.visual ?? "").trim();
        const elemental = elementalShotFx(
          (action.weapon.damage_type ?? "").toLowerCase(),
        );
        const shotVisual =
          animVisual !== "" && animVisual !== "none"
            ? animVisual
            : elemental?.visual ?? "";
        const hasShotVisual = !ignites && shotVisual !== "";
        const impactColor = elemental?.color ?? VFX_COLOURS.lightning;
        const impactSfx = weaponAnim?.hit_sfx ?? elemental?.sfx ?? "";
        Sfx.play("arrow");
        await this.animateBump(me, me.position, target.position);
        if (hasShotVisual) {
          const fx = resolveProjectileEffect({ effect_type: shotVisual });
          await fx(this, this.bodyXY(me), this.bodyXY(target));
        } else {
          await this.flyProjectile(
            me,
            target,
            ignites ? VFX_COLOURS.ember : VFX_COLOURS.white,
          );
        }
        await this.animateHit(target, result);
        // Themed impact: elemental crackle SFX + a tinted burst on the
        // target so the magic shot lands with a visible punch.
        if (hasShotVisual && result.hit) {
          if (impactSfx) Sfx.play(impactSfx);
          const tb = this.bodies.get(target.id);
          if (tb) {
            radialBurst(
              this,
              { x: tb.x, y: tb.y },
              impactColor,
              VFX_COLOURS.white,
              36,
            ).catch(() => undefined);
          }
        }
        this.refreshHp(target);
        // Fire arrows ALWAYS ignite the target's tile — even on a
        // miss the burning shaft strikes the ground there and
        // catches it. Before this rule the fire-arrow effect was
        // easy to miss: a kill-shot left nothing alive on the tile
        // for the fire-cell tick to damage, and a miss left no
        // visible cue at all. Igniting unconditionally makes the
        // ability visually unambiguous — the player can see flames
        // on the ground regardless of the d20 outcome — and gives
        // the smart play a meaningful tactical option (chuck a
        // fire arrow at a tile to flush out a fighter, even if the
        // shot itself fizzles).
        if (ignites && ammoDef) {
          this.igniteCell(
            target.position.col,
            target.position.row,
            ammoDef.light_range ?? 3,
            ammoDef.power ?? 3,
          );
          // On-impact fire burst — distinct from the standing
          // emitter that follows. The user reported the fire
          // wasn't visible at all; a one-shot bright burst makes
          // the moment unmistakable while the longer-lived
          // emitter shows the fire is still burning. Anchored
          // to the body's pixel coordinates same as the damage
          // floater above.
          const targetBody = this.bodies.get(target.id);
          if (targetBody) {
            radialBurst(
              this,
              { x: targetBody.x, y: targetBody.y },
              VFX_COLOURS.fire,
              VFX_COLOURS.ember,
              44,
            ).catch(() => undefined);
          }
          this.combat.log.push(
            result.hit
              ? `${ammoLabel} ignites ${target.name}'s tile — fire spreads!`
              : `${ammoLabel} thuds into the ground near ${target.name} and the tile bursts into flame.`,
          );
        }
        // Light-arrow utility (precision shot): a light-themed bow
        // casts a Magic-Light pool on the struck cell — hit or miss,
        // wherever the shaft lands. Mirrors the directional branch.
        if ((action.weapon.damage_type ?? "") === "light") {
          this.lightCell(
            target.position.col,
            target.position.row,
            lightArrowRange(action.weapon),
            `light_arrow_${me.id}`,
          );
          const tb = this.bodies.get(target.id);
          if (tb) {
            glowAura(this, { x: tb.x, y: tb.y }, VFX_COLOURS.buff).catch(
              () => undefined,
            );
          }
          this.combat.log.push(
            `${action.weapon.name}'s light blooms over (${target.position.col}, ${target.position.row}).`,
          );
        }
        if (result.hit) {
          this.applyWeaponDurability(me.id);
          this.applyArmorDurability(target.id);
        }
      } else if (action.kind === "cast") {
        const spell = action.spell;
        const member = this.memberForCurrent();
        if (member && member.max_mp > 0) {
          member.mp = Math.max(0, (member.mp) - spell.mp_cost);
        }
        // Animation-driven dispatch. spell.animation_id picks the
        // cast SFX, the visual key, and the impact SFX as a bundle;
        // every per-effect branch below just runs the visual for
        // that spell, no hand-coded helpers.
        await loadAnimations();
        const animation = getAnimationById(spell.animation_id);
        const castSfx = animation?.cast_sfx ?? "";
        const hitSfx = animation?.hit_sfx ?? "";
        const animVisual = (animation?.visual ?? "").trim();
        const hasVisual = animVisual !== "" && animVisual !== "none";
        /** Resolve and run the animation's visual. For projectile
         *  visuals the (from, to) line is meaningful; for point-only
         *  visuals (heal_sparkles, buff_aura, …) the `from` arg is
         *  ignored. Caller passes target body as `to`. */
        const runVisual = async (
          from: { x: number; y: number },
          to: { x: number; y: number },
        ): Promise<void> => {
          if (!hasVisual) return;
          const fn = resolveProjectileEffect({ effect_type: animVisual });
          await fn(this, from, to);
        };
        if (castSfx) Sfx.play(castSfx);
        this.castGlowFor(me, this.colorForSpell(spell.effect_type));
        const e = spell.effect_type;
        if (e === "heal" || e === "major_heal") {
          const r = resolveHealSpell(me, target, spell, defaultRng);
          this.combat.log.push(
            `${me.name} casts ${spell.name} on ${target.name} — heals ${r.heal} HP.`
          );
          await runVisual(this.bodyXY(target), this.bodyXY(target));
          this.refreshHp(target);
        } else if (
          e === "damage" || e === "undead_damage" || e === "lightning_bolt"
        ) {
          // Damage spells: the animation's visual is a caster→target
          // projectile (lightning_strike, magic_dart, magic_arrow,
          // generic_projectile). lightning_bolt no longer needs its
          // own branch — its visual is just whatever the animation
          // says it is.
          await runVisual(this.bodyXY(me), this.bodyXY(target));
          const r = resolveDamageSpell(me, target, spell, defaultRng);
          this.combat.log.push(
            `${me.name} casts ${spell.name} on ${target.name} — ${r.damage} dmg${r.killed ? ", defeated!" : "."}`
          );
          if (hitSfx) Sfx.play(hitSfx);
          await this.animateHit(target, r);
          this.refreshHp(target);
        } else if (e === "ac_buff") {
          // Shield — single ally gains +AC for spell.duration rounds.
          const ev = spell.effect_value ?? {};
          const value = typeof ev.ac_bonus === "number" ? ev.ac_bonus : 1;
          const turns = typeof spell.duration === "number" ? spell.duration : 3;
          this.combat.addBuff(target.id, {
            kind: "ac_bonus",
            value,
            turnsLeft: turns,
            source: "Shield",
          });
          await runVisual(this.bodyXY(target), this.bodyXY(target));
          this.combat.log.push(
            `${me.name} casts ${spell.name} on ${target.name} — +${value} AC for ${turns} turns.`
          );
        } else if (e === "curse") {
          // Curse — single enemy: -ATK to its hit rolls and -AC to
          // its defence (i.e. easier to hit). Mirrors the Python
          // game's curse_buffs which stores both penalties.
          const ev = spell.effect_value ?? {};
          const atk = typeof ev.attack_penalty === "number" ? ev.attack_penalty : 2;
          const acP = typeof ev.ac_penalty === "number" ? ev.ac_penalty : 2;
          const turns = typeof spell.duration === "number" ? spell.duration : 4;
          this.combat.addBuff(target.id, {
            kind: "attack_penalty",
            value: atk,
            turnsLeft: turns,
            source: "Curse",
          });
          this.combat.addBuff(target.id, {
            kind: "ac_penalty",
            value: acP,
            turnsLeft: turns,
            source: "Curse",
          });
          await runVisual(this.bodyXY(target), this.bodyXY(target));
          this.combat.log.push(
            `${me.name} casts ${spell.name} on ${target.name} — -${atk} ATK / -${acP} AC for ${turns} turns.`
          );
        } else if (e === "range_buff") {
          // Long Shanks — single ally gains extra movement range.
          const ev = spell.effect_value ?? {};
          const value = typeof ev.range_bonus === "number" ? ev.range_bonus : 4;
          const turns = typeof spell.duration === "number" ? spell.duration : 3;
          this.combat.addBuff(target.id, {
            kind: "range_bonus",
            value,
            turnsLeft: turns,
            source: "Long Shanks",
          });
          await runVisual(this.bodyXY(target), this.bodyXY(target));
          this.combat.log.push(
            `${me.name} casts ${spell.name} on ${target.name} — +${value} move for ${turns} turns.`
          );
        } else {
          // Status / debuff effects we don't have full mechanics for
          // yet (sleep / charm / cure_poison / restore — these need
          // status models the buff engine doesn't cover). Even
          // without status persistence, the SAVE is now real: a
          // monster with high INT/WIS resists Sleep/Charm/Curse,
          // a low-INT zombie folds. The visible feedback (animation
          // + log line) reflects what happened.
          const isAlly = target.side === me.side;
          const ev = spell.effect_value ?? {};
          const hasSave =
            typeof ev.save_dc_stat === "string" || typeof ev.save_dc_base === "number";
          if (hasSave && !isAlly) {
            const save = rollSpellSave(me, target, spell, defaultRng);
            const stat = save.saveStat.toUpperCase().slice(0, 3);
            const sign = save.bonus >= 0 ? "+" : "";
            const verdict = save.saved ? "saved" : "failed";
            const dice =
              `${stat} save: d20(${save.roll}) ${sign}${save.bonus} = ${save.total} ` +
              `vs DC ${save.dc} — ${verdict}`;
            if (save.saved) {
              this.combat.log.push(
                `${me.name} casts ${spell.name} on ${target.name} — resisted! (${dice})`,
              );
            } else {
              this.combat.log.push(
                `${me.name} casts ${spell.name} on ${target.name} — ` +
                `${describeStatusCast(me, target, spell)} (${dice})`,
              );
            }
          } else {
            this.combat.log.push(
              `${me.name} casts ${spell.name} on ${target.name} — ${describeStatusCast(me, target, spell)}`,
            );
          }
          // Animation plays regardless of save outcome — the log
          // line carries the result.
          await runVisual(this.bodyXY(target), this.bodyXY(target));
        }
      }
      // Throw / cast each consume the rest of the turn.
      this.combat.movePoints = 0;
      this.refreshAll();
      if (this.combat.isOver) return this.endEncounter();
      this.endActorTurn();
    } finally {
      this.pendingAction = null;
      this.busy = false;
    }
  }

  // ── Picker / target overlays ─────────────────────────────────────

  /**
   * Picker overlay over the right HUD. Lines longer than the visible
   * window scroll; the active row is highlighted with the rust accent
   * stripe and a "> " prefix. Number keys 1..N still pick the Nth
   * visible row as a shortcut.
   *
   * `cursor` is the index into the full `lines` array — pass -1 for
   * a static prompt with no active row (used by the older static
   * popups before they were converted; today every caller passes a
   * cursor).
   */
  private renderPicker(title: string, lines: string[], cursor = -1): void {
    this.clearPicker();
    const VISIBLE_MAX = 12;
    const total = lines.length;
    const visibleCount = Math.min(VISIBLE_MAX, total);
    // Compute scroll window so `cursor` is always in view.
    let topRow = 0;
    if (cursor >= 0 && total > visibleCount) {
      const half = Math.floor(visibleCount / 2);
      topRow = Math.max(0, Math.min(total - visibleCount, cursor - half));
    }
    const rowH = 18;
    const titleH = 24;
    const hintH = 28;
    const bodyH = visibleCount * rowH + 8;
    const w = HUD_W - 12;
    const h = titleH + bodyH + hintH;
    const x = HUD_X + 6;
    const y = HUD_Y + HUD_H - 6 - h;
    // Backing panel with a rust accent border so it pops over the
    // dimmer HUD background.
    const bg = this.add
      .rectangle(x, y, w, h, 0x10101a, 0.98)
      .setOrigin(0)
      .setStrokeStyle(2, C.accent);
    this.pickerObjects.push(bg);
    this.pickerObjects.push(
      this.add.text(x + 10, y + 6, title, FONT_HEAD(C.accent))
    );

    // Scroll indicator (top) — small triangle pointing up if there are
    // hidden rows above.
    if (topRow > 0) {
      this.pickerObjects.push(
        this.add.text(x + w - 24, y + 6, "▲", FONT_MONO(C.gold))
      );
    }

    const startY = y + titleH;
    for (let i = 0; i < visibleCount; i++) {
      const row = topRow + i;
      const line = lines[row];
      const ry = startY + i * rowH;
      const isCursor = row === cursor;
      if (isCursor) {
        // Selection bar + accent stripe down the left edge.
        this.pickerObjects.push(
          this.add.rectangle(x + 4, ry, w - 8, rowH, C.selectBg, 1).setOrigin(0)
        );
        this.pickerObjects.push(
          this.add.rectangle(x + 4, ry, 3, rowH, C.accent, 1).setOrigin(0)
        );
      }
      // Number-key shortcut shows visible row number 1..VISIBLE_MAX.
      const shortcut = i < 9 ? `[${i + 1}] ` : "    ";
      this.pickerObjects.push(
        this.add.text(x + 10, ry + 1, `${shortcut}${line}`,
          FONT_BODY(isCursor ? C.body : C.dim))
      );
    }

    // Scroll indicator (bottom).
    if (topRow + visibleCount < total) {
      this.pickerObjects.push(
        this.add.text(x + w - 24, startY + bodyH - 18, "▼", FONT_MONO(C.gold))
      );
    }

    const hintText = total > visibleCount
      ? "[↑↓] scroll  [Enter] pick  [1-9] shortcut  [ESC] cancel"
      : "[↑↓] move  [Enter] pick  [1-9] shortcut  [ESC] cancel";
    this.pickerObjects.push(
      this.add.text(x + 10, y + h - 22, hintText, FONT_MONO(C.faint))
    );
  }

  private clearPicker(): void {
    for (const o of this.pickerObjects) o.destroy();
    this.pickerObjects = [];
  }

  /** Draw 1..N badges over each valid target on the arena. The
   *  badge at `targetCursor` is rendered larger + brighter and gets
   *  a ring underneath so the arrow-key cursor reads clearly. */
  private drawTargetBadges(side: "party" | "enemies"): void {
    this.clearTargetBadges();
    // Reuse currentTargetList so range filtering / target side is
    // resolved in one place.
    const targets = this.currentTargetList();
    void side;
    // Clamp the cursor to the list — entering pick-target with a
    // fresh action resets to 0; remaining inside pick-target across
    // re-renders (e.g. a target died) keeps the cursor pointed at a
    // valid row.
    if (this.targetCursor >= targets.length) {
      this.targetCursor = Math.max(0, targets.length - 1);
    }
    targets.forEach((t, i) => {
      const x = this.tileX(t.position.col);
      const y = this.tileY(t.position.row) - TILE / 2 - 4;
      const isCursor = i === this.targetCursor;
      const badge = this.add
        .text(x, y, `${i + 1}`, {
          fontFamily: "Georgia, serif",
          fontSize: isCursor ? "20px" : "16px",
          color: isCursor ? "#ffe580" : hex(C.gold),
          stroke: "#1a1a2e",
          strokeThickness: isCursor ? 5 : 4,
          fontStyle: isCursor ? "bold" : "normal",
        })
        .setOrigin(0.5, 1)
        .setDepth(80);
      this.targetBadges.push(badge);
      // Click target sprite directly to confirm.
      const body = this.bodies.get(t.id);
      if (body) {
        body.setInteractive({ useHandCursor: true });
        body.once("pointerdown", () => this.resolveTarget(t));
      }
    });
    this.repaintTargetCursorRing(targets);
  }

  /** Paint a yellow ring on the targetCursor target's tile (or clear
   *  it when the list is empty). Called when badges are drawn and
   *  whenever the cursor moves. */
  private repaintTargetCursorRing(targets: Combatant[]): void {
    if (this.targetCursorGfx) {
      this.targetCursorGfx.destroy();
      this.targetCursorGfx = null;
    }
    const t = targets[this.targetCursor];
    if (!t) return;
    const x = this.tileX(t.position.col);
    const y = this.tileY(t.position.row);
    const g = this.add.graphics().setDepth(78);
    // Soft outer halo + bright inner ring — reads against both
    // bright floor and dark night tiles.
    g.lineStyle(2, 0xffe580, 0.4);
    g.strokeCircle(x, y, TILE / 2 + 6);
    g.lineStyle(2, 0xffe580, 1);
    g.strokeCircle(x, y, TILE / 2 + 2);
    this.targetCursorGfx = g;
  }

  private clearTargetBadges(): void {
    for (const b of this.targetBadges) b.destroy();
    this.targetBadges = [];
    if (this.targetCursorGfx) {
      this.targetCursorGfx.destroy();
      this.targetCursorGfx = null;
    }
    // Drop the one-shot listeners we attached.
    for (const c of this.combat.combatants) {
      const body = this.bodies.get(c.id);
      if (body) body.off("pointerdown");
    }
  }

  // ── Tile picker ──────────────────────────────────────────────────

  /**
   * Begin tile selection for a spell whose targeting is `select_tile`
   * (or whose effect_type is one of the tile-placed kinds:
   * aoe_fireball / teleport / summon_skeleton). The cursor starts
   * adjacent to the caster — north for ranged spells like Fireball,
   * south for self-relocation like Misty Step.
   */
  private startTilePicking(spell: Spell): void {
    const me = this.combat.current;
    const start = {
      col: Math.max(1, Math.min(ARENA_COLS - 2, me.position.col)),
      row: Math.max(1, Math.min(ARENA_ROWS - 2, me.position.row - 2)),
    };
    this.tileCursorPos = start;
    this.pendingAction = { kind: "tile", spell };
    this.mode = "pick-tile";
    this.clearPicker();
    this.refreshTileCursor();
    // Hint at bottom of right HUD.
    this.renderTilePickerHint(spell);
  }

  /** Move the tile cursor by (dc, dr), clamped to the open arena and
   *  — for throw-tile mode — to within the item's throw range from
   *  the caster. The range cap is silent: pressing a direction that
   *  would push past the cap leaves the cursor where it is. */
  private moveTileCursor(dc: number, dr: number): void {
    const next = {
      col: this.tileCursorPos.col + dc,
      row: this.tileCursorPos.row + dr,
    };
    // Clamp to inside the wall ring (1..N-2).
    next.col = Math.max(1, Math.min(ARENA_COLS - 2, next.col));
    next.row = Math.max(1, Math.min(ARENA_ROWS - 2, next.row));
    // For throw-tile + range-tile, enforce the item's / weapon's
    // max range as a Chebyshev distance from the caster. Refuse
    // moves that would step the reticle past the cap.
    const pending = this.pendingAction;
    if (
      this.mode === "pick-tile" &&
      (pending?.kind === "throw-tile" || pending?.kind === "range-tile")
    ) {
      const caster = this.combat.current.position;
      const sourceItem =
        pending.kind === "throw-tile" ? pending.item : pending.weapon;
      const range = maxRangeFor(sourceItem);
      const cheb = Math.max(
        Math.abs(next.col - caster.col),
        Math.abs(next.row - caster.row),
      );
      if (cheb > range) {
        // Out of range — keep the cursor where it was.
        return;
      }
    }
    this.tileCursorPos = next;
    this.refreshTileCursor();
  }

  /** Re-render the tile cursor reticle + AOE / light preview if
   *  applicable. Shared between tile-spells and throw-tile.  */
  private refreshTileCursor(): void {
    this.clearTileCursor();
    if (this.mode !== "pick-tile") return;
    const action = this.pendingAction;
    if (!action) return;
    if (
      action.kind !== "tile" &&
      action.kind !== "throw-tile" &&
      action.kind !== "range-tile"
    )
      return;
    const { col, row } = this.tileCursorPos;
    // Per-action preview radius: spells use `effect_value.radius`,
    // ignitable throws / fire-arrow shots use the ammo / item's
    // `light_range` (default 3).
    let radius = 0;
    let previewColor = 0xff8e3c;
    if (action.kind === "tile") {
      const ev = action.spell.effect_value ?? {};
      radius = typeof (ev as Record<string, unknown>).radius === "number"
        ? (ev as { radius: number }).radius
        : 0;
    } else if (action.kind === "throw-tile") {
      // throw-tile: preview the area the fire would light up.
      radius = action.item.light_range ?? 3;
      previewColor = 0xffb84d;
    } else {
      // range-tile: preview the area the fire arrow would light up.
      // light_range lives on the ammo record (Fire Arrows = 3).
      const ammoDef = this.items.get(action.ammoId);
      radius = ammoDef?.light_range ?? 3;
      previewColor = 0xffb84d;
    }
    // Lift the reticle + radius preview above the darkness overlay
    // (depth 20) any time the scene is in darkness mode. Otherwise
    // the cursor sits at the legacy depth (15-16) underneath the
    // shadow and the player can't see what they're targeting. This
    // matters for two cases:
    //
    //   1. Throw-tile (lit torch): always pointed into the dark,
    //      so we always lift here — same as it has been.
    //   2. Spell tile-picks (Light, Fireball, etc) during a
    //      darkness battle: the player needs to see the reticle
    //      to aim, even on cells the party hasn't lit yet. The
    //      Light spell in particular targets cells specifically
    //      because they're dark; hiding the cursor under the
    //      shadow defeats the spell's whole point.
    //
    // Outside darkness mode, no overlay is drawn, so legacy depths
    // are fine.
    const liftAboveDarkness =
      action.kind === "throw-tile" ||
      action.kind === "range-tile" ||
      this.darkness;
    const previewDepth = liftAboveDarkness ? 21 : 15;
    const cursorDepth = liftAboveDarkness ? 22 : 16;
    if (radius > 0) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const c = col + dc;
          const r = row + dr;
          if (c < 1 || c >= ARENA_COLS - 1 || r < 1 || r >= ARENA_ROWS - 1) continue;
          if (Math.max(Math.abs(dc), Math.abs(dr)) > radius) continue;
          if (dc === 0 && dr === 0) continue; // centre handled below
          const aoe = this.add
            .rectangle(ARENA_X + c * TILE, ARENA_Y + r * TILE, TILE, TILE,
                       previewColor, 0.18)
            .setOrigin(0)
            .setStrokeStyle(1, previewColor, 0.35)
            .setDepth(previewDepth);
          this.tileCursorObjects.push(aoe);
        }
      }
    }
    // Centre reticle — solid rust-red border.
    const cursor = this.add
      .rectangle(ARENA_X + col * TILE, ARENA_Y + row * TILE, TILE, TILE,
                 C.cursor, 0)
      .setOrigin(0)
      .setStrokeStyle(2, C.cursor)
      .setDepth(cursorDepth);
    this.tileCursorObjects.push(cursor);
  }

  private clearTileCursor(): void {
    for (const o of this.tileCursorObjects) o.destroy();
    this.tileCursorObjects = [];
  }

  // ── Directional projectiles (Magic Dart, etc.) ──────────────────
  //
  // The player presses one of the four arrow keys; the spell flies
  // along that cardinal line until it hits the first creature, runs
  // out of `spell.range` tiles, or smacks a wall. Mirrors Python's
  // _fire_fireball ray-walk.

  /** Enter direction-pick mode for a directional_projectile spell. */
  private startDirectionPicking(spell: Spell): void {
    this.pendingAction = { kind: "direction", spell };
    this.mode = "pick-direction";
    this.clearPicker();
    this.renderDirectionPickerHint(spell);
    // Reach overlay: paint the four cardinal lines the bolt could
    // travel, clipped at the first obstruction. Gives the player a
    // visual preview of where the cast will land before they commit.
    this.drawActionHints();
  }

  /** Bottom-of-HUD prompt explaining the direction controls. */
  private renderDirectionPickerHint(spell: Spell): void {
    const range = typeof spell.range === "number" ? spell.range : 99;
    const lines = [
      `Casting: ${spell.name}`,
      `Range: ${range} tiles`,
      "[↑↓←→] choose direction",
      "[ESC]   cancel",
    ];
    const w = HUD_W - 12, h = lines.length * 18 + 28;
    const x = HUD_X + 6, y = HUD_Y + HUD_H - 6 - h;
    this.pickerObjects.push(
      this.add.rectangle(x, y, w, h, 0x10101a, 0.98)
        .setOrigin(0)
        .setStrokeStyle(2, C.accent)
    );
    this.pickerObjects.push(
      this.add.text(x + 10, y + 8, "PICK A DIRECTION", FONT_HEAD(C.accent))
    );
    lines.forEach((line, i) => {
      this.pickerObjects.push(
        this.add.text(x + 10, y + 30 + i * 18, line, FONT_BODY())
      );
    });
  }

  /**
   * Resolve a direction-locked spell by tracing a ray from the caster
   * in the chosen cardinal direction. Spends MP, plays the cast SFX
   * + projectile VFX, applies damage on the first enemy hit, or logs
   * a fizzle if the ray hits nothing.
   */
  private async fireDirectionalSpell(dir: Direction): Promise<void> {
    const action = this.pendingAction;
    if (!action || action.kind !== "direction") return;
    const me = this.combat.current;
    const spell = action.spell;
    const member = this.memberForCurrent();
    if (member && member.max_mp > 0) {
      member.mp = Math.max(0, (member.mp) - spell.mp_cost);
    }
    this.busy = true;
    this.mode = "default";
    this.pendingAction = null;
    this.clearPicker();
    // Drop the reach overlay before the bolt flies — see resolveTarget
    // for the rationale (hint grid washes out the projectile VFX).
    this.clearMoveHints();

    const [dCol, dRow] = DIR_DELTAS[dir];
    const range = typeof spell.range === "number" ? spell.range : 99;
    // Directional bolts honour BOTH the perimeter wall AND arena-map
    // obstructs. magic_dart / lightning_bolt aren't routed through
    // `currentTargetList` (they pick a direction, not a target from a
    // list), so the LOS filter that gates Range + select-enemy spells
    // doesn't apply here — we have to feed the obstructions into the
    // ray's stop predicate directly. Walkability is intentionally NOT
    // checked: a pit you can't stand in shouldn't stop an arrow flying
    // overhead.
    const obstructsRay = (c: number, r: number): boolean => {
      if (isWall(c, r)) return true;
      const cell = this.arenaCells?.[r]?.[c];
      return cell?.obstructs === true;
    };
    const trace = traceDirectionalRay(
      me.position,
      { dCol, dRow },
      range,
      obstructsRay,
      (c, r) => this.combat.combatantAt(c, r),
    );

    // Ensure the animation catalog is loaded before we resolve the
    // dispatch. Cached after first call so this is a no-op on every
    // subsequent cast. Wrapped in await so the first cast doesn't
    // race the fetch and silently fall back to the legacy visual.
    await loadAnimations();

    // Resolve the animation. Every spell carries an animation_id
    // post-migration; the catalog has the cast SFX, the visual key,
    // and the impact SFX bundled together.
    const animation = getAnimationById(spell.animation_id);
    const castSfx = animation?.cast_sfx ?? "";
    const hitSfx = animation?.hit_sfx ?? "";

    if (castSfx) Sfx.play(castSfx);
    this.castGlowFor(me, this.colorForSpell(spell.effect_type));
    try {
      // Animate the projectile from caster → endpoint regardless of
      // whether anything was hit, so the player sees the cast resolve.
      // The animation's `visual` is a key into the effectRegistry —
      // "none" or unset means skip the projectile draw (audio-only).
      const start = this.bodyXY(me);
      const endPx = {
        x: this.tileX(trace.endCol),
        y: this.tileY(trace.endRow),
      };
      const animVisual = (animation?.visual ?? "").trim();
      if (animVisual && animVisual !== "none") {
        const projectile = resolveProjectileEffect({
          effect_type: animVisual,
        });
        await projectile(this, start, endPx);
      }

      if (trace.hitId) {
        const target = this.combat.byId(trace.hitId);
        // Directional spells don't discriminate — the bolt smacks the
        // first creature in its path, friend or foe. Aim carefully.
        const r = resolveDamageSpell(me, target, spell, defaultRng);
        const friendly = target.side === me.side;
        const tag = friendly ? " — FRIENDLY FIRE!" : "";
        this.combat.log.push(
          `${me.name} casts ${spell.name} → ${target.name} (${dir.toUpperCase()})${tag} — ${r.damage} dmg${r.killed ? ", defeated!" : "."}`
        );
        if (hitSfx) Sfx.play(hitSfx);
        await this.animateHit(target, r);
        this.refreshHp(target);
      } else {
        this.combat.log.push(
          `${me.name}'s ${spell.name} flies ${dir.toUpperCase()} — fizzles, nothing in range.`
        );
      }
      // Cast consumes the rest of the turn whether or not the dart
      // connected, mirroring how throw / cast already behave.
      this.combat.movePoints = 0;
      this.refreshAll();
      if (this.combat.isOver) return this.endEncounter();
      this.endActorTurn();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Directional-projectile counterpart for ranged WEAPONS — short
   * bows, long bows, slings. Mirrors `fireDirectionalSpell`'s
   * structure (trace ray, fly projectile, resolve first creature
   * hit, FF risk on allies) but uses weapon resolution instead of
   * spell math: consume one ammo from the stash, run `resolveThrow`
   * (the same dice helper Range/Throw already use), and wear the
   * weapon's durability one tick on a successful hit.
   *
   * Obstructions stop the bolt the same way they stop directional
   * spells; the `obstructsRay` predicate is built locally so this
   * method's behaviour stays self-contained.
   */
  private async fireDirectionalRange(dir: Direction): Promise<void> {
    const action = this.pendingAction;
    if (!action || action.kind !== "range-direction") return;
    const me = this.combat.current;
    const weapon = action.weapon;

    // Ammo gate — abort cleanly if the stash is empty. The Range
    // row's enable check upstream catches the typical case, but a
    // bow with built-in ammo (Rock — both throwable AND ranged)
    // has no `ammo` string and shouldn't try to consume from the
    // stash, mirroring the existing target-range branch.
    //
    // `action.ammoId` is set by the ammo picker when the party
    // carries multiple compatible ammo types; falls back to the
    // weapon's default ammo for the single-ammo case.
    const ammoName = action.ammoId ?? weapon.ammo;
    const partyData = gameState.partyData;
    if (ammoName && partyData && !consumeAmmoFromStash(partyData, ammoName)) {
      this.combat.log.push(`${me.name} is out of ${ammoName}!`);
      this.refreshLog();
      this.pendingAction = null;
      this.mode = "default";
      this.refreshActionMenu();
      return;
    }
    // Catalog lookup so the directional fire-arrow branch can also
    // tint the projectile + ignite the cell on hit.
    const ammoDef = ammoName ? this.items.get(ammoName) ?? null : null;
    const ignites = !!ammoDef?.ignite;

    this.busy = true;
    this.mode = "default";
    this.pendingAction = null;
    this.clearPicker();
    // Drop the reach overlay before the arrow flies — see resolveTarget
    // for the rationale (hint grid washes out the projectile VFX).
    this.clearMoveHints();

    const [dCol, dRow] = DIR_DELTAS[dir];
    // Bows don't carry an explicit range value yet — use maxRangeFor
    // so each weapon type still has its tactical reach (long bow >
    // short bow > sling). Same predicate as the directional spell
    // path: perimeter walls + obstructing cells stop the bolt;
    // walkability doesn't matter for an arrow in flight.
    const range = maxRangeFor(weapon);
    const obstructsRay = (c: number, r: number): boolean => {
      if (isWall(c, r)) return true;
      const cell = this.arenaCells?.[r]?.[c];
      return cell?.obstructs === true;
    };
    const trace = traceDirectionalRay(
      me.position,
      { dCol, dRow },
      range,
      obstructsRay,
      (c, r) => this.combat.combatantAt(c, r),
    );

    Sfx.play("arrow");
    try {
      const start = this.bodyXY(me);
      const endPx = {
        x: this.tileX(trace.endCol),
        y: this.tileY(trace.endRow),
      };
      // Elemental relic visual on the directional shot — same
      // resolution as the precision branch: a weapon's `animation_id`
      // override wins, else its `damage_type` maps to a themed visual
      // (Starfall Sling's "meteor" → falling-star meteor strike). Fire
      // arrows keep their ember streak + ignite path. Plain weapons
      // fall back to the white projectile streak.
      await loadAnimations();
      const dirWeaponAnim = getAnimationById(weapon.animation_id);
      const dirAnimVisual = (dirWeaponAnim?.visual ?? "").trim();
      const dirElemental = elementalShotFx(
        (weapon.damage_type ?? "").toLowerCase(),
      );
      const dirShotVisual =
        dirAnimVisual !== "" && dirAnimVisual !== "none"
          ? dirAnimVisual
          : dirElemental?.visual ?? "";
      const dirHasShotVisual = !ignites && dirShotVisual !== "";
      if (dirHasShotVisual) {
        const fx = resolveProjectileEffect({ effect_type: dirShotVisual });
        await fx(this, start, endPx);
      } else {
        await projectileLine(
          this,
          start,
          endPx,
          ignites ? VFX_COLOURS.ember : VFX_COLOURS.white,
          220,
        );
      }

      if (trace.hitId) {
        const target = this.combat.byId(trace.hitId);
        const result = resolveThrow(me, target, weapon, defaultRng);
        const friendly = target.side === me.side;
        const tag = friendly ? " — FRIENDLY FIRE!" : "";
        const ammoLabel = ammoDef?.name ?? weapon.name;
        // Damage-type + bonus breakdown, matching the precision branch.
        const rType = result.damageType;
        const rTypeSuffix = rType && rType !== "physical" ? ` (${rType})` : "";
        const rBonus = result.bonusDamage ?? 0;
        const rBreakdown =
          rBonus > 0
            ? `${result.damage} dmg${rTypeSuffix} [${result.damage - rBonus}+${rBonus} bonus]`
            : `${result.damage} dmg${rTypeSuffix}`;
        this.combat.log.push(
          result.hit
            ? `${me.name} looses ${ammoLabel} → ${target.name} (${dir.toUpperCase()})${tag} — ${rBreakdown}${result.killed ? ", defeated!" : "."}`
            : `${me.name} looses ${ammoLabel} → ${target.name} (${dir.toUpperCase()}) — miss.`,
        );
        await this.animateHit(target, result);
        // Elemental impact: themed crackle/boom SFX + tinted burst.
        if (dirHasShotVisual && result.hit) {
          const impactSfx = dirWeaponAnim?.hit_sfx ?? dirElemental?.sfx ?? "";
          if (impactSfx) Sfx.play(impactSfx);
          const tb = this.bodies.get(target.id);
          if (tb) {
            radialBurst(
              this,
              { x: tb.x, y: tb.y },
              dirElemental?.color ?? VFX_COLOURS.fire,
              VFX_COLOURS.white,
              36,
            ).catch(() => undefined);
          }
        }
        this.refreshHp(target);
        // Fire arrows ignite the target's cell regardless of the
        // d20 outcome — see the precision branch above for the
        // full rationale. Hit OR miss, the burning shaft lights
        // up the tile.
        if (ignites && ammoDef) {
          this.igniteCell(
            target.position.col,
            target.position.row,
            ammoDef.light_range ?? 3,
            ammoDef.power ?? 3,
          );
          const targetBody = this.bodies.get(target.id);
          if (targetBody) {
            radialBurst(
              this,
              { x: targetBody.x, y: targetBody.y },
              VFX_COLOURS.fire,
              VFX_COLOURS.ember,
              44,
            ).catch(() => undefined);
          }
          this.combat.log.push(
            result.hit
              ? `${ammoLabel} ignites ${target.name}'s tile — fire spreads!`
              : `${ammoLabel} thuds into the ground near ${target.name} and the tile bursts into flame.`,
          );
        }
        if (result.hit) {
          this.applyWeaponDurability(me.id);
          this.applyArmorDurability(target.id);
        }
      } else {
        // No creature in line. For a regular arrow this is a fizzle.
        // For a fire arrow the shaft still lands at the end of its
        // path (trace.endCol / endRow — either the weapon's max
        // range OR the first obstruction it stopped against), and
        // the burning shaft ignites that cell. Lets the player
        // shoot fire arrows down a dark corridor to light it up,
        // hit-or-miss, exactly the player's request.
        if (ignites && ammoDef) {
          this.igniteCell(
            trace.endCol,
            trace.endRow,
            ammoDef.light_range ?? 3,
            ammoDef.power ?? 3,
          );
          const endX = this.tileX(trace.endCol);
          const endY = this.tileY(trace.endRow);
          radialBurst(
            this,
            { x: endX, y: endY },
            VFX_COLOURS.fire,
            VFX_COLOURS.ember,
            44,
          ).catch(() => undefined);
          this.combat.log.push(
            `${me.name}'s ${ammoDef.name ?? "Fire Arrows"} fall short — the tile at (${trace.endCol}, ${trace.endRow}) bursts into flame.`,
          );
        } else {
          this.combat.log.push(
            `${me.name}'s ${weapon.name} flies ${dir.toUpperCase()} — nothing in line.`,
          );
        }
      }
      // Light-arrow utility: a light-themed bow (Dawnlight Bow) casts
      // a Magic-Light pool wherever the shaft lands — the cell at the
      // end of its flight (the struck creature's tile on a hit, or the
      // max-range / obstruction cell on a miss). Hit OR miss the tile
      // lights up, so a player can fire one down a dark corridor to
      // see what's there. Mirrors the fire-arrow ignite pattern, but
      // light instead of flame (no damage).
      if ((weapon.damage_type ?? "") === "light") {
        this.lightCell(trace.endCol, trace.endRow, lightArrowRange(weapon), `light_arrow_${me.id}`);
        glowAura(
          this,
          { x: this.tileX(trace.endCol), y: this.tileY(trace.endRow) },
          VFX_COLOURS.buff,
        ).catch(() => undefined);
        this.combat.log.push(
          `${weapon.name}'s light blooms over (${trace.endCol}, ${trace.endRow}).`,
        );
      }
      // Same end-of-turn behaviour as throw/cast/target-range: the
      // shot consumes the rest of the turn.
      this.combat.movePoints = 0;
      this.refreshAll();
      if (this.combat.isOver) return this.endEncounter();
      this.endActorTurn();
    } finally {
      this.busy = false;
    }
  }

  /** Tiny prompt sitting where the picker overlay used to. */
  private renderTilePickerHint(spell: Spell): void {
    this.clearPicker();
    const lines = [
      `Casting: ${spell.name}`,
      "[↑↓←→] move reticle",
      "[Enter] confirm",
      "[ESC]   cancel",
    ];
    const w = HUD_W - 12, h = lines.length * 18 + 28;
    const x = HUD_X + 6, y = HUD_Y + HUD_H - 6 - h;
    this.pickerObjects.push(
      this.add.rectangle(x, y, w, h, 0x10101a, 0.98)
        .setOrigin(0)
        .setStrokeStyle(2, C.accent)
    );
    this.pickerObjects.push(
      this.add.text(x + 10, y + 8, "PICK A TILE", FONT_HEAD(C.accent))
    );
    lines.forEach((line, i) => {
      this.pickerObjects.push(
        this.add.text(x + 10, y + 30 + i * 18, line, FONT_BODY())
      );
    });
  }

  /**
   * Resolve whatever tile-targeted spell the player just confirmed.
   * Branches by effect_type: AOE damage, teleport, summon (stub).
   */
  private async resolveTileSpell(): Promise<void> {
    const action = this.pendingAction;
    if (!action || action.kind !== "tile") return;
    const me = this.combat.current;
    const spell = action.spell;
    const member = this.memberForCurrent();
    if (member && member.max_mp > 0) {
      member.mp = Math.max(0, (member.mp) - spell.mp_cost);
    }
    this.busy = true;
    this.mode = "default";
    this.pendingAction = null;
    this.clearTileCursor();
    this.clearPicker();
    // Drop the reach overlay before the AOE / teleport / summon burst
    // plays — see resolveTarget for the rationale (hint grid washes
    // out the spell VFX).
    this.clearMoveHints();
    // Animation-driven cast SFX. The per-effect handlers below
    // resolve their own visuals through the animation (since each
    // has different from/to semantics — AOE projectile, teleport
    // arrival burst, summon spawn burst).
    await loadAnimations();
    const animation = getAnimationById(spell.animation_id);
    if (animation?.cast_sfx) Sfx.play(animation.cast_sfx);
    this.castGlowFor(me, this.colorForSpell(spell.effect_type));
    try {
      const e = spell.effect_type;
      if (e === "aoe_damage") {
        await this.resolveAoeFireball(me, spell, this.tileCursorPos);
      } else if (e === "teleport") {
        await this.resolveTeleport(me, spell, this.tileCursorPos);
      } else if (e === "summon") {
        await this.resolveSummonSkeleton(me, spell, this.tileCursorPos);
      } else if (e === "magic_light") {
        // Cleric's Light spell — drops a torch-equivalent light pool
        // at the targeted cell with a fairy particle effect sitting
        // on top (vs. the flame an authored torch shows). Targeting
        // any arena cell, no caster-distance cap (the tile picker's
        // only bound is the wall ring, which matches "no limited
        // range"). Mirrors `igniteCell`'s pattern of "push a
        // LightSource + create an emitter + refreshDarkness" but
        // skips the damage / per-cell bookkeeping fire needs —
        // magical light is decorative and hurts nothing.
        //
        // Outside a darkness battle (`this.darkness === false`) the
        // light pool has nothing to illuminate, but the fairy
        // emitter still renders so the player gets visual feedback
        // that the spell fired.
        const ev = spell.effect_value ?? {};
        const lightRange =
          typeof ev.radius === "number" && ev.radius > 0
            ? ev.radius
            : 5;
        const { col, row } = this.tileCursorPos;
        this.lightCell(col, row, lightRange, `magic_light_${me.id}`);
        this.combat.log.push(
          `${me.name} casts ${spell.name} on (${col}, ${row}) — a divine glow illuminates the area (${lightRange}-tile light).`,
        );
      } else {
        this.combat.log.push(
          `${me.name} casts ${spell.name} on a tile — no effect yet.`
        );
      }
      this.combat.movePoints = 0;
      this.refreshAll();
      if (this.combat.isOver) return this.endEncounter();
      this.endActorTurn();
    } finally {
      this.busy = false;
    }
  }

  // ── Throw-tile picker (ignitable items) ─────────────────────────
  //
  // Routes "Throw" of an ignitable item (e.g. a lit torch) into the
  // tile picker so the player can target ANY open cell in range,
  // dark or empty — the whole point of throwing a torch is to light
  // up an area, which means the target cell is by definition the
  // one the party cannot see. Reuses the pick-tile mode (cursor,
  // arrow-key nudging, ESC cancel) so we don't duplicate input
  // plumbing; the only divergence is the pending-action variant +
  // the resolver below.

  /**
   * Begin tile selection for an ignitable thrown item. Cursor starts
   * one tile north of the caster — close enough that a quick Enter
   * lights the ground in front of them, far enough that the caster
   * sprite isn't underneath the reticle.
   */
  private startThrowTilePicking(item: Item): void {
    const me = this.combat.current;
    const start = {
      col: Math.max(1, Math.min(ARENA_COLS - 2, me.position.col)),
      row: Math.max(1, Math.min(ARENA_ROWS - 2, me.position.row - 1)),
    };
    this.tileCursorPos = start;
    this.pendingAction = { kind: "throw-tile", item };
    this.mode = "pick-tile";
    this.clearPicker();
    this.refreshTileCursor();
    this.renderThrowTilePickerHint(item);
    // Range overlay: paint the cells the player can reach. drawActionHints
    // grew a throw-tile branch — gives the player a visual cap so they
    // know exactly which squares the cursor can travel to.
    this.drawActionHints();
  }

  /** Bottom-of-HUD prompt for the throw-tile picker — describes the
   *  item, the throw range, and the keyboard controls. */
  private renderThrowTilePickerHint(item: Item): void {
    this.clearPicker();
    const range = maxRangeFor(item);
    const lines = [
      `Throwing: ${item.name}`,
      `Range: ${range} tiles`,
      "[↑↓←→] move reticle",
      "[Enter] confirm",
      "[ESC]   cancel",
    ];
    const w = HUD_W - 12, h = lines.length * 18 + 28;
    const x = HUD_X + 6, y = HUD_Y + HUD_H - 6 - h;
    this.pickerObjects.push(
      this.add.rectangle(x, y, w, h, 0x10101a, 0.98)
        .setOrigin(0)
        .setStrokeStyle(2, C.accent)
    );
    this.pickerObjects.push(
      this.add.text(x + 10, y + 8, "PICK A TILE", FONT_HEAD(C.accent))
    );
    lines.forEach((line, i) => {
      this.pickerObjects.push(
        this.add.text(x + 10, y + 30 + i * 18, line, FONT_BODY())
      );
    });
  }

  /**
   * Resolve a confirmed throw-tile. Mirrors the throw-at-creature
   * branch of `resolveTarget` (whoosh SFX, bump animation, projectile
   * arc) but the destination is a cell, not a Combatant — so the
   * projectile lands at the cursor and the cell is ignited. Any
   * combatant currently standing on the cell takes the first damage
   * tick via `igniteCell → applyFireDamageOnEntry`.
   *
   * One-pass with the spell-tile path on `consumeThrowItem` — the
   * item was already drained on entry to the picker (matching the
   * legacy throw behavior; the player can't escape-cancel to get
   * their torch back).
   */
  private async resolveThrowTile(): Promise<void> {
    const action = this.pendingAction;
    if (!action || action.kind !== "throw-tile") return;
    const me = this.combat.current;
    const item = action.item;
    const target = { ...this.tileCursorPos };
    this.busy = true;
    this.mode = "default";
    this.pendingAction = null;
    this.clearTileCursor();
    this.clearPicker();
    this.clearMoveHints();
    try {
      // Throw whoosh + visible projectile arc from caster → target cell.
      Sfx.play("chirp");
      await this.animateBump(me, me.position, target);
      const start = this.bodyXY(me);
      const endPx = {
        x: this.tileX(target.col),
        y: this.tileY(target.row),
      };
      await projectileLine(this, start, endPx, VFX_COLOURS.ember, 240);
      this.combat.log.push(
        `${me.name} hurls ${item.name} at (${target.col}, ${target.row}).`,
      );
      // Ignite the landing cell. Drops a fire light source, a fire
      // particle emitter, and stamps the cell into fireCells so any
      // combatant who steps onto it takes fire damage. Anyone already
      // standing there gets the first tick immediately.
      this.igniteCell(
        target.col,
        target.row,
        item.light_range ?? 3,
        item.power ?? 3,
      );
      this.combat.log.push(
        `The ${item.name} catches the ground at (${target.col}, ${target.row}) on fire.`,
      );
      this.combat.movePoints = 0;
      this.refreshAll();
      if (this.combat.isOver) return this.endEncounter();
      this.endActorTurn();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Fireball-style AOE: every alive creature within `radius` Chebyshev
   * tiles of the chosen cell takes the spell's dice damage. Includes
   * party members caught in the blast — friendly fire is real, aim
   * the cursor away from your front line.
   */
  private async resolveAoeFireball(
    caster: Combatant, spell: Spell, centre: { col: number; row: number },
  ): Promise<void> {
    const ev = spell.effect_value ?? {};
    const radius = typeof (ev as Record<string, unknown>).radius === "number"
      ? (ev as { radius: number }).radius
      : 3;
    const victims = this.combat.combatants.filter(
      (c) => c.hp > 0 &&
             Math.max(
               Math.abs(c.position.col - centre.col),
               Math.abs(c.position.row - centre.row),
             ) <= radius
    );
    // Aim the animation's projectile at the centre tile (visual key
    // is fire_projectile for fireball_burst). When the spell carries
    // a non-projectile or "none" animation the flight is skipped —
    // the AOE detonation below still plays as it's the mechanic's
    // intrinsic feedback, not the spell's "look".
    const burstAt = { x: this.tileX(centre.col), y: this.tileY(centre.row) };
    const casterAt = {
      x: this.tileX(caster.position.col),
      y: this.tileY(caster.position.row),
    };
    const animation = getAnimationById(spell.animation_id);
    const animVisual = (animation?.visual ?? "").trim();
    if (animVisual && animVisual !== "none") {
      const fn = resolveProjectileEffect({ effect_type: animVisual });
      await fn(this, casterAt, burstAt);
    }
    if (animation?.hit_sfx) Sfx.play(animation.hit_sfx);
    // AOE detonation — fixed feedback for any tile-target damage
    // spell. Not animation-driven because it's tied to the AOE
    // mechanic, not the spell's chosen visual.
    screenShake(this, 0.008, 240);
    void radialBurst(this, burstAt, VFX_COLOURS.fire, VFX_COLOURS.ember, 64);
    if (victims.length === 0) {
      this.combat.log.push(
        `${caster.name} casts ${spell.name} at (${centre.col},${centre.row}) — caught nothing.`
      );
      return;
    }
    let total = 0;
    let allies = 0;
    for (const v of victims) {
      const r = resolveDamageSpell(caster, v, spell, defaultRng);
      total += r.damage;
      if (v.side === caster.side) allies += 1;
      this.refreshHp(v);
      void this.animateHit(v, r);
    }
    const enemies = victims.length - allies;
    const parts = [`${enemies} foe${enemies === 1 ? "" : "s"}`];
    if (allies > 0) parts.push(`${allies} all${allies === 1 ? "y" : "ies"} (FRIENDLY FIRE)`);
    this.combat.log.push(
      `${caster.name} casts ${spell.name} — ${parts.join(", ")} hit, ${total} dmg total.`
    );
  }

  /**
   * Misty Step / similar — relocate the caster to the chosen tile.
   * Refuses if the tile is a wall or already occupied.
   */
  private async resolveTeleport(
    caster: Combatant, spell: Spell, dest: { col: number; row: number },
  ): Promise<void> {
    if (isWall(dest.col, dest.row)) {
      this.combat.log.push(`${caster.name} can't teleport into a wall.`);
      return;
    }
    if (this.combat.combatantAt(dest.col, dest.row)) {
      this.combat.log.push(`${caster.name} can't teleport onto another combatant.`);
      return;
    }
    caster.position = { ...dest };
    // Snap the sprite + selection ring to the new tile, with a fade
    // out / fade in pair so the relocation reads visually. The
    // depart and arrive visuals are both pulled from the spell's
    // animation — same visual fired twice at different points.
    const body = this.bodies.get(caster.id);
    const ring = this.selRings.get(caster.id);
    const x = this.tileX(dest.col);
    const y = this.tileY(dest.row);
    const animation = getAnimationById(spell.animation_id);
    const animVisual = (animation?.visual ?? "").trim();
    const playBurstAt = (point: { x: number; y: number }) => {
      if (!animVisual || animVisual === "none") return;
      const fn = resolveProjectileEffect({ effect_type: animVisual });
      void fn(this, point, point);
    };
    if (body) {
      playBurstAt({ x: body.x, y: body.y });
      await new Promise<void>((res) => {
        this.tweens.add({
          targets: body, alpha: 0,
          duration: 140,
          onComplete: () => res(),
        });
      });
      body.x = x; body.y = y;
      if (ring) { ring.x = x; ring.y = y; }
      playBurstAt({ x, y });
      await new Promise<void>((res) => {
        this.tweens.add({
          targets: body, alpha: 1,
          duration: 140,
          onComplete: () => res(),
        });
      });
    } else if (ring) {
      ring.x = x; ring.y = y;
    }
    this.combat.log.push(
      `${caster.name} casts ${spell.name} — vanishes and reappears at (${dest.col},${dest.row}).`
    );
  }

  /**
   * Animate Dead — raise a skeleton ally on the chosen tile that fights
   * for the party for `spell.duration` turns, then crumbles to dust.
   *
   * Refuses if the destination is a wall or already occupied. The new
   * combatant is built via `makeSummonedSkeleton` (reads stats out of
   * `effect_value`), then handed to `combat.addCombatant` which seeds
   * its initiative slot and tracks the summon timer. The scene
   * separately wires up its body sprite + selection ring so the right
   * HUD and the arena pick the new actor up immediately.
   */
  private async resolveSummonSkeleton(
    caster: Combatant, spell: Spell, dest: { col: number; row: number },
  ): Promise<void> {
    if (isWall(dest.col, dest.row)) {
      this.combat.log.push(`${caster.name} can't raise the dead in a wall.`);
      return;
    }
    if (this.combat.combatantAt(dest.col, dest.row)) {
      this.combat.log.push(`${caster.name} can't summon onto another combatant.`);
      return;
    }
    const id = `summon-${caster.id}-${this.combat.combatants.length}`;
    const skeleton = makeSummonedSkeleton(spell, id, caster.name);
    const turns = typeof spell.duration === "number" ? spell.duration : 5;
    this.combat.addCombatant(skeleton, dest, turns);

    // Build the matching scene visuals: selection ring + body sprite
    // at the destination tile so the new combatant slots into the
    // arena immediately. Mirrors the loop in drawCombatants() so the
    // entry behaves like one that was there from create().
    const x = this.tileX(dest.col);
    const y = this.tileY(dest.row);
    const ring = this.add
      .rectangle(x, y, TILE, TILE, C.cursor, 0)
      .setStrokeStyle(2, C.cursor)
      .setVisible(false);
    this.selRings.set(id, ring);
    let body: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
    if (skeleton.sprite && this.textures.exists(skeleton.sprite)) {
      body = this.add.image(x, y, skeleton.sprite);
    } else if (skeleton.sprite) {
      // Sprite is declared (via the spell's `creature.sprite`) but
      // wasn't part of the preload pass — summon-spell creature art
      // doesn't live in the monster catalog, so the texture cache
      // doesn't have it yet. Mount a placeholder rectangle, kick off
      // a lazy load, and swap it for the real image once Phaser
      // finishes fetching. Without this, the body stays as a tan
      // square because the original render only checked `exists()`
      // and silently fell back.
      const colorHex = Phaser.Display.Color.GetColor(...skeleton.color);
      body = this.add
        .rectangle(x, y, TILE - 4, TILE - 4, colorHex)
        .setStrokeStyle(2, 0x0a0a14);
      const url = skeleton.sprite;
      this.load.image(url, url);
      this.load.once(`filecomplete-image-${url}`, () => {
        // Combat may have ended (or this summon may have been
        // destroyed) by the time the image lands. Bail if the body's
        // gone or the destroyed Phaser objects would throw.
        const current = this.bodies.get(id);
        if (!current || current !== body) return;
        const sprite = this.add.image(x, y, url).setDepth(body.depth);
        body.destroy();
        this.bodies.set(id, sprite);
      });
      this.load.start();
    } else {
      const colorHex = Phaser.Display.Color.GetColor(...skeleton.color);
      body = this.add
        .rectangle(x, y, TILE - 4, TILE - 4, colorHex)
        .setStrokeStyle(2, 0x0a0a14);
    }
    this.bodies.set(id, body);

    // "Claws its way out of the ground" VFX — runs the spell's
    // animation visual at the spawn tile, then scales the body up so
    // the entry reads as a summoning rather than a warp-in.
    const animation = getAnimationById(spell.animation_id);
    const animVisual = (animation?.visual ?? "").trim();
    if (animVisual && animVisual !== "none") {
      const fn = resolveProjectileEffect({ effect_type: animVisual });
      void fn(this, { x, y }, { x, y });
    }
    body.setScale(0.2);
    this.tweens.add({
      targets: body, scale: 1,
      duration: 320, ease: "Back.Out",
    });

    this.combat.log.push(
      `${caster.name} casts ${spell.name}!`
    );
    this.combat.log.push(
      `A skeleton claws its way out of the ground! (${turns} turns)`
    );
  }

  private onTileClicked(col: number, row: number): void {
    if (!this.canTakePlayerInput()) return;
    const actor = this.combat.current;
    const dc = col - actor.position.col;
    const dr = row - actor.position.row;
    if (Math.abs(dc) + Math.abs(dr) !== 1) return;
    let dir: Direction;
    if (dc === 1) dir = "e";
    else if (dc === -1) dir = "w";
    else if (dr === 1) dir = "s";
    else dir = "n";
    void this.tryPlayerStep(dir);
  }

  private onEndTurnClicked(): void {
    if (!this.canTakePlayerInput()) return;
    this.combat.log.push(`${this.combat.current.name} ends their turn.`);
    this.endActorTurn();
  }

  private canTakePlayerInput(): boolean {
    // Player input is only valid when the active actor is a real
    // party member, not an AI-controlled summon on the party side,
    // and not currently swallowed by a consume effect (their slot
    // auto-resolves into the STR-save tick instead).
    return !this.busy && !this.ended &&
           this.combat.current.side === "party" &&
           !isAiControlled(this.combat.current) &&
           !this.combat.current.consumed;
  }

  // ── Turn flow ────────────────────────────────────────────────────

  private async tryPlayerStep(dir: Direction): Promise<void> {
    if (!this.canTakePlayerInput()) return;
    this.busy = true;
    try {
      const actor = this.combat.current;
      const before = { ...actor.position };
      const result = this.combat.tryMove(dir);
      if (result.kind === "moved") {
        await this.animateMove(actor, before, result.to);
        // Step-onto-fire damage. `applyFireDamageOnEntry` no-ops on
        // non-fire cells and self-gates repeat damage per turn via
        // `fireDamagedThisTurn`, so calling it after every move is
        // safe and cheap.
        this.applyFireDamageOnEntry(result.to.col, result.to.row);
      } else if (result.kind === "attacked") {
        const target = this.combat.byId(result.result.targetId);
        const struckCell = { ...target.position };
        await this.animateBump(actor, before, target.position);
        // Themed melee relic burst fires AT the impact moment — right
        // after the lunge, concurrently with the hit/death animation —
        // so the fire / ice / meteor detonation reads on contact rather
        // than after the corpse has faded. Anchored to the struck cell
        // (not the body sprite), so it still plays on a killing blow.
        // Ranged weapons swung as a melee bump don't show it (their
        // elemental effect belongs to the shot), matching the bonus-
        // damage gate.
        if (result.result.hit && !actor.weaponRanged) {
          this.playMeleeWeaponBurst(actor.weaponDamageType ?? "", struckCell);
        }
        await this.animateHit(target, result.result);
        this.refreshHp(target);
        if (result.result.hit) {
          this.applyWeaponDurability(actor.id);
          this.applyArmorDurability(target.id);
        }
        // Shadow Step active — the engine kept the attacker's
        // movement intact after a killing bump. Pulse the thief's
        // body so the player can see WHY they still have moves
        // (otherwise the engine's silent "movePoints preserved"
        // looks like a UI bug). Subtle by design — the user
        // explicitly asked for a small, gradient cue rather than a
        // showy burst.
        if (result.result.shadowStepped) {
          this.startShadowStepPulse(actor.id);
        }
      } else {
        await this.animateBlocked(actor, dir);
      }
      this.refreshAll();
      if (this.combat.isOver) return this.endEncounter();
      if (this.combat.movePoints <= 0) this.endActorTurn();
    } finally {
      this.busy = false;
    }
  }

  private endActorTurn(): void {
    this.clearMoveHints();
    // Shadow Step's pulse ends when the thief's turn does — that's
    // the canonical "ability is no longer active" moment. Restoring
    // the alpha here keeps the cue tightly scoped to the post-kill
    // window the player can actually use it in.
    this.stopShadowStepPulse();
    this.combat.endTurn();
    // Reset the per-turn fire-damage gate so the next combatant can
    // be stung once if they happen to start or end their turn on
    // a fire cell. Cleared here rather than at the start of the next
    // turn so the kickoff path (which calls `applyFireDamageOnEntry`
    // on the new actor's standing cell) sees an empty set.
    this.fireDamagedThisTurn.clear();
    // Anyone who STARTS the turn on a fire cell takes a hit before
    // they can move. Mirrors the "stepped onto" case. If that hit
    // kills them, keep advancing past them — without this we'd
    // hand the dead actor off to kickOffCurrentTurn, which routes
    // AI-controlled enemies into runMonsterTurn and the loop would
    // try to attack from a dead actor. Bounded by combatants.length
    // because endTurn itself bails when isOver is true.
    while (true) {
      const cur = this.combat?.current;
      if (!cur || cur.hp <= 0) break;
      this.applyFireDamageOnEntry(cur.position.col, cur.position.row);
      if (cur.hp > 0) break;
      // Fire just killed the actor whose turn we were about to start.
      // Advance again. If the encounter ends as a result, the post-
      // loop isOver check below handles it.
      this.combat.endTurn();
      this.fireDamagedThisTurn.clear();
      if (this.combat.isOver) break;
    }
    this.refreshAll();
    this.flashConsumeEvents();
    if (this.combat.isOver) return this.endEncounter();
    this.kickOffCurrentTurn();
  }

  /**
   * Drain any consume events the engine queued and surface them on
   * screen. Three coordinated jobs:
   *
   *   - On `applied` — float "SWALLOWED!" at the victim's last cell,
   *     then hide the body + HP bar (they're inside the consumer now).
   *   - On `tick` — float "-N" over the consumer's body so the player
   *     sees the per-turn damage even though the victim is invisible.
   *   - On `saved` — show the body again at its new arena cell and
   *     float "ESCAPED!".
   */
  private flashConsumeEvents(): void {
    const events = this.combat.popConsumeEvents();
    for (const ev of events) {
      const target = this.combat.byId(ev.targetId);
      const body = this.bodies.get(target.id);
      const ring = this.selRings.get(target.id);
      if (!body) continue;
      if (ev.kind === "applied") {
        // Float the banner first, THEN hide. Otherwise the floater
        // anchors to (0,0) since the body's been moved off-board.
        this.floatLabel(body.x, body.y - 16, "SWALLOWED!", "#ff6b6b");
        body.setVisible(false);
        if (ring) ring.setVisible(false);
        const bar = this.monsterHpBars.get(target.id);
        if (bar) { bar.bg.setVisible(false); bar.bar.setVisible(false); }
      } else if (ev.kind === "tick" && ev.damage > 0) {
        // Victim is invisible — float the damage on their consumer
        // so the player can see whose belly the HP is leaving.
        const consumer = target.consumed
          ? this.bodies.get(target.consumed.consumerId)
          : null;
        const x = consumer?.x ?? 480;
        const y = consumer?.y ?? 360;
        this.floatLabel(x, y - 12, `${target.name} -${ev.damage}`, "#ff6b6b");
      } else if (ev.kind === "saved") {
        // The engine has already updated the position. Snap the body
        // sprite to the new tile and re-show.
        body.x = this.tileX(target.position.col);
        body.y = this.tileY(target.position.row);
        if (ring) {
          ring.x = body.x;
          ring.y = body.y;
        }
        body.setVisible(true);
        const bar = this.monsterHpBars.get(target.id);
        if (bar) { bar.bg.setVisible(true); bar.bar.setVisible(true); }
        const label = target.hp > 0 ? "ESCAPED!" : "RECOVERED";
        this.floatLabel(body.x, body.y - 16, label, "#7be2a8");
      } else if (ev.kind === "released") {
        // Consumer died with the victim still inside — engine has
        // already placed them on a free tile.
        body.x = this.tileX(target.position.col);
        body.y = this.tileY(target.position.row);
        if (ring) { ring.x = body.x; ring.y = body.y; }
        body.setVisible(true);
        this.floatLabel(body.x, body.y - 16, "FREE!", "#7be2a8");
      }
    }
  }

  /** Tiny floating-label helper used by the consume hooks (the existing
   *  hit-flash inside `animateHit` is similar but tightly coupled to
   *  AttackResult). Tweens up + fades for ~700ms. */
  private floatLabel(x: number, y: number, text: string, color: string): void {
    const t = this.add.text(x, y, text, {
      fontFamily: "Georgia, serif",
      fontSize: "14px",
      color,
      stroke: "#1a1a2e",
      strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(50);
    this.tweens.add({
      targets: t,
      y: t.y - 24, alpha: 0,
      duration: 700,
      onComplete: () => t.destroy(),
    });
  }

  private async runMonsterTurn(): Promise<void> {
    try {
      while (
        !this.combat.isOver &&
        isAiControlled(this.combat.current) &&
        this.combat.movePoints > 0
      ) {
        const intent = this.combat.decideMonsterIntent();
        if (intent.kind === "wait") break;
        if (intent.kind === "attack") {
          const attackerId = this.combat.current.id;
          const result = this.combat.attack(intent.targetId);
          this.combat.movePoints = 0;
          const target = this.combat.byId(result.targetId);
          await this.animateBump(this.combat.current, this.combat.current.position, target.position);
          await this.animateHit(target, result);
          this.refreshHp(target);
          if (result.hit) {
            // attacker is enemy → applyWeaponDurability is a no-op; the
            // call still runs so charmed/summoned attackers wear their
            // weapons too. Target may be a party member — armor wear.
            this.applyWeaponDurability(attackerId);
            this.applyArmorDurability(target.id);
          }
          this.refreshLog();
          break;
        }
        if (intent.kind === "spell") {
          // Cast a monster spell — Dragon's Fire Breath, Lich's Fireball,
          // Troll's Self Heal, etc. Resolves the math + state mutation,
          // animates a hit/heal flash on the target, ends the turn.
          //
          // Per-spell VFX branch: look up the spell from the actor's
          // table by index BEFORE resolving, so the scene knows what
          // animation to play. Today only `breath_fire` has its own
          // cone effect — every other spell continues to fall back
          // to the generic `animateHit` flash. The look-up is
          // tolerant of out-of-range indices (defensive against
          // mid-tick mutation) and missing tables (charmed party
          // members invoking the spell branch).
          const caster = this.combat.current;
          const spellDef =
            caster.monsterSpells?.[intent.spellIndex] ?? null;
          const result = this.combat.castMonsterSpell(intent.spellIndex, intent.targetId);
          this.combat.movePoints = 0;
          const target = this.combat.byId(result.targetId);
          if (spellDef?.type === "breath_fire") {
            // Dragon-style breath weapon — cone of fire from the
            // caster's mouth to the target. Telegraph with a brief
            // fire glow on the caster, then play the cone, then a
            // sharp screen shake to sell the impact. Awaiting the
            // breath ensures the HP flash from animateHit lands
            // AFTER the flames arrive, not on top of them.
            this.castGlowFor(caster, VFX_COLOURS.fire);
            await breathOfFire(
              this,
              this.bodyXY(caster),
              this.bodyXY(target),
            );
            screenShake(this, 0.007, 220);
          }
          await this.animateHit(target, {
            attackerId: this.combat.current.id, targetId: target.id,
            hit: result.damage > 0 || result.heal > 0,
            roll: 0, total: 0, critical: false,
            damage: result.damage, killed: result.killed,
          });
          this.refreshHp(target);
          this.refreshLog();
          break;
        }
        const actor = this.combat.current;
        const before = { ...actor.position };
        const moveResult = this.combat.tryMove(intent.dir);
        if (moveResult.kind === "moved") {
          await this.animateMove(actor, before, moveResult.to);
          // AI takes fire damage on entry too — same predicate the
          // player path uses, same per-turn gate.
          this.applyFireDamageOnEntry(moveResult.to.col, moveResult.to.row);
          // If walking onto a fire (thrown torch, lit cell) just
          // killed the active monster, bail out of the AI loop
          // immediately. Without this break, the next iteration
          // would call decideMonsterIntent on a dead actor and the
          // attack path would throw "Attacker is down" — the
          // engine's defensive guard catches it but we'd rather
          // not even get there.
          if (this.combat.current.hp <= 0) break;
        } else if (moveResult.kind === "attacked") {
          const target = this.combat.byId(moveResult.result.targetId);
          await this.animateBump(actor, before, target.position);
          await this.animateHit(target, moveResult.result);
          this.refreshHp(target);
          if (moveResult.result.hit) {
            this.applyWeaponDurability(actor.id);
            this.applyArmorDurability(target.id);
          }
          this.refreshLog();
          break;
        } else {
          break;
        }
        this.refreshLog();
      }
    } finally {
      this.busy = false;
    }
    if (this.combat.isOver) return this.endEncounter();
    this.endActorTurn();
  }

  // ── Animations (unchanged from the previous build) ───────────────

  private animateMove(
    actor: Combatant,
    from: { col: number; row: number },
    to: { col: number; row: number }
  ): Promise<void> {
    void from;
    return new Promise((resolve) => {
      const body = this.bodies.get(actor.id)!;
      const ring = this.selRings.get(actor.id)!;
      this.tweens.add({
        targets: [body, ring],
        x: this.tileX(to.col),
        y: this.tileY(to.row),
        duration: 110,
        onUpdate: () => this.syncMonsterBar(actor.id),
        onComplete: () => {
          this.syncMonsterBar(actor.id);
          resolve();
        },
      });
    });
  }

  // ── VFX shortcuts ────────────────────────────────────────────────
  //
  // Thin wrappers that look up the actor's body sprite for screen
  // coordinates and call into web/src/game/combat/Vfx.ts. Keeping the
  // coordinate math here lets the Vfx module stay scene-agnostic.

  private bodyXY(c: Combatant): { x: number; y: number } {
    const body = this.bodies.get(c.id);
    if (body) return { x: body.x, y: body.y };
    return { x: this.tileX(c.position.col), y: this.tileY(c.position.row) };
  }

  /** Pick a thematic VFX colour for a given spell effect_type. */
  private colorForSpell(effect: string): number {
    if (effect === "heal" || effect === "major_heal" || effect === "mass_heal" ||
        effect === "cure_poison" || effect === "restore") return VFX_COLOURS.heal;
    if (effect === "bless" || effect === "ac_buff" || effect === "range_buff" ||
        effect === "invisibility") return VFX_COLOURS.buff;
    if (effect === "curse") return VFX_COLOURS.curse;
    if (effect === "aoe_fireball") return VFX_COLOURS.fire;
    if (effect === "lightning_bolt") return VFX_COLOURS.lightning;
    if (effect === "undead_damage") return VFX_COLOURS.buff;
    if (effect === "teleport") return VFX_COLOURS.arcane;
    return VFX_COLOURS.arcane;
  }

  /** Caster glow used at the start of every cast. */
  private castGlowFor(c: Combatant, color: number): void {
    const body = this.bodies.get(c.id);
    if (body) castGlow(this, body, color);
  }

  /** Fly a projectile arc from `from` → `to` in screen coords. */
  private flyProjectile(from: Combatant, to: Combatant, color: number): Promise<void> {
    return projectileLine(this, this.bodyXY(from), this.bodyXY(to), color, 240);
  }

  /** Coloured aura ring around a target — buff/debuff status visual. */
  private auraOn(c: Combatant, color: number): Promise<void> {
    return glowAura(this, this.bodyXY(c), color);
  }

  /** Start the persistent wielder-aura pulse for `combatantId` —
   *  a fresh `glowAura` ring fired every ~700ms beneath the body
   *  sprite, in the supplied colour. Triggered for any combatant
   *  whose equipped weapon declares a `combat_aura.color` (today
   *  just the Sun Sword). Stored in `wieldAuras` keyed by id so
   *  scene teardown / mid-fight gear swaps can stop it cleanly.
   *
   *  Per-pulse gates:
   *   - Skip when `bodies.get(id)` is gone (mid-teardown race).
   *   - Skip when the combatant is fallen (hp <= 0). The timer
   *     keeps running so a raise-dead promotes the character back
   *     into the visual without re-wiring the timer.
   *
   *  Each pulse fires the existing `glowAura` helper (Vfx.ts) at
   *  the body's *current* position, so the aura tracks the wielder
   *  across the arena without per-frame coordinate sync. The 700ms
   *  cadence is tuned to overlap previous rings just enough that
   *  the halo reads continuous rather than blinky. */
  private startWielderAura(combatantId: string, color: number): void {
    // Defensive: clear any prior timer for this id so a re-seed
    // from `drawCombatants` doesn't double the pulse rate.
    const prior = this.wieldAuras.get(combatantId);
    if (prior) prior.remove();

    const PULSE_MS = 700;
    const tick = () => {
      const body = this.bodies.get(combatantId);
      if (!body) return;
      const c = this.combat?.combatants.find((x) => x.id === combatantId);
      if (!c || c.hp <= 0) return;
      // `bodyXY` already falls back to tile coordinates when the
      // sprite is missing, but we use body.x/y here directly so the
      // aura reads off the live (possibly-mid-tween) position
      // rather than the actor's logical cell.
      glowAura(this, { x: body.x, y: body.y }, color).catch(() => undefined);
    };

    // Fire one immediately so the first pulse lands the moment the
    // combatant appears — without it the player would wait the full
    // PULSE_MS before seeing any aura at combat-start.
    tick();
    const timer = this.time.addEvent({
      delay: PULSE_MS,
      loop: true,
      callback: tick,
    });
    this.wieldAuras.set(combatantId, timer);
  }

  /** Reconcile the live aura timer with the combatant's current
   *  `wieldAuraColor` — fired after any mid-combat gear swap. Three
   *  cases:
   *   - aura color set + no live timer → start one.
   *   - aura color absent + live timer → stop + remove the entry.
   *   - both set / both absent → no-op (the existing timer keeps
   *     pulsing in the current colour, which is fine even when the
   *     player re-equipped a different aura-bearing weapon of the
   *     same colour). */
  private syncWielderAura(c: Combatant): void {
    const live = this.wieldAuras.get(c.id) ?? null;
    const color = c.wieldAuraColor;
    if (typeof color === "number") {
      if (!live) this.startWielderAura(c.id, color);
      // A colour CHANGE doesn't restart the timer today — restarting
      // mid-fight would look like a hitch. If we ship multiple
      // aura-bearing weapons whose colours differ wildly, this is
      // where to add a colour-diff check; for now Sun Sword is the
      // only one and the policy is "first equip wins."
    } else if (live) {
      live.remove();
      this.wieldAuras.delete(c.id);
    }
  }

  /** Start a soft alpha pulse on the named combatant's body sprite —
   *  the in-shadow-step visual cue the user asked for. Subtle by
   *  design: alpha dips to 0.55 and back over ~360ms, yoyo'd, so
   *  the thief reads as "phased / not quite here" without
   *  overshadowing the regular bump-attack animations.
   *
   *  Idempotent on the timer side: a second call replaces any
   *  prior pulse so a thief who keeps stepping through enemies
   *  doesn't end up with stacked tweens fighting for the alpha.
   *  Stops automatically on `stopShadowStepPulse` (called from
   *  `endActorTurn` and `init()`'s cleanup pass). */
  private startShadowStepPulse(combatantId: string): void {
    const body = this.bodies.get(combatantId);
    if (!body) return;
    this.stopShadowStepPulse();
    this.shadowStepPulseId = combatantId;
    this.shadowStepPulse = this.tweens.add({
      targets: body,
      alpha: 0.55,
      duration: 360,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    // One-shot trigger cue — without this, the steady pulse alone
    // is too quiet for the player to register the *moment* the
    // ability fires (the user reported witnessing Backstab but not
    // Shadow Step). A small violet "SHADOW STEP!" floater over the
    // thief + a quick arcane burst gives the same "the ability just
    // fired" beat that BACKSTAB! gets over the target, while leaving
    // the ongoing pulse to communicate "still active." Same colour
    // family as Backstab so the two thief abilities read as siblings.
    const t = this.add
      .text(body.x, body.y - 18, "SHADOW STEP!", {
        fontFamily: "Georgia, serif",
        fontSize: "14px",
        color: "#c28bff", // arcane violet — same as the Backstab label
        stroke: "#1a1a2e",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1);
    this.tweens.add({
      targets: t,
      y: t.y - 26,
      alpha: 0,
      duration: 700,
      onComplete: () => t.destroy(),
    });
    radialBurst(
      this,
      { x: body.x, y: body.y },
      VFX_COLOURS.curse,
      VFX_COLOURS.arcane,
      36,
    ).catch(() => undefined);
    // SFX gives the ability an audible kick so the moment lands even
    // when the player is looking at the log strip — borrows the
    // critical-hit fanfare since Shadow Step is a peer-tier moment to
    // a backstab crit.
    Sfx.play("critical");
  }

  /** Tear down any active shadow-step pulse and restore the body's
   *  alpha to 1. Looked-up-by-id so the cleanup is safe even when
   *  the bodies map has been rebuilt mid-pulse (e.g. drawCombatants
   *  fired a refresh). Called from `endActorTurn` (the canonical
   *  end-of-shadow-step beat) and from `init()` so a re-entered
   *  combat doesn't inherit a stray tween. */
  private stopShadowStepPulse(): void {
    if (this.shadowStepPulse) {
      this.shadowStepPulse.stop();
      this.shadowStepPulse = null;
    }
    if (this.shadowStepPulseId) {
      const body = this.bodies.get(this.shadowStepPulseId);
      if (body) body.setAlpha(1);
      this.shadowStepPulseId = null;
    }
  }

  /** Healing sparkle column rising over a target. */
  private healTargetVfx(c: Combatant): Promise<void> {
    return healingSparkles(this, this.bodyXY(c));
  }

  /**
   * Refresh sprite alpha for every combatant based on their state:
   *
   *   - Active "Invisibility" buff → 0.2 (caster is visually faded
   *     out for the spell's full duration; a thin silhouette remains
   *     so the player can still tell where their hero is on the
   *     grid). Returns to 1.0 the moment the buff expires.
   *   - HP <= 0 → 0.4 (existing dim state for downed combatants).
   *   - Otherwise → 1.0.
   *
   * Called from refreshAll so cast / endTurn / animations all keep
   * the visuals in sync without per-call wiring.
   */
  private refreshVisibility(): void {
    for (const c of this.combat.combatants) {
      const body = this.bodies.get(c.id);
      if (!body) continue;
      let alpha = 1;
      if (c.hp <= 0) alpha = 0.4;
      else if (this.combat.hasBuffFromSource(c.id, "Invisibility")) alpha = 0.2;
      // Skip if a tween is in flight on this body so we don't
      // stomp the brief hit-flash yoyo.
      const tweens = this.tweens.getTweensOf(body);
      if (tweens.length > 0) continue;
      body.alpha = alpha;
    }
  }

  private animateBump(
    actor: Combatant,
    from: { col: number; row: number },
    target: { col: number; row: number }
  ): Promise<void> {
    return new Promise((resolve) => {
      const body = this.bodies.get(actor.id)!;
      const ring = this.selRings.get(actor.id)!;
      const startX = this.tileX(from.col);
      const startY = this.tileY(from.row);
      const targetX = this.tileX(target.col);
      const targetY = this.tileY(target.row);
      const midX = startX + (targetX - startX) * 0.4;
      const midY = startY + (targetY - startY) * 0.4;
      this.tweens.add({
        targets: [body, ring],
        x: midX, y: midY,
        duration: 90, yoyo: true,
        onUpdate: () => this.syncMonsterBar(actor.id),
        onComplete: () => {
          this.syncMonsterBar(actor.id);
          resolve();
        },
      });
    });
  }

  private animateBlocked(actor: Combatant, dir: Direction): Promise<void> {
    return new Promise((resolve) => {
      const body = this.bodies.get(actor.id)!;
      const ring = this.selRings.get(actor.id)!;
      const dx = dir === "e" ? 4 : dir === "w" ? -4 : 0;
      const dy = dir === "s" ? 4 : dir === "n" ? -4 : 0;
      this.tweens.add({
        targets: [body, ring],
        x: body.x + dx, y: body.y + dy,
        duration: 50, yoyo: true,
        onUpdate: () => this.syncMonsterBar(actor.id),
        onComplete: () => resolve(),
      });
    });
  }

  private animateHit(target: Combatant, result: AttackResult): Promise<void> {
    return new Promise((resolve) => {
      const body = this.bodies.get(target.id);
      if (!body) return resolve();
      // Backstab gets dedicated flair so the player can tell it
      // apart from a routine crit: "BACKSTAB! -N" in violet, a
      // matching violet flash, and a small dark-purple burst over
      // the victim. The critical SFX + screen shake still fire from
      // the regular crit branch below (backstab implies critical),
      // so the punch lands without a second SFX layered on top.
      const isBackstab = !!result.backstab;
      // Smite Undead is a Paladin passive that doubled the rolled
      // damage. Treated as a sibling of Backstab for visual
      // language — same "ability fired" feedback family, just in a
      // different palette (gold/buff) to read as holy rather than
      // sneaky. The flag is mutually exclusive with backstab in
      // practice (Paladin vs Thief) but if both were ever set the
      // backstab branch wins below — keeps the violet stinger
      // dedicated to the Thief.
      const isSmite = !!result.smiteUndead;
      // Distinct attempt-but-missed branch — the Thief's DEX save
      // came up short. We surface a separate "no opening" floater
      // over the ATTACKER so the player sees the ability was tried
      // (otherwise a failed save is invisible — the user reported
      // confusion about whether Backstab was wired at all). The
      // target still gets the regular non-crit hit feedback below.
      const isBackstabMiss =
        !!result.backstabAttempted && !isBackstab;
      const label = result.hit
        ? isBackstab
          ? `BACKSTAB! -${result.damage}`
          : isSmite
            ? `SMITE! -${result.damage}`
            : result.critical
              ? `CRIT! -${result.damage}`
              : `-${result.damage}`
        : "miss";
      const color = result.hit
        ? isBackstab
          ? "#c28bff" // arcane violet — reads as sneaky / shadowy
          : isSmite
            ? "#ffe580" // bright holy gold — reads as divine wrath
            : result.critical
              ? "#ffd470"
              : "#ff6b6b"
        : "#bdb38a";
      // SFX + flash. Critical hits play the louder fanfare and shake
      // the camera; misses get the rising "whoosh"; ordinary hits use
      // the side-appropriate hurt SFX so the player can hear who took it.
      if (result.hit) {
        // Smite hits ride the same critical-tier SFX + shake as a
        // nat-20 crit even when the underlying d20 wasn't a crit —
        // the doubled damage IS the moment, so audio should match.
        if (result.critical || isSmite) {
          Sfx.play("critical");
          screenShake(this, 0.006, 220);
        } else {
          Sfx.play(target.side === "party" ? "player_hurt" : "monster_hit");
        }
        // Backstab swaps the blood-red flash for the curse-violet
        // tone + adds a small radial burst — the visual cue the
        // player needs to recognise the ability fired. A dedicated
        // crit (nat-20 with no backstab) keeps the existing
        // blood-flash so the two read as distinct events even when
        // the math is similar.
        if (isBackstab) {
          flashTarget(this, body, VFX_COLOURS.curse);
          radialBurst(
            this,
            { x: body.x, y: body.y },
            VFX_COLOURS.curse,
            VFX_COLOURS.arcane,
            42,
          ).catch(() => undefined);
        } else if (isSmite) {
          // Holy flash + gold burst — the Paladin's divine wrath cue.
          // Same shape as the Backstab branch (flash + burst) but
          // in the buff/holy palette so the ability reads as a
          // sibling rather than a copy. The crit SFX above already
          // fired because Smite implies an attention-worthy hit;
          // we don't layer a second SFX so the moment stays clean.
          flashTarget(this, body, VFX_COLOURS.buff);
          radialBurst(
            this,
            { x: body.x, y: body.y },
            VFX_COLOURS.buff,
            VFX_COLOURS.buff,
            44,
          ).catch(() => undefined);
        } else {
          flashTarget(this, body, VFX_COLOURS.blood);
        }
      } else {
        Sfx.play("miss");
        floatingX(this, { x: body.x, y: body.y });
      }
      // BACKSTAB / SMITE success labels are larger and bolder than
      // a routine crit / miss so the player can read them instantly
      // across the arena. Same palette/flash family so each pairs
      // visually as one event.
      const isAbilityLabel = isBackstab || isSmite;
      const labelFontSize = isAbilityLabel ? "17px" : "14px";
      const t = this.add.text(body.x, body.y - 12, label, {
        fontFamily: "Georgia, serif",
        fontSize: labelFontSize,
        color,
        stroke: "#1a1a2e",
        strokeThickness: isAbilityLabel ? 5 : 4,
      }).setOrigin(0.5, 1);
      this.tweens.add({
        targets: t,
        y: t.y - 22, alpha: 0,
        duration: 600,
        onComplete: () => { t.destroy(); resolve(); },
      });
      // Backstab attempt-but-missed cue: a muted violet "no opening"
      // floater over the ATTACKER (not the target) — drifts up + fades
      // alongside the normal hit feedback. Anchored to the attacker so
      // the player can tell which actor's ability rolled the save, and
      // doesn't double-stack on the same coords as the damage label.
      if (isBackstabMiss) {
        const attackerBody = this.bodies.get(result.attackerId);
        if (attackerBody) {
          const noTxt = this.add
            .text(attackerBody.x, attackerBody.y - 14, "no opening", {
              fontFamily: "Georgia, serif",
              fontSize: "11px",
              color: "#8a78b8", // muted dusk-violet — fits the
                                 // ability's colour family, dim
                                 // enough to read as a non-event
              stroke: "#1a1a2e",
              strokeThickness: 3,
            })
            .setOrigin(0.5, 1);
          this.tweens.add({
            targets: noTxt,
            y: noTxt.y - 18,
            alpha: 0,
            duration: 700,
            onComplete: () => noTxt.destroy(),
          });
        }
      }
      if (result.hit) {
        this.tweens.add({
          targets: body, alpha: 0.3,
          duration: 80, yoyo: true, repeat: 1,
        });
        // Party-member death — the critical "your fighter just dropped"
        // beat. The hit-flash above covers the moment of damage;
        // here we layer the death sequence on top so the player
        // can't miss it: a slumping body sprite, a red radial
        // burst, a heavier camera shake, a centre-arena "X HAS
        // FALLEN!" banner, and the defeat fanfare. Enemy deaths
        // already get the "defeated!" suffix in the log and don't
        // need the extra ceremony.
        if (result.killed && target.side === "party") {
          // Defer one tick so the hit-flash yoyo doesn't fight the
          // slump tween for control of the sprite's alpha.
          this.time.delayedCall(120, () => {
            void partyDeathSlump(this, body);
            partyDeathBanner(
              this,
              { x: ARENA_X, y: ARENA_Y, width: ARENA_W, height: ARENA_H },
              target.name,
            );
            Sfx.play("defeat");
          });
        }
      }
    });
  }

  // ── HUD refresh ──────────────────────────────────────────────────

  private refreshAll(): void {
    this.refreshTurnHeader();
    this.refreshActionMenu();
    this.refreshLog();
    for (const x of this.combat.combatants) this.refreshHp(x);
    this.highlightActiveActor();
    this.drawActionHints();
    this.refreshVisibility();
    // The party self-light pool follows the active party member, so
    // every full refresh (turn change, move, summon, refresh after
    // damage) re-bakes the darkness overlay. Cheap — Graphics.clear
    // + ~280 fillRect calls per repaint, batched into one display
    // list entry.
    this.refreshDarkness();
  }

  private refreshTurnHeader(): void {
    const c = this.combat.current;
    if (c.consumed) {
      // Consumed combatants don't take a turn — the engine
      // auto-rolls their STR save during this slot. Tell the player
      // why nothing's happening (and why the action menu is dim).
      this.turnText.setText(`-- ${c.name.toUpperCase()} IS SWALLOWED --`);
      this.movePointsText.setText("(rolling escape save…)");
      return;
    }
    this.turnText.setText(`-- ${c.name.toUpperCase()}'S TURN --`);
    this.movePointsText.setText(
      `Moves: ${this.combat.movePoints}/${c.baseMoveRange}`
    );
  }

  /** Single source of truth for "which action rows should be
   *  visible right now." Read by `refreshActionMenu` (drives what
   *  gets rendered) AND by `moveActionCursor` (so arrow keys cycle
   *  through the same set the player sees) — keeping the logic in
   *  one place is what prevents drift bugs like the one where
   *  Abilities was rendered-hidden but the cursor could still land
   *  on it.
   *
   *  When it's not the player's turn the list collapses to empty;
   *  the action menu hides entirely until control returns. */
  private computeVisibleActions(): ActionEntry[] {
    // Player can act only on real party members, not on AI summons
    // that share the party side.
    // A consumed party member doesn't get a player turn — their
    // initiative slot is replaced by the engine's STR-save tick.
    // During an AI / consumed turn nothing is selectable, so we
    // collapse the menu to empty.
    const playerTurn =
      this.combat.current.side === "party" &&
      !isAiControlled(this.combat.current) &&
      !this.combat.current.consumed;
    if (!playerTurn) return [];
    const member = this.memberForCurrent();
    // Per-action enable state — dynamic based on the active member.
    const canThrow = !!member && this.partyHasThrowable();
    const canCast =
      !!member &&
      member.max_mp > 0 &&
      this.spells.some(
        (s) =>
          spellIsCombatCastable(s, this.classTemplates.get(member.class.toLowerCase()) ?? null) &&
          member.level >= minLevelFor(s, member.class) &&
          (member.mp) >= s.mp_cost
      );
    // Range is enabled when the equipped weapon has ranged: true AND
    // the party still has matching ammo to fire. A bow with no
    // arrows hides the Range row (per the user's design) so the
    // player isn't tricked into picking an option that'd just fizzle
    // — they fall back to melee with the offhand weapon, which the
    // turn-start hook auto-swapped into the right hand.
    const equippedWeapon =
      member && member.equipped.hands
        ? this.items.get(member.equipped.hands) ?? null
        : null;
    const ammoOk = (() => {
      if (!equippedWeapon || !isRanged(equippedWeapon)) return false;
      // Built-in-ammo ranged weapons (e.g. Rock — no `ammo` field)
      // never need a quiver: the weapon IS the projectile.
      if (!equippedWeapon.ammo) return true;
      const partyData = gameState.partyData;
      if (!partyData) return false;
      // Use compatibleAmmoIds (not partyHasAmmo on the primary
      // alone) so a bow with only Fire Arrows in stash still
      // enables the Range row — otherwise the player would see
      // their Fire Arrows in the inventory but get no way to
      // shoot them after the regular arrows ran out.
      return compatibleAmmoIds(equippedWeapon, partyData).length > 0;
    })();
    const canRange = !!equippedWeapon && isRanged(equippedWeapon) && ammoOk;
    const canUse = !!member && this.partyHasCombatUsable();
    const canEquip = !!member && this.memberHasEquippableItem(member);
    // The Abilities row enables whenever the active member has at
    // least one combat-active class/race ability — today that's
    // Cleric L2+ / Paladin L5+ via Turn Undead. The picker re-runs
    // the same filter at open time so a level-up mid-fight is
    // surfaced on the very next refresh.
    const canAbility = !!member && this.memberHasCombatAbility();
    const isEnabled = (id: ActionId): boolean => {
      if (id === "range")   return canRange;
      if (id === "throw")   return canThrow;
      if (id === "cast")    return canCast;
      if (id === "ability") return canAbility;
      if (id === "use")     return canUse;
      if (id === "equip")   return canEquip;
      // Attack + End are always selectable during a player turn —
      // Attack lets the player see "no adjacent enemy" feedback in
      // the log; End is the no-op the player needs when nothing
      // else applies.
      return true;
    };
    return PARTY_ACTIONS.filter((a) => isEnabled(a.id));
  }

  private refreshActionMenu(): void {
    // Build the visible subset — only enabled rows survive (so the
    // menu naturally collapses to "Attack + End" for a fresh
    // Fighter with no adjacent foes, or to nothing during a monster
    // turn). Rendered top-down, with blank rows below the cluster
    // to keep the reserved layout space available without showing
    // anything. Stored on the scene so the pointerdown handlers
    // (bound at create() to fixed row indices) can map row N back
    // to the action currently drawn at that row.
    this.visibleActions = this.computeVisibleActions();
    // Snap the action cursor to the nearest enabled action when its
    // current target just got filtered out (e.g. it sat on Cast and
    // the caster ran out of MP). Without this the next ENTER press
    // would activate an off-screen row, or worse, no row at all.
    // Falls back to 0 (Attack) when the visible list is empty —
    // benign because `activateAction` gates on player turn anyway.
    if (
      this.visibleActions.length > 0 &&
      !this.visibleActions.some((a) => PARTY_ACTIONS.indexOf(a) === this.actionCursor)
    ) {
      this.actionCursor = PARTY_ACTIONS.indexOf(this.visibleActions[0]);
    }
    for (let i = 0; i < PARTY_ACTIONS.length; i++) {
      const text = this.actionTexts[i];
      const handle = this.actionRowHandles[i];
      const action = this.visibleActions[i];
      if (!action) {
        // No backing action at this row — blank it out. Empty text +
        // zero-alpha fill + no interactivity so a stray pointer
        // can't activate it.
        text.setText("");
        handle.setFillStyle(C.selectBg, 0);
        handle.disableInteractive();
        continue;
      }
      // Re-enable interaction every refresh so a row that was just
      // hidden (and had its hit-box dropped) wakes up cleanly when
      // the conditions that disabled it reverse mid-fight.
      handle.setInteractive({ useHandCursor: true });
      // Cursor highlight — `actionCursor` is still an index into
      // PARTY_ACTIONS, so the visible row "owns" the cursor when its
      // PARTY_ACTIONS index matches.
      const cursor = PARTY_ACTIONS.indexOf(action) === this.actionCursor;
      text.setColor(hex(C.body));
      const prefix = cursor ? "> " : "  ";
      text.setText(`${prefix}${action.label}`);
      handle.setFillStyle(C.selectBg, cursor ? 1 : 0);
    }
  }

  /** True when active member or shared stash has at least one item
   *  the items catalog flags as throwable / ranged. */
  private partyHasThrowable(): boolean {
    const member = this.memberForCurrent();
    const party = gameState.partyData;
    const check = (name: string) => {
      const def = this.items.get(name);
      return !!def && isThrowable(def);
    };
    if (member && member.inventory.some((it) => check(it.item))) return true;
    if (party && party.inventory.some((it) => check(it.item))) return true;
    return false;
  }

  /**
   * True when the active member or shared stash holds at least one
   * combat-usable consumable (potion, herb, antidote, throwable
   * poison, fire oil). Drives the Use Item row's enable state — the
   * row is greyed out when there's nothing to drink so the player
   * isn't tempted to open an empty picker.
   */
  private partyHasCombatUsable(): boolean {
    const member = this.memberForCurrent();
    const party = gameState.partyData;
    const check = (name: string) => {
      const def = this.items.get(name);
      return !!def && isCombatUsable(def);
    };
    if (member && member.inventory.some((it) => check(it.item))) return true;
    if (party && party.inventory.some((it) => check(it.item))) return true;
    return false;
  }

  /**
   * True when this member has at least one item in their PERSONAL
   * inventory whose catalog entry resolves to a UI-supported equip
   * slot. Drives the Equip Item row's enable state — combat-time
   * equip is deliberately limited to personal inventory (the shared
   * stash is back at the wagon, not on the fighter's belt). Items
   * whose only slots are unsupported (head/etc.) are filtered out by
   * `equippableSlots` so they don't read as equippable here.
   */
  private memberHasEquippableItem(member: PartyMember): boolean {
    return member.inventory.some((it) => {
      const def = this.items.get(it.item);
      return !!def && equippableSlots(def).length > 0;
    });
  }

  private refreshHp(c: Combatant): void {
    if (c.side === "party") {
      const card = this.partyCards.get(c.id);
      if (card) {
        const pct = Math.max(0, c.hp / Math.max(1, c.maxHp));
        card.hpBar.width = Math.max(0, card.fullBarW * pct);
        card.hpBar.setFillStyle(pct <= 0.3 ? C.hpLow : C.hpFull, 1);
        card.hpText.setText(`${c.hp}/${c.maxHp}`);
        // Casters: re-read MP from the live PartyMember and resize bar.
        if (card.mpBar && card.mpText) {
          const member = this.memberByCombatantId(c.id);
          if (member && member.max_mp > 0) {
            const mpPct = Math.max(0, (member.mp) / Math.max(1, member.max_mp));
            card.mpBar.width = Math.max(0, card.fullBarW * mpPct);
            card.mpText.setText(`${member.mp}/${member.max_mp}`);
          }
        }
      }
    }
    if (c.side === "enemies") {
      // Update the floating HP bar above the monster sprite. Hidden
      // entirely once the creature drops to 0 HP so the corpse doesn't
      // keep advertising a full bar.
      const bars = this.monsterHpBars.get(c.id);
      if (bars) {
        const pct = Math.max(0, c.hp / Math.max(1, c.maxHp));
        bars.bar.width = Math.max(0, bars.fullW * pct);
        bars.bar.setFillStyle(pct <= 0.3 ? C.hpLow : C.hpFull, 1);
        if (c.hp <= 0) {
          bars.bg.setVisible(false);
          bars.bar.setVisible(false);
        }
      }
    }
    if (c.hp <= 0) {
      const body = this.bodies.get(c.id);
      if (body instanceof Phaser.GameObjects.Image) body.setTint(0x444466).setAlpha(0.4);
      else if (body) body.setFillStyle(0x2a2a3a).setStrokeStyle(1, 0x444466);
      this.selRings.get(c.id)?.setVisible(false);
    } else {
      // HP is back above zero — undo any dead-body tint/alpha that the
      // branch above might have applied earlier in the encounter.
      // Without this restore, a character freed alive from a Man Eater's
      // belly (or revived via Heal / Raise Dead) keeps the dim
      // 0x444466 + alpha 0.4 cast forever, reading on the arena as a
      // "dark box" instead of their sprite. Rectangle bodies (the
      // colour-fallback fighters with no sprite loaded) get their
      // original `c.color` fill and the regular 2px frame back.
      const body = this.bodies.get(c.id);
      if (body instanceof Phaser.GameObjects.Image) {
        body.clearTint();
        body.setAlpha(1);
      } else if (body) {
        const colorHex = Phaser.Display.Color.GetColor(...c.color);
        body.setFillStyle(colorHex).setStrokeStyle(2, 0x0a0a14);
      }
    }
  }

  /** Re-sync a monster's floating HP bar to its body's current x/y.
   *  Called from move / bump tween onUpdate so the bar tracks the
   *  sprite mid-animation. */
  private syncMonsterBar(actorId: string): void {
    const bars = this.monsterHpBars.get(actorId);
    const body = this.bodies.get(actorId);
    if (!bars || !body) return;
    bars.bg.x = body.x;
    bars.bg.y = body.y - bars.offsetY;
    bars.bar.x = body.x - bars.fullW / 2;
    bars.bar.y = body.y - bars.offsetY;
  }

  private refreshLog(): void {
    // Show the last seven lines so the dice/mod detail and the
    // turn announcements don't push the encounter banner off the
    // top in the first round.
    this.logText.setText(this.combat.log.slice(-7).join("\n"));
  }

  private highlightActiveActor(): void {
    const activeId = this.combat.current.id;
    for (const c of this.combat.combatants) {
      const ring = this.selRings.get(c.id);
      if (!ring) continue;
      ring.setVisible(c.id === activeId && c.hp > 0);
    }
  }

  /**
   * Draw the reach overlay for the active party member. The set of
   * cells changes with the current sub-mode:
   *
   *   - default               → BFS-expanded movement diamond (every
   *                              cell reachable in `movePoints` cardinal
   *                              steps, blocked by walls / unwalkable
   *                              cells / allies, with enemy cells
   *                              included as bump-attack landings)
   *   - pick-target + range   → all enemies' tiles within the
   *                              weapon's range with clear LOS
   *   - pick-target + cast    → spell range cells, LOS-filtered for
   *                              projectile spells
   *   - pick-direction        → the four cardinal lines a directional
   *                              weapon / spell would fly along,
   *                              clipped at the first obstruction
   *
   * Movement hints use the cool moveHint blue; reach hints use the
   * warm rangeHint gold so the two contexts read distinctly. AI turns
   * skip hints entirely — the overlay is a player-facing affordance.
   *
   * Important: this MUST stay safe to call while `this.busy` is true.
   * tryPlayerStep flips busy on for the duration of the move
   * animation and calls refreshAll() inside the try block — if we
   * bailed on busy, hints would be cleared during the animation and
   * never get repainted before the next input arrived. The overlay
   * just sits behind the animating sprite anyway, so painting it
   * immediately is fine.
   */
  private drawActionHints(): void {
    this.clearMoveHints();
    if (this.combat.current.side !== "party") return;
    const me = this.combat.current.position;
    const pending = this.pendingAction;

    let cells: { col: number; row: number }[] = [];
    // Widen to number so the gold-vs-blue reassignments below don't
    // get pinned to the literal type of the first assigned constant.
    let color: number = C.moveHint;

    if (this.mode === "default") {
      cells = this.movementReachCells(me, this.combat.movePoints);
    } else if (this.mode === "pick-target" && pending?.kind === "range") {
      cells = this.targetReachCells(me, maxRangeFor(pending.weapon), true);
      color = C.rangeHint;
    } else if (this.mode === "pick-target" && pending?.kind === "throw") {
      // Throw range gating lives in `currentTargetList`: targets
      // outside the item's `range` or behind cover never become
      // selectable. This overlay paints the same circle so the
      // player can see exactly which cells a thrown Rock / Dagger /
      // Fire Oil can reach before they pick a target.
      cells = this.targetReachCells(me, maxRangeFor(pending.item), true);
      color = C.rangeHint;
    } else if (this.mode === "pick-target" && pending?.kind === "cast") {
      // Spell range: honour the spell's `range` field with a sensible
      // fallback. LOS gating mirrors the picker's filter — projectile
      // spells need a clear line, heals / buffs reach through cover.
      const spell = pending.spell;
      const range = typeof spell.range === "number" && spell.range > 0 ? spell.range : 6;
      const e = spell.effect_type;
      const projectile =
        e === "damage" ||
        e === "undead_damage" ||
        e === "lightning_bolt" ||
        e === "aoe_fireball";
      cells = this.targetReachCells(me, range, projectile);
      color = C.rangeHint;
    } else if (this.mode === "pick-direction" && pending?.kind === "direction") {
      const spell = pending.spell;
      const range = typeof spell.range === "number" && spell.range > 0 ? spell.range : 6;
      cells = this.directionalReachCells(me, range);
      color = C.rangeHint;
    } else if (this.mode === "pick-direction" && pending?.kind === "range-direction") {
      cells = this.directionalReachCells(me, maxRangeFor(pending.weapon));
      color = C.rangeHint;
    } else if (this.mode === "pick-tile" && pending?.kind === "throw-tile") {
      // Throw-tile: the legal landing zone is every open arena cell
      // within Chebyshev `range` of the caster. Unlike target-pick
      // mode this DOESN'T require LOS and DOESN'T require visibility —
      // the player throws a torch into shadow exactly so the shadow
      // lifts.
      cells = this.throwTileReachCells(me, maxRangeFor(pending.item));
      color = C.rangeHint;
    } else if (this.mode === "pick-tile" && pending?.kind === "range-tile") {
      // Range-tile: same any-open-cell rule the throw-tile picker
      // uses, but the range comes from the bow. Fire arrows
      // explicitly target the dark, so no LOS / visibility gate —
      // the player shoots into shadow to see what's there.
      cells = this.throwTileReachCells(me, maxRangeFor(pending.weapon));
      color = C.rangeHint;
    } else {
      // Other sub-modes (pick-throw, pick-use, pick-equip, pick-spell,
      // pick-tile for spells) own their own overlays / pickers. Clear
      // hints and bail — leaving a stale move diamond on the arena
      // while a picker popover is open would be visually noisy.
      return;
    }

    // Lift pick-tile hints above the darkness overlay (depth 20).
    // Without this the gold reach grid gets swallowed by the shadow
    // layer in night fights — exactly the situation a throw-torch
    // reach overlay needs to be visible in.
    const hintDepth =
      this.mode === "pick-tile" &&
      (pending?.kind === "throw-tile" || pending?.kind === "range-tile")
        ? 22
        : 0;
    for (const c of cells) {
      const hint = this.add
        .rectangle(this.tileX(c.col), this.tileY(c.row), TILE - 6, TILE - 6, color, 0.30)
        .setStrokeStyle(1, color)
        .setDepth(hintDepth);
      this.moveHintRects.push(hint);
    }
  }

  /**
   * Cardinal-line "cross" reach from `start`, with each arm running
   * up to `budget` cells. Each arm stops at the first blocker in its
   * line — wall, unwalkable cell, ally, or enemy (the enemy cell IS
   * highlighted as a valid bump-attack landing, but the line doesn't
   * pass through them). The cross shrinks naturally as `budget`
   * decreases because each step the player takes draws one fewer
   * cell per arm.
   *
   * Why a cross and not a BFS diamond: combat movement is one
   * cardinal step per move-point. Reaching a diagonal cell costs two
   * move-points and requires a turn into the second direction — but
   * the player can't pre-commit to that turn, they can only see
   * "where would the next step go?" The cross matches the single
   * cardinal commit cleanly; a diamond overlay implied you could
   * also reach the corners, which is misleading when you can only
   * step in one direction at a time.
   */
  private movementReachCells(
    start: { col: number; row: number },
    budget: number,
  ): { col: number; row: number }[] {
    if (budget <= 0) return [];
    const me = this.combat.current;
    const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const out: { col: number; row: number }[] = [];
    for (const [dc, dr] of dirs) {
      let nc = start.col;
      let nr = start.row;
      for (let i = 0; i < budget; i++) {
        nc += dc;
        nr += dr;
        if (isWall(nc, nr)) break;
        const ac = this.arenaCells?.[nr]?.[nc];
        if (ac && ac.walkable === false) break;
        const occupant = this.combat.combatantAt(nc, nr);
        if (occupant && occupant.side === me.side) break;
        out.push({ col: nc, row: nr });
        // Enemy along the arm is a valid bump-attack target — keep
        // the cell highlighted, but the arm stops here.
        if (occupant) break;
      }
    }
    return out;
  }

  /** Every cell within Chebyshev `range` of `start`, optionally
   *  filtered to those with clear line of sight (used by ranged
   *  weapons and projectile-shaped spells). Walls + out-of-bounds
   *  cells are excluded so the overlay doesn't bleed onto the
   *  perimeter ring. Start cell is excluded. */
  private targetReachCells(
    start: { col: number; row: number },
    range: number,
    requireLOS: boolean,
  ): { col: number; row: number }[] {
    if (range <= 0) return [];
    const out: { col: number; row: number }[] = [];
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        if (dc === 0 && dr === 0) continue;
        if (Math.max(Math.abs(dc), Math.abs(dr)) > range) continue;
        const nc = start.col + dc;
        const nr = start.row + dr;
        if (isWall(nc, nr)) continue;
        if (requireLOS && !this.combat.hasLineOfSight(start, { col: nc, row: nr })) {
          continue;
        }
        // Visibility gate — keeps the gold reach overlay in sync with
        // the actual target list under darkness. Off in bright fights
        // (helper short-circuits to true). Only applies to the
        // pick-target callers; directional and tile hints route
        // through `directionalReachCells` which doesn't consult this.
        if (!this.isCellVisibleToParty(nc, nr)) continue;
        out.push({ col: nc, row: nr });
      }
    }
    return out;
  }

  /**
   * Cells the player can throw a tile-targeted item onto from `start`.
   * Used by the throw-tile reach overlay: every non-wall cell within
   * Chebyshev `range`, regardless of LOS or current party visibility.
   * The whole point of throwing a torch is to light up shadow, so
   * filtering against visibility here would defeat the feature.
   */
  private throwTileReachCells(
    start: { col: number; row: number },
    range: number,
  ): { col: number; row: number }[] {
    if (range <= 0) return [];
    const out: { col: number; row: number }[] = [];
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        if (dc === 0 && dr === 0) continue;
        if (Math.max(Math.abs(dc), Math.abs(dr)) > range) continue;
        const nc = start.col + dc;
        const nr = start.row + dr;
        if (isWall(nc, nr)) continue;
        out.push({ col: nc, row: nr });
      }
    }
    return out;
  }

  /** Cells that lie along the four cardinal lines from `start`, out
   *  to `range`. Stops at perimeter walls + obstructing cells (the
   *  same rule the directional ray uses when firing). The line
   *  *includes* the obstructing cell so the player sees exactly
   *  where the bolt would terminate. Start cell is excluded. */
  private directionalReachCells(
    start: { col: number; row: number },
    range: number,
  ): { col: number; row: number }[] {
    if (range <= 0) return [];
    const out: { col: number; row: number }[] = [];
    const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dc, dr] of dirs) {
      let nc = start.col;
      let nr = start.row;
      for (let i = 0; i < range; i++) {
        nc += dc;
        nr += dr;
        if (isWall(nc, nr)) break;
        out.push({ col: nc, row: nr });
        const cell = this.arenaCells?.[nr]?.[nc];
        if (cell?.obstructs === true) break;
        // A creature in line of fire still gets a highlighted cell —
        // it's a legitimate target for the bolt — but the bolt
        // wouldn't pass through them, so stop the line here.
        if (this.combat.combatantAt(nc, nr)) break;
      }
    }
    return out;
  }

  private clearMoveHints(): void {
    for (const r of this.moveHintRects) r.destroy();
    this.moveHintRects.length = 0;
  }

  private endEncounter(): void {
    if (this.ended) return;
    this.ended = true;
    this.clearMoveHints();
    const winner = this.combat.winner;
    if (winner === "party") {
      Sfx.play("victory");
      this.showOverlay("Victory!", "#a3d9a5");
    } else if (winner === "enemies") {
      Sfx.play("defeat");
      this.showOverlay("Defeat…", "#ff6b6b");
    }
    if (!this.fromWorld) return;

    if (winner === "party" && this.triggerKey) {
      gameState.consumedTriggers.add(this.triggerKey);
    }
    if (winner === "party") {
      // Spawn-tile boss fight: mark the tile as destroyed so the
      // overworld will rewrite it to grass and stop spawning from it.
      if (this.destroySpawnKey) {
        gameState.destroyedSpawns.add(this.destroySpawnKey);
        // Any roamers tied to this destroyed spawn vanish too —
        // their lair is gone.
        gameState.roamingMonsters = gameState.roamingMonsters.filter(
          (m) => m.sourceKey !== this.destroySpawnKey,
        );
      }
      // Roamer engagement: just remove that one entry.
      if (this.roamerId) {
        gameState.roamingMonsters = gameState.roamingMonsters.filter(
          (m) => m.id !== this.roamerId,
        );
      }
      // Dungeon engagement: drop the slain monster from the cached
      // level so re-entering the dungeon doesn't respawn it.
      if (this.dungeonMonsterId && gameState.dungeonPos) {
        const { overworldCol, overworldRow, level } = gameState.dungeonPos;
        const cached = gameState.dungeonCache.get(`${overworldCol},${overworldRow}`);
        const lvl = cached?.[level];
        if (lvl) {
          lvl.monsters = lvl.monsters.filter((m) => m.id !== this.dungeonMonsterId);
        }
      }
      // Interior engagement: same idea for town-interior quest
      // monsters. Re-entering the interior shows the survivors only.
      if (this.interiorMonsterId && this.interiorPath) {
        const list = gameState.interiorMonsters.get(this.interiorPath);
        if (list) {
          // Look up the engagement target before stripping it so we can
          // mark guardian defeats on the QuestState. Without that mark,
          // the spawn pass would re-place the guardian on the very next
          // entry to the building space, putting the player in an
          // endless-encounter loop until they picked up the artifact.
          const engaged = list.find((m) => m.id === this.interiorMonsterId);
          if (engaged?.isGuardian) {
            const qstate = gameState.moduleQuestStates.get(engaged.questName);
            if (qstate) qstate.guardianDefeated[engaged.stepIdx] = true;
          }
          // Authored encounters (fixed-position entries from
          // town.encounters) need their defeat recorded in the run-
          // wide set, otherwise re-entering the floor would re-run
          // `appendAuthoredEncounters`, find the id missing from the
          // freshly-filtered list, and spawn it back — the Citadel 4
          // Troll Den respawn loop. Guardians and quest-step monsters
          // have their own per-step bookkeeping above, so we only
          // touch the authored set here.
          if (engaged && isAuthoredEncounterId(engaged.id)) {
            gameState.defeatedAuthoredEncounters.add(
              authoredDefeatKey(this.interiorPath, engaged.id),
            );
          }
          gameState.interiorMonsters.set(
            this.interiorPath,
            list.filter((m) => m.id !== this.interiorMonsterId),
          );
        }
      }
      // Quest kill credit: stash the names of every defeated enemy
      // so the scene we're returning to (DungeonScene right now)
      // can credit kill steps. Mirrors the Python game's
      // `pending_killed_monsters` list. Names are catalog form —
      // the credit pass does its own variant fuzz to match rosters.
      const slain = this.combat.combatants
        .filter((c) => c.side === "enemies")
        .map((c) => c.name);
      gameState.pendingKilledMonsters = slain;
    }
    if (winner === "enemies") {
      gameState.defeated = true;
    }
    // Carry HP back to the live roster so wounds persist across
    // encounters. Pretty important now that combat reads the real
    // party — without this, every encounter would refresh HP from
    // the (frozen) party.json values.
    if (gameState.partyData) {
      syncCombatHpBack(gameState.partyData, this.combat.combatants);
    }

    // Victory pacing: rewards summary fades in, then the level-up
    // dialog (if any) blocks the exit until the player dismisses it.
    // Defeat just holds the "Defeat…" overlay for a beat.
    if (winner === "party") {
      void this.awardRewardsThenExit();
    } else {
      this.scheduleExit(2000);
    }
  }

  private scheduleExit(delayMs: number): void {
    this.time.delayedCall(delayMs, () => {
      // v2 host path — when `onResolved` was supplied, the React side
      // owns the post-fight transition (unmount Phaser, route to the
      // end screen or back to the world). The scene reports the
      // outcome and steps aside; no fade-out, no scene.start.
      if (this.onResolved) {
        const winner: "party" | "enemies" =
          this.combat.winner === "enemies" ? "enemies" : "party";
        const enemies = this.combat.combatants.filter(
          (c) => c.side === "enemies",
        );
        const xp = enemies.reduce((s, m) => s + (m.xpReward ?? 0), 0);
        const gold = enemies.reduce((s, m) => s + (m.goldReward ?? 0), 0);
        this.onResolved({ winner, xp, gold });
        return;
      }
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once("camerafadeoutcomplete", () => {
        // v1 scene-switching path. Defeat is a special case: the
        // dungeon flow needs to drop the party back on the overworld
        // with `defeated=true` so the overworld's standard "you are
        // wiped" handling runs. Returning into a dungeon scene with
        // a dead party would re-render the dungeon under the defeat
        // overlay, which is not the cue the player expects.
        if (this.combat.winner === "enemies") {
          this.scene.start("OverworldScene");
          return;
        }
        if (this.returnPayload) {
          this.scene.start(this.returnSceneKey, this.returnPayload);
        } else {
          this.scene.start(this.returnSceneKey);
        }
      });
    });
  }

  /**
   * Compute and apply victory rewards, then trigger the post-combat
   * exit. Sums XP + rolled gold from every defeated enemy, hands each
   * to all *alive* party members, and runs the level-up loop per
   * member. If any member levelled, a modal "Level Up!" dialog blocks
   * the exit until the player presses Space / Enter.
   *
   * On top of XP and gold, the party rolls once on the post-combat
   * loot table — a 25% chance to find a piece of mundane gear from
   * the union of the general store / weapon shop / armor shop stock.
   * The drop lands in the shared party inventory (the stash) so any
   * member can grab it from the Party screen. Counter / item data
   * loads lazily; if either fetch fails we silently skip the drop.
   *
   * Class templates are fetched lazily; if the fetch fails we silently
   * skip the level-up step rather than blocking the post-combat
   * transition. XP is still added to the member's `exp` either way.
   */
  private async awardRewardsThenExit(): Promise<void> {
    const enemies = this.combat.combatants.filter((c) => c.side === "enemies");
    const totalXp   = enemies.reduce((s, m) => s + (m.xpReward   ?? 0), 0);
    const totalGold = enemies.reduce((s, m) => s + (m.goldReward ?? 0), 0);
    const party = gameState.partyData;
    const levelUps: LevelUpEvent[] = [];
    let lootDrop: string | null = null;
    if (party) {
      party.gold += totalGold;
      const aliveMembers: PartyMember[] = [];
      for (const c of this.combat.combatants) {
        if (c.side !== "party" || c.hp <= 0) continue;
        const m = party.roster.find((r) => r.name === c.name);
        if (m) aliveMembers.push(m);
      }
      if (totalXp > 0 && aliveMembers.length > 0) {
        const races = await loadRaces().catch(() => null);
        for (const m of aliveMembers) {
          let tpl: ClassTemplate | null = null;
          try { tpl = await loadClass(m.class); } catch { /* skip leveling */ }
          if (!tpl) {
            // Still credit the raw XP so the bar fills next time the
            // class file loads — saves the player some grinding.
            m.exp += totalXp;
            continue;
          }
          const race = races ? races.get(m.race) ?? null : null;
          // Pass the loaded spell catalog so the level-up events can
          // populate `newSpells` for the dialog. Empty when spells
          // haven't loaded — the diff just returns [] and the dialog
          // omits the "New Spells" section.
          levelUps.push(...awardXp(m, totalXp, tpl, race, this.spells));
        }
        // Refresh the HUD so HP/MP bars catch any gains.
        for (const c of this.combat.combatants) this.refreshHp(c);
      }
      // Roll for a post-combat item drop from the shop pool. Loaders
      // are cached so the first encounter pays the fetch cost and
      // subsequent ones are instant; either failure just skips the
      // drop without breaking the exit flow. Stackable items (arrows,
      // potions, herbs, …) merge into an existing stash entry rather
      // than spawning a new row.
      //
      // The catch used to be silent; that hid a class of bugs where a
      // 404 on items.json/counters.json or a parser throw produced
      // "gold but never any loot" indistinguishable from a string of
      // unlucky 25% rolls. Log the failure (and an empty-pool warning
      // from rollLootDrop's pre-check) so a deployed build can be
      // diagnosed from the browser console.
      try {
        const [items, counters] = await Promise.all([
          loadItems(),
          loadCounters(),
        ]);
        lootDrop = rollLootDrop(items, counters);
        if (lootDrop) {
          addToStash(party, lootDrop, items);
        } else if (items.size === 0 || counters.size === 0) {
          console.warn(
            "CombatScene: loot pool unavailable — items.size=",
            items.size,
            "counters.size=",
            counters.size,
          );
        }
      } catch (err) {
        console.warn("CombatScene: loot roll skipped due to error —", err);
      }
    }
    this.showRewardSummary(totalXp, totalGold, lootDrop);
    if (levelUps.length > 0) {
      // Let the rewards panel breathe before stacking the dialog over it.
      await new Promise<void>((r) => this.time.delayedCall(700, () => r()));
      await this.showLevelUpDialog(levelUps);
      this.scheduleExit(0);
    } else {
      this.scheduleExit(1800);
    }
  }

  /** Stack a short reward-summary panel under the "Victory!" overlay
   *  so the player can see XP / gold / loot gained. Level-ups land in
   *  a separate modal — see showLevelUpDialog. */
  private showRewardSummary(xp: number, gold: number, loot: string | null): void {
    const lines: string[] = [];
    if (xp > 0)   lines.push(`+${xp} XP`);
    if (gold > 0) lines.push(`+${gold} gold`);
    if (loot)     lines.push(`Found: ${loot}`);
    if (lines.length === 0) return;
    const text = lines.join("\n");
    const t = this.add.text(
      ARENA_X + ARENA_W / 2,
      ARENA_Y + ARENA_H / 2 + 56,
      text,
      {
        fontFamily: "Georgia, serif",
        fontSize: "18px",
        color: "#ffd470",
        align: "center",
        stroke: "#1a1a2e",
        strokeThickness: 4,
        lineSpacing: 4,
      },
    ).setOrigin(0.5).setDepth(120);
    t.setAlpha(0);
    this.tweens.add({
      targets: t, alpha: 1, duration: 300, delay: 350,
    });
  }

  /**
   * Modal "Level Up!" dialog — walks events one at a time so each
   * level-up gets its own panel with room for the spell + ability
   * unlock sections. Multiple level-ups (a single award can carry a
   * member through several thresholds) queue cleanly: dismissing one
   * advances to the next, then resolves once the queue is empty so
   * the caller can trigger the post-combat fade.
   */
  private async showLevelUpDialog(events: LevelUpEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i++) {
      await this.showSingleLevelUp(events[i], i + 1, events.length);
    }
  }

  /** Render and await dismissal of a single LevelUpEvent. */
  private showSingleLevelUp(
    ev: LevelUpEvent, idx: number, total: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      Sfx.play("level_up");

      // Build the layout top-to-bottom so we can size the panel to the
      // content. Each entry produces one Text object; descriptive
      // lines wrap inside `wrapW` so a long description doesn't
      // overflow the panel.
      const W = 540;
      const padX = 24;
      const wrapW = W - padX * 2;
      type Line =
        | { kind: "header"; text: string }
        | { kind: "headline"; text: string }
        | { kind: "section"; text: string }
        | { kind: "row"; text: string }
        | { kind: "desc"; text: string };
      const lines: Line[] = [];

      lines.push({ kind: "header", text: `${ev.name}  —  Level ${ev.newLevel - 1} → ${ev.newLevel}` });
      lines.push({ kind: "headline", text: ev.mpGain > 0
        ? `+${ev.hpGain} HP    +${ev.mpGain} MP`
        : `+${ev.hpGain} HP` });

      if (ev.newSpells.length > 0) {
        lines.push({ kind: "section", text: "NEW SPELLS" });
        for (const s of ev.newSpells) {
          lines.push({ kind: "row", text: `${s.name}   (${s.mpCost} MP)` });
          if (s.description) lines.push({ kind: "desc", text: s.description });
        }
      }
      if (ev.newAbilities.length > 0) {
        lines.push({ kind: "section", text: "NEW ABILITIES" });
        for (const a of ev.newAbilities) {
          lines.push({ kind: "row", text: a.name });
          if (a.description) lines.push({ kind: "desc", text: a.description });
        }
      }

      // Compute the panel height by summing per-line spacing.
      const SPACING: Record<Line["kind"], number> = {
        header:   34,
        headline: 30,
        section:  28,
        row:      22,
        desc:     20,
      };
      const TITLE_BAND = 56;     // gold "LEVEL UP!" title at the top
      const FOOTER_BAND = 32;    // dismissal hint at the bottom
      const TOP_PAD = 10;
      const BOTTOM_PAD = 12;
      let bodyH = TOP_PAD;
      for (const l of lines) bodyH += SPACING[l.kind];
      bodyH += BOTTOM_PAD;
      const H = TITLE_BAND + bodyH + FOOTER_BAND;
      const X = ARENA_X + (ARENA_W - W) / 2;
      const Y = ARENA_Y + (ARENA_H - H) / 2;

      const objs: Phaser.GameObjects.GameObject[] = [];
      const bg = this.add
        .rectangle(X, Y, W, H, 0x161629, 0.97)
        .setOrigin(0)
        .setDepth(150)
        .setStrokeStyle(3, 0xffd470)
        .setInteractive({ useHandCursor: true });
      objs.push(bg);
      const title = this.add
        .text(X + W / 2, Y + 18, "★  LEVEL UP!  ★", {
          fontFamily: "Georgia, serif",
          fontSize: "26px",
          color: "#ffd470",
          stroke: "#1a1a2e",
          strokeThickness: 4,
        })
        .setOrigin(0.5, 0)
        .setDepth(151);
      objs.push(title);

      // Walk the line list and stamp each text in turn.
      let cy = Y + TITLE_BAND + TOP_PAD;
      for (const l of lines) {
        const style: Partial<Phaser.Types.GameObjects.Text.TextStyle> =
          l.kind === "header"   ? { fontFamily: "Georgia, serif", fontSize: "20px", color: "#f6efd6" } :
          l.kind === "headline" ? { fontFamily: "Georgia, serif", fontSize: "22px", color: "#9be39b" } :
          l.kind === "section"  ? { fontFamily: "Georgia, serif", fontSize: "14px", color: "#ffd470" } :
          l.kind === "row"      ? { fontFamily: "Georgia, serif", fontSize: "16px", color: "#f6efd6" } :
          /* desc */              { fontFamily: "Georgia, serif", fontSize: "13px", color: "#bdb38a", wordWrap: { width: wrapW } };
        objs.push(
          this.add
            .text(X + W / 2, cy, l.text, style)
            .setOrigin(0.5, 0)
            .setDepth(151),
        );
        cy += SPACING[l.kind];
      }

      // Footer: dismissal hint, plus the "(N of M)" counter when
      // there's more than one level-up queued.
      const hint = total > 1
        ? `[ Space / Enter to continue — ${idx} of ${total} ]`
        : "[ Space / Enter to continue ]";
      objs.push(
        this.add
          .text(X + W / 2, Y + H - 24, hint, {
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#bdb38a",
          })
          .setOrigin(0.5, 0)
          .setDepth(151),
      );

      // Sparkle behind the title — gold burst with embers.
      void radialBurst(
        this,
        { x: X + W / 2, y: Y + 30 },
        0xffd470,
        0xffe48a,
        80,
      );
      // Pop-in tween so the dialog lands with a little weight.
      bg.setScale(0.85);
      title.setScale(0.85);
      this.tweens.add({
        targets: [bg, title],
        scale: 1,
        duration: 220,
        ease: "Back.Out",
      });

      const dismiss = (): void => {
        if (kb) {
          kb.off("keydown-SPACE", dismiss);
          kb.off("keydown-ENTER", dismiss);
        }
        bg.off("pointerdown", dismiss);
        for (const o of objs) o.destroy();
        resolve();
      };
      const kb = this.input.keyboard;
      if (kb) {
        kb.on("keydown-SPACE", dismiss);
        kb.on("keydown-ENTER", dismiss);
      }
      bg.on("pointerdown", dismiss);
    });
  }

  private showOverlay(label: string, color: string): void {
    if (this.overlayText) this.overlayText.destroy();
    this.overlayText = this.add
      .text(ARENA_X + ARENA_W / 2, ARENA_Y + ARENA_H / 2, label, {
        fontFamily: "Georgia, serif",
        fontSize: "48px",
        color,
        stroke: "#1a1a2e",
        strokeThickness: 8,
      })
      .setOrigin(0.5);
  }
}
