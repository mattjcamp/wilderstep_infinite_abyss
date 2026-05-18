/**
 * MapSimulation — Phaser-aware controller that drops a Party onto a
 * Phaser scene's tile grid and walks it around.
 *
 * Used today by the map editor's Simulation mode (testing movement,
 * lighting, party effects, tile links without leaving the editor).
 * Designed to be reused by the future /play scene: that scene will
 * mount a similar Phaser canvas, hand us the same SceneBridge, and
 * let us drive the overworld layer through this same object.
 *
 * Boundary contract:
 *   - The pure step / lighting / timer math lives in movement.ts.
 *   - This file owns the *side effects*: holding the active party
 *     sprite, listening for keyboard input, telling the scene to
 *     re-render the lighting layer, and emitting one-of-a-kind
 *     events back to the editor (link traversal, log lines).
 *   - The scene exposes a small bridge (SceneBridge) so we don't
 *     reach into Phaser internals. Either bridge implementation
 *     (editor or /play) wires the same five callbacks.
 */

import {
  cellAt,
  deltaFor,
  directionForKey,
  findSpawn,
  partyLightRange,
  partyLightSource,
  tickPartyTimers,
} from "./movement";
import {
  findLairs,
  findPlacedEncounters,
  roamStep,
  roamerCollidesWithParty,
  trySpawnRoamer,
  type SimPlacedEncounter,
  type SimRoamer,
  type SimSpawn,
  type SpawnCellInfo,
} from "./spawn";
import type {
  Direction,
  Position,
  SimCell,
  SimCharacter,
  SimCharacterClass,
  SimEffect,
  SimEncounterRef,
  SimGrid,
  SimLightSource,
  SimMonsterRef,
  SimParty,
  SimRace,
  SimSpell,
} from "./types";

/** The shape of the bridge a host (editor or game) provides so the
 *  simulation can drive its Phaser canvas. The kernel never reads
 *  Phaser globals directly — every visual change goes through this.
 *  Implementations live alongside the host scene. */
export interface SceneBridge {
  /** Show or move the party sprite to (col, row). Caller is expected
   *  to also handle initial positioning when the sim starts. */
  setPartyAt(col: number, row: number): void;
  /** Hide / remove the party sprite. Called on simulation stop. */
  clearParty(): void;
  /** Set the additional light source the party emits, or null when
   *  the party emits no light. Triggers a relight pass under the
   *  hood — the scene reads its own grid + this party light. */
  setPartyLight(source: SimLightSource | null): void;
  /** Trigger a lighting re-pass. Called whenever the party moves so
   *  the party-light source follows them. The scene already knows
   *  the ambient mode and grid sources — it just needs a nudge. */
  relight(): void;
  /** Optional: register a single keyboard listener the sim owns.
   *  Returns a teardown that removes it. The host can choose to
   *  pipe the keys through Phaser's keyboard manager or attach a
   *  raw window listener — the kernel doesn't care. */
  onKey(handler: (key: string) => void): () => void;
  /** Show / move / hide the boat sprite that follows the party while
   *  they're aboard. `visible=false` hides it (party is on land). The
   *  host also hides the party sprite while the boat is showing — the
   *  party is "inside" the boat, not a sprite next to it. `sprite` is
   *  passed on board (the boat's identity) and omitted on sail. */
  setPartyBoatAt(
    col: number,
    row: number,
    visible: boolean,
    sprite?: string,
  ): void;
  /** Sync the "loose" boats sitting on the world map (cells the party
   *  isn't aboard right now). Each entry carries the boat's sprite so
   *  cells can swap their render texture between boat and water as
   *  boats move around. */
  setBoatPositions(
    positions: ReadonlyArray<{
      col: number;
      row: number;
      sprite: string;
    }>,
  ): void;
  /** Briefly show `text` floating up from the given cell. Used today
   *  when the party steps onto a cell whose `text` field is set — the
   *  log line is still emitted separately, but the floater gives an
   *  in-world tooltip so the player doesn't have to look away from the
   *  map to read what they just discovered. Implementations should
   *  rise + fade over ~1.4s. Optional so the kernel works against a
   *  bridge that hasn't implemented it yet (older /play harness, tests). */
  floatText?(col: number, row: number, text: string): void;
  /** Sync the set of live monster-spawn roamers to the scene. Hosts
   *  render one sprite per entry (size ~ cell, depth above floor
   *  but below the party). Each entry carries the sprite path from
   *  the monsters catalog so the scene knows what to draw. Optional
   *  so a host without a monsters catalog plumbed in still mounts
   *  the sim (the spawn loop just won't be visible). */
  setRoamerPositions?(
    positions: ReadonlyArray<{
      id: string;
      col: number;
      row: number;
      sprite: string;
    }>,
  ): void;
  /** Replace the cell at (col, row) with a different sprite + walkable
   *  flag — used by the destroy-lair path so a defeated Monster Spawn
   *  reverts to plain ground in-session. The sim never persists the
   *  change; the underlying map file is untouched. Optional so hosts
   *  that haven't wired the texture-swap yet still drive the sim. */
  setCellSprite?(
    col: number,
    row: number,
    sprite: string,
    walkable: boolean,
  ): void;
  /** Sync the set of live placed-encounter entities to the scene.
   *  Same shape as `setRoamerPositions` — host renders one sprite
   *  per entry. Drawn at the same depth band as roamers so they
   *  both layer correctly against the party. Optional. */
  setPlacedEncounterPositions?(
    positions: ReadonlyArray<{
      id: string;
      col: number;
      row: number;
      sprite: string;
    }>,
  ): void;
  /** Tell the host which encounter cells should suppress their
   *  static cell overlay this frame. Used by the placed-encounter
   *  subsystem so the painted sprite doesn't double up with the
   *  roaming one (and stays hidden after the encounter is
   *  defeated). Cell keys are `"col,row"`. Optional. */
  setSuppressedEncounterCells?(cells: ReadonlySet<string>): void;
  /** Push the party's current infravision activation flag. The host
   *  scene stores it on the side (typically a per-scene boolean)
   *  and reads it during the next relight to decide whether to
   *  render in-LOS cells as infravision red. Called once at sim
   *  construction (initial state) and again on every
   *  `setInfravisionActive` toggle. Optional — hosts that don't
   *  support infravision rendering just ignore it. */
  setPartyInfravisionActive?(active: boolean): void;
}

/** DC the Pick Lock attempt rolls against. Matches `Lock.ts`
 *  (`PICK_LOCK_DC = 12`); duplicated here so the sim doesn't pull
 *  the battle world layer into its dependency graph. */
const PICK_LOCK_DC = 12;
/** Default DC when the Knock spell record's `action_params.save_dc_base`
 *  is missing. Matches `Lock.ts.KNOCK_DEFAULT_DC`. */
const KNOCK_DEFAULT_DC = 12;

/** D&D-style ability modifier: floor((score - 10) / 2). */
function statModFor(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Pull a named ability score off a SimCharacter, defaulting to 10
 *  (no modifier) when the field is missing — keeps rolls sane on
 *  partially-populated character JSON. */
function readStat(member: SimCharacter, name: string): number {
  switch (name) {
    case "strength":     return member.strength     ?? 10;
    case "dexterity":    return member.dexterity    ?? 10;
    case "intelligence": return member.intelligence ?? 10;
    case "wisdom":       return member.wisdom       ?? 10;
    case "constitution": return member.constitution ?? 10;
    default:             return 10;
  }
}

/** True when an inventory entry's item field names a lockpick under
 *  either the v2 id (`"lockpick"` — from items.json) or the legacy
 *  display name (`"Lockpick"` — still emitted by legacy authored
 *  party JSON before the sync script flattens it). Matching both
 *  keeps the simulator working against either data shape without
 *  the user having to clean up their module first. */
function isLockpickEntry(item: string): boolean {
  return item === "lockpick" || item === "Lockpick";
}

/** Sum every Lockpick entry's charges across the party stash. */
function countLockpicks(party: SimParty): number {
  let total = 0;
  for (const e of party.inventory ?? []) {
    if (isLockpickEntry(e.item)) total += e.charges ?? 1;
  }
  return total;
}

/** Catalog data the sim needs to resolve character → race → effects.
 *  These rarely change during play, so the host loads them once and
 *  hands them in. `characterClasses` is read by the lock-unlock path
 *  to know which classes can cast which spell catalogs; `knockSpell`
 *  is the Knock-spell record (or null when the module doesn't define
 *  one — in which case the Cast Knock row is suppressed). */
export interface SimCatalog {
  characters: ReadonlyArray<SimCharacter>;
  races: ReadonlyArray<SimRace>;
  effects: ReadonlyArray<SimEffect>;
  characterClasses?: ReadonlyArray<SimCharacterClass>;
  knockSpell?: SimSpell | null;
  /** Spawn catalog (spawns.json). Cells carrying a `spawn` id matched
   *  against this map drive the per-step spawn loop + boss-fight
   *  trigger. Empty / omitted = the spawn subsystem stays dormant. */
  spawns?: ReadonlyArray<SimSpawn>;
  /** Monsters catalog. The spawn loop reads names + sprites from
   *  here when resolving a `spawn_monsters` / `boss_monsters` id to
   *  something the host can render. Empty / omitted = roamers spawn
   *  but the host gets blank sprites. */
  monsters?: ReadonlyArray<SimMonsterRef>;
  /** Encounter catalog (encounters.json). Painted encounter cells
   *  match their id against this list to drive the placed-encounter
   *  pursuit loop. Empty / omitted = placed encounters stay static
   *  (no roaming behaviour). */
  encounters?: ReadonlyArray<SimEncounterRef>;
  /** Fallback sprite + tile id the destroy-lair path uses when a
   *  Monster Spawn is defeated. Captured from the module's tile
   *  palette (typically grass). Optional — when missing, the destroy
   *  path still removes the spawn id from the cell but leaves the
   *  original sprite in place. */
  groundTile?: { id: string; sprite: string; walkable: boolean };
}

/** Snapshot of "who can do what" at the moment the party bumps a
 *  locked tile. Built once when the dialog opens so the overlay can
 *  enable / disable rows without re-querying the kernel. */
export interface LockEncounterOptions {
  /** Cell the party bumped. The dialog displays this; the kernel
   *  uses it as the unlock target when an attempt succeeds. */
  pos: Position;
  /** Member who would pick the lock (Thief preferred, else
   *  Ranger ≥ L3). Null when no one in the party qualifies. */
  picker: SimCharacter | null;
  /** Total Lockpick charges across the party stash. 0 disables
   *  the Pick Lock row even when a `picker` exists. */
  lockpickCharges: number;
  /** Member who would cast Knock. Null when none qualifies. */
  knockCaster: SimCharacter | null;
  /** MP cost — `null` when no knock spell is loaded. The row says
   *  "insufficient MP" when the caster exists but is too poor. */
  knockMpCost: number | null;
}

/** Snapshot of the encounter the party just triggered. Three flavours:
 *
 *   - "boss":   party stepped onto a Monster Spawn lair tile. The
 *               fight uses the lair's `boss_monsters`; winning
 *               destroys the lair.
 *   - "roamer": a roamer the lair previously coughed up caught up
 *               with the party. The fight uses just that roamer's
 *               monster id; winning removes the roamer but leaves
 *               the lair alone.
 *   - "placed": a painted encounter cell's roaming entity caught
 *               the party. The fight uses the encounter's full
 *               roster; winning removes the entity for the rest of
 *               the session (no respawn).
 *
 * The overlay reads this and calls `resolveSpawnEncounter` once
 * the player picks an outcome. */
export interface SpawnEncounterOptions {
  kind: "boss" | "roamer" | "placed";
  /** Display name shown in the overlay banner. For boss / roamer
   *  this is the lair name; for placed encounters it's the
   *  encounter name. */
  name: string;
  /** Free-form flavour text below the banner. */
  description?: string;
  /** Cell the encounter sources from. Boss → the lair the party
   *  stepped onto; roamer → the originating lair; placed → the
   *  cell the encounter was painted on. */
  sourcePos: Position;
  /** Roster the fight uses. Boss → `spawn.boss_monsters`; roamer →
   *  `[roamer.monsterId]`; placed → `encounter.monsters`. */
  monsters: ReadonlyArray<string>;
  /** The lair record. Populated for boss / roamer kinds; null for
   *  placed encounters. */
  spawn: SimSpawn | null;
  /** The encounter record. Populated for placed kind; null for
   *  boss / roamer. */
  encounter: SimEncounterRef | null;
  /** Id of the roamer that triggered a "roamer" fight (so resolve
   *  removes the right entry). Null for boss / placed kinds. */
  roamerId: string | null;
  /** Id of the placed encounter entity that triggered a "placed"
   *  fight. Null for boss / roamer kinds. */
  placedEncounterId: string | null;
}

/** Result returned by `attemptPickLock` / `attemptKnock` so the
 *  overlay can show the dice math and the human-friendly outcome
 *  line before closing itself. */
export interface LockAttemptResult {
  kind: "pick" | "knock";
  success: boolean;
  roll: number;
  mod: number;
  total: number;
  dc: number;
  /** Caster name + roll math for the combat log / overlay banner. */
  message: string;
}

/** Events the sim emits back to the host. Hosts decide what to show:
 *  the editor pipes "linked" to a router.push; the play scene will
 *  call its own map loader. */
export type SimEvent =
  | { kind: "moved"; from: Position; to: Position }
  | { kind: "blocked"; pos: Position; direction: Direction; reason: "off_grid" | "blocked" }
  | {
      kind: "linked";
      from: Position;
      to: Position;
      link: { map_id: string; x: number; y: number };
    }
  | { kind: "log"; message: string }
  /** Fired after a successful step onto a cell whose `npc` field is
   *  set. The host opens a dialog overlay; the kernel doesn't render
   *  anything itself. The party stays on the cell — leaving the dialog
   *  is a separate user action. */
  | { kind: "npc_encountered"; npcId: string; pos: Position }
  /** Fired when the party bumps a cell whose `counter` field is set —
   *  an unattended shop / service counter planted on the tile. The
   *  host opens the CounterShopOverlay directly (no NPC dialog in
   *  between). Party stays put, same as the NPC bump model. */
  | { kind: "counter_encountered"; counterId: string; pos: Position }
  /** Fired when the party steps onto a boat tile from land. The
   *  party-boat sprite shown by the host follows the party from this
   *  point on; the boat cell itself no longer renders a "loose" boat
   *  because the boat is under the party. */
  | { kind: "boarded"; pos: Position }
  /** Fired when the party steps off the boat onto walkable land. The
   *  boat stays behind on the last water cell (`boatAt`) — the host
   *  re-renders a loose boat there. */
  | { kind: "disembarked"; pos: Position; boatAt: Position }
  /** Fired when the party bumps a locked cell. The host opens the
   *  Pick Lock / Cast Knock / Leave dialog and drives the next step
   *  by calling `attemptPickLock` / `attemptKnock` / `dismissLock`.
   *  Movement is gated by `overlaysOpenRef` while the dialog is up. */
  | { kind: "lock_encountered"; options: LockEncounterOptions }
  /** Fired after a successful unlock — the host re-renders the cell
   *  (sprite swap if the door art changes) and re-runs the lighting
   *  pass since `obstructs` may have flipped. */
  | { kind: "lock_resolved"; pos: Position; outcome: "picked" | "knocked" | "left" }
  /** Fired when the party stumbles into a spawn-driven fight — either
   *  by stepping onto a Monster Spawn lair (boss fight) or by being
   *  caught by a wandering roamer. Host opens the encounter overlay
   *  and calls `resolveSpawnEncounter` once the player picks an
   *  outcome. Movement is gated through `overlaysOpenRef` until the
   *  resolution lands. */
  | { kind: "spawn_encountered"; options: SpawnEncounterOptions }
  /** Fired after a successful boss fight — the lair has been
   *  destroyed and the cell reverted to plain ground. Host listens
   *  to update the inspector + log, but the cell visual is already
   *  swapped by the kernel via `setCellSprite`. */
  | { kind: "spawn_destroyed"; pos: Position; spawnId: string }
  /** Fired when the party steps onto a cell whose `dungeon` field is
   *  set. The host transitions the simulator into the procedurally-
   *  generated dungeon (Phase B). Movement is paused on the kernel
   *  side until the host either swaps the underlying grid (via a
   *  new `MapSimulation` mount) or dismisses the event. The
   *  `returnPos` carries the cell the party stepped *from* so the
   *  host can drop them back there when they exit the dungeon. */
  | {
      kind: "dungeon_entered";
      dungeonId: string;
      pos: Position;
      returnPos: Position;
    }
  /** Emitted whenever the *visible* simulation state changes — host
   *  uses this to re-render its panel (HP bars, torch countdown, …). */
  | { kind: "state" };

export type SimEventListener = (event: SimEvent) => void;

/** Snapshot of the simulation state the host renders in its UI.
 *  This is what the SimPanel reads — never the live mutable fields. */
export interface SimSnapshot {
  pos: Position;
  party: SimParty;
  activeMembers: ReadonlyArray<SimCharacter>;
  lightRange: number;
  /** Captured at construction so the panel can show class names from
   *  ids without re-fetching the catalog. */
  classNameById: ReadonlyMap<string, string>;
  raceNameById: ReadonlyMap<string, string>;
  /** True iff at least one currently-active roster member's race
   *  grants the `infravision` ability. UI controls gate on this:
   *  no ability holders → the activation button is hidden, since
   *  there's no one in the party who could engage it. */
  partyHasInfravision: boolean;
  /** Live mutation state, exposed so long-lived hosts (dungeon
   *  sessions) can snapshot and write back to their store on each
   *  state event. Sets are exposed as ReadonlySet — the host
   *  should clone before storing if it intends to mutate. */
  unlockedCells: ReadonlySet<string>;
  defeatedEncounters: ReadonlySet<string>;
  destroyedLairs: ReadonlySet<string>;
}

export interface MapSimulationOptions {
  grid: SimGrid;
  party: SimParty;
  catalog: SimCatalog;
  /** Class id → display name lookup. The panel uses this for the
   *  per-member roster line. The kernel itself doesn't consult it. */
  classNameById: ReadonlyMap<string, string>;
  bridge: SceneBridge;
  /** Optional override for where the party spawns. Defaults to
   *  party.start_position. The editor passes this when entering a
   *  map via a link (entryCol/entryRow from the previous map). */
  startAt?: Position;
  /** Pre-populated unlocked-cell set — `"col,row"` keys from a
   *  prior session on this same grid. Used by long-lived hosts
   *  (dungeon sessions) so a door the party picked stays open
   *  after leaving + returning to the floor. Optional; default
   *  empty. */
  initialUnlockedCells?: ReadonlySet<string>;
  /** Pre-populated defeated-encounter set — `"col,row"` source
   *  cells whose placed encounter has already been resolved.
   *  Filters the placed-encounter seed pass so a re-mount of the
   *  same floor doesn't respawn already-killed enemies. Optional;
   *  default empty. */
  initialDefeatedEncounters?: ReadonlySet<string>;
  /** Pre-populated destroyed-lair set — `"col,row"` keys of
   *  Monster Spawn cells that have been cleared in a previous
   *  session. Used by overworld re-mounts so a destroyed lair
   *  stays quiet. Default empty. */
  initialDestroyedLairs?: ReadonlySet<string>;
}

/** The simulation controller. One per active sim session; mounted by
 *  the host when sim mode turns on, destroyed when it turns off. */
export class MapSimulation {
  private readonly bridge: SceneBridge;
  private readonly grid: SimGrid;
  private readonly catalog: SimCatalog;
  private readonly classNameById: ReadonlyMap<string, string>;
  private readonly raceNameById: ReadonlyMap<string, string>;
  private readonly activeMembers: ReadonlyArray<SimCharacter>;
  private readonly listeners = new Set<SimEventListener>();
  private readonly disposeKeyListener: () => void;
  private party: SimParty;
  private pos: Position;
  /** True iff the party is currently aboard a boat. Maintained by
   *  stepInDirection — see board / sail / disembark branches. */
  private onBoat = false;
  /** Sprite key of the boat the party is currently riding. Captured
   *  on board (from the cell's sprite) and used on disembark so the
   *  boat dropped back onto the map keeps its identity — e.g. a
   *  pirate ship doesn't become a frigate after a single round-trip. */
  private currentBoatSprite: string | null = null;
  /** Cells that currently hold a "loose" boat the party isn't aboard.
   *  Seeded at construction from cells flagged `boat: true`. Maps
   *  "col,row" → sprite so each boat carries its own visual when it's
   *  picked up + put down again. */
  private readonly boatPositions = new Map<string, string>();
  /** Cells the party has unlocked during THIS sim run. Looked up
   *  inside `isCellLocked` so the lock encounter doesn't re-fire
   *  every time the party steps near the same door. We keep the
   *  original grid untouched — exiting the simulator returns the
   *  map to its authored state.
   *
   *  Seeded from `MapSimulationOptions.initialUnlockedCells` so a
   *  host (like a long-lived dungeon session) can re-mount the
   *  same floor without forgetting which doors were already
   *  picked. */
  private readonly unlockedCells: Set<string>;
  /** Live lock encounter while the dialog is up. Cleared by
   *  `attemptPickLock` (on success or failure-with-charge-consumed),
   *  `attemptKnock`, or `dismissLock`. */
  private pendingLock: LockEncounterOptions | null = null;
  /** Spawns catalog, keyed by `SimSpawn.id` for fast cell→lair lookup. */
  private readonly spawnCatalog: ReadonlyMap<string, SimSpawn>;
  /** Monsters catalog, keyed by `SimMonsterRef.id` for sprite resolution. */
  private readonly monsterCatalog: ReadonlyMap<string, SimMonsterRef>;
  /** Encounters catalog, keyed by `SimEncounterRef.id` for placed-
   *  encounter resolution. */
  private readonly encounterCatalog: ReadonlyMap<string, SimEncounterRef>;
  /** Live roamers — monsters the spawn loop has dropped onto the map.
   *  Mutated each step. Snapshot to the bridge via setRoamerPositions. */
  private roamers: SimRoamer[] = [];
  /** Live placed-encounter entities — one per painted encounter cell,
   *  seeded at construction. Each entity pursues the party every
   *  step until defeated; victory removes the entity for the
   *  session (the source cell stays empty until the sim ends). */
  private placedEncounters: SimPlacedEncounter[] = [];
  /** Cells where the party has defeated the boss and destroyed the
   *  lair. Looked up in the spawn pass + boss-trigger path so a
   *  destroyed cell never fires again. Seeded from
   *  `MapSimulationOptions.initialDestroyedLairs` so a long-lived
   *  host can re-mount the map without re-spawning a cleared lair. */
  private readonly destroyedLairs: Set<string>;
  /** "col,row" keys of placed-encounter cells whose entity has been
   *  defeated. The cell overlay suppression set folds these in so
   *  the static encounter sprite stays hidden after victory.
   *  Seeded from `MapSimulationOptions.initialDefeatedEncounters`
   *  so the placed-encounter pass at construction skips already-
   *  killed entities. */
  private readonly defeatedEncounters: Set<string>;
  /** In-flight spawn encounter while the overlay is up. Cleared by
   *  `resolveSpawnEncounter`. */
  private pendingSpawn: SpawnEncounterOptions | null = null;
  /** Ground-tile fallback used by the destroy-lair path. */
  private readonly groundTile: SimCatalog["groundTile"];
  private disposed = false;

  constructor(opts: MapSimulationOptions) {
    this.bridge = opts.bridge;
    this.grid = opts.grid;
    this.catalog = opts.catalog;
    this.classNameById = opts.classNameById;
    // Spawn + monster catalogs — indexed by id for the spawn pass.
    // Both default to empty so a module without spawns.json still
    // mounts the sim cleanly (the loop just finds nothing to do).
    this.spawnCatalog = new Map(
      (opts.catalog.spawns ?? []).map((s) => [s.id, s]),
    );
    this.monsterCatalog = new Map(
      (opts.catalog.monsters ?? []).map((m) => [m.id, m]),
    );
    this.encounterCatalog = new Map(
      (opts.catalog.encounters ?? []).map((e) => [e.id, e]),
    );
    this.groundTile = opts.catalog.groundTile;
    // Mutation state — seeded from per-session options so a host
    // remounting the same grid (e.g. dungeon floor revisits)
    // resumes where it left off. Cloned into new Sets so the
    // caller's references stay theirs to mutate.
    this.unlockedCells = new Set(opts.initialUnlockedCells ?? []);
    this.destroyedLairs = new Set(opts.initialDestroyedLairs ?? []);
    this.defeatedEncounters = new Set(opts.initialDefeatedEncounters ?? []);
    // Seed placed-encounter entities. Each painted encounter cell
    // spawns one roaming entity at the cell's coords. They start
    // there and march toward the party every step. Defeated cells
    // (from a prior session) are excluded so the entity doesn't
    // re-spawn after a re-mount.
    this.placedEncounters = findPlacedEncounters(
      opts.grid as unknown as ReadonlyArray<
        ReadonlyArray<SpawnCellInfo | null | undefined>
      >,
      this.encounterCatalog,
      this.defeatedEncounters,
    );
    // Cache race id → name so SimPanel can display "Human" rather than
    // "human" without a lookup helper.
    const raceMap = new Map<string, string>();
    for (const r of opts.catalog.races) raceMap.set(r.id, r.name);
    this.raceNameById = raceMap;
    // Resolve the roster's character ids to their full records.
    // Missing ids drop silently; the panel renders a placeholder row.
    const byId = new Map(opts.catalog.characters.map((c) => [c.id, c]));
    const active: SimCharacter[] = [];
    for (const id of opts.party.roster) {
      const c = byId.get(id);
      if (c) active.push(c);
    }
    this.activeMembers = active;
    // Deep-clone the party so step counters mutate locally without
    // touching the editor's loaded record.
    this.party = JSON.parse(JSON.stringify(opts.party)) as SimParty;
    // Pick a spawn that fits THIS map. The party's start_position is
    // authored against the overworld; many maps (towns, dungeons) are
    // smaller and would land the sprite off-canvas. findSpawn falls
    // back to the nearest walkable cell when the preferred one is
    // out of bounds or non-walkable.
    const preferred: Position = opts.startAt
      ? { col: opts.startAt.col, row: opts.startAt.row }
      : {
          col: this.party.start_position.col,
          row: this.party.start_position.row,
        };
    this.pos = findSpawn(opts.grid, preferred);

    // Seed boat positions from any cell currently flagged boat:true.
    // Each entry remembers the cell's sprite so the boat keeps its
    // identity across pick-up / put-down. If the spawn cell itself is
    // a boat (designer placed the party in mid-river), treat the
    // party as already aboard so the boat sprite renders under them
    // from frame one.
    for (let r = 0; r < opts.grid.length; r++) {
      const row = opts.grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell?.boat) {
          this.boatPositions.set(`${c},${r}`, cell.sprite ?? "");
        }
      }
    }
    const spawnKey = `${this.pos.col},${this.pos.row}`;
    if (this.boatPositions.has(spawnKey)) {
      this.currentBoatSprite =
        this.boatPositions.get(spawnKey) ?? null;
      this.boatPositions.delete(spawnKey);
      this.onBoat = true;
    }

    // Initial scene push — the sprite + light source land in place
    // before the first keypress. Boat overlays land at the same time
    // so the static "moored" boats on the map render from frame one.
    this.bridge.setPartyAt(this.pos.col, this.pos.row);
    this.bridge.setBoatPositions(this.snapshotBoats());
    this.bridge.setPartyBoatAt(
      this.pos.col,
      this.pos.row,
      this.onBoat,
      this.currentBoatSprite ?? undefined,
    );
    this.bridge.setPartyLight(this.computeLightSource());
    this.bridge.relight();
    // Initial roamer push so the host clears any stale sprites from
    // a prior session and the texture cache is primed.
    this.bridge.setRoamerPositions?.([]);
    // Initial placed-encounter push — render entities at their source
    // cells. Suppress the static cell overlays so the painted sprite
    // doesn't double up with the live one.
    this.bridge.setPlacedEncounterPositions?.(this.snapshotPlacedEncounters());
    this.bridge.setSuppressedEncounterCells?.(this.suppressedEncounterCells());
    // Initial infravision push — reflects the party.json field (or
    // the default of `false`). The host stores this and consults
    // it on every relight; subsequent toggles come through
    // `setInfravisionActive` below.
    this.bridge.setPartyInfravisionActive?.(
      this.party.infravision_active === true,
    );

    // Keyboard input. The bridge owns the actual listener registration
    // so the host can scope it however it likes (window vs. canvas vs.
    // Phaser keyboard manager).
    this.disposeKeyListener = this.bridge.onKey((key) => this.onKey(key));
  }

  /** Manually drive a step. Useful for buttons (e.g., a tap-up control
   *  in a mobile build) and for tests.
   *
   *  Classification order (top wins):
   *    1. NPC bump — never lets the party walk through the cell
   *    2. Off-grid — always blocked
   *    3. Boat boarding — on land stepping onto a loose boat
   *    4. Boat sailing — already aboard, stepping onto a water-tagged cell
   *    5. Boat disembark — already aboard, stepping onto walkable land
   *    6. Boat blocked — aboard but target is non-water non-walkable
   *       (mountain in the sea, second boat in the way, …)
   *    7. Normal walking — falls through to step()
   */
  stepInDirection(direction: Direction): void {
    if (this.disposed) return;
    const { dc, dr } = deltaFor(direction);
    const targetCol = this.pos.col + dc;
    const targetRow = this.pos.row + dr;
    const target = cellAt(this.grid, targetCol, targetRow);

    // 1. NPC bump — takes priority over everything else. The party
    //    stays put; the host opens a dialog overlay.
    if (target?.npc) {
      this.emit({
        kind: "npc_encountered",
        npcId: target.npc,
        pos: { col: targetCol, row: targetRow },
      });
      return;
    }

    // 1.5. Counter bump — unattended shop tile. Same "party stops on
    // bump, host opens overlay" pattern as NPC; the shop modal stacks
    // straight away with no NPC dialog in between.
    if (target?.counter) {
      this.emit({
        kind: "counter_encountered",
        counterId: target.counter,
        pos: { col: targetCol, row: targetRow },
      });
      return;
    }

    // 2. Off-grid.
    if (!target) {
      this.emit({
        kind: "blocked",
        pos: { ...this.pos },
        direction,
        reason: "off_grid",
      });
      this.emit({ kind: "log", message: "Edge of the map." });
      return;
    }

    // 2.5. Locked-tile bump — overrides walkable / boat checks so a
    // designer-marked locked door fires the unlock dialog even if the
    // tile's base `walkable` is true. The dialog is host-driven; the
    // kernel just holds the encounter and waits for one of the
    // `attempt*` / `dismissLock` calls to come back in.
    if (this.isCellLocked(targetCol, targetRow)) {
      const options = this.buildLockOptions({ col: targetCol, row: targetRow });
      this.pendingLock = options;
      this.emit({ kind: "lock_encountered", options });
      this.emit({ kind: "log", message: "The door is locked." });
      return;
    }

    const targetKey = `${targetCol},${targetRow}`;
    const targetHasBoat =
      this.boatPositions.has(targetKey) || target.boat === true;
    /** Sprite of the boat at the target cell — first the live boat-
     *  positions map (a boat disembarked here recently), then the
     *  cell's own sprite (untouched boat tile from the palette). */
    const targetBoatSprite =
      this.boatPositions.get(targetKey) ?? target.sprite ?? "";
    const targetIsWater = (target.tag ?? "") === "water";

    // Decide the kind. Boat-aware classification first, then fall
    // through to the normal walking path for the on-land non-boat case.
    type MoveKind =
      | "walk"
      | "board"
      | "sail"
      | "disembark"
      | "blocked-boat"
      | "linked"
      | "blocked";
    // "Locked door is now open" promotion — a cell flagged `locked`
    // typically also carries `walkable: false` (a locked door tile
    // can't be stood on). Once the party successfully picks or
    // knocks the lock, treat the cell as walkable for the rest of
    // the sim run so the door actually opens. Without this the
    // unlock dialog succeeds but the player still bounces off the
    // door with "Something blocks the way" — looks identical to
    // "still locked" from the player's POV.
    const wasUnlocked = this.unlockedCells.has(targetKey);
    const targetWalkable = target.walkable || wasUnlocked;
    let kind: MoveKind;
    if (this.onBoat) {
      if (targetHasBoat) kind = "blocked-boat";
      else if (targetIsWater) kind = "sail";
      else if (targetWalkable) kind = "disembark";
      else kind = "blocked";
    } else {
      if (targetHasBoat) kind = "board";
      else if (!targetWalkable) kind = "blocked";
      else if (target.link && target.link.map_id) kind = "linked";
      else kind = "walk";
    }

    // 6 / blocked branches first — these don't move the party.
    if (kind === "blocked" || kind === "blocked-boat") {
      const message =
        kind === "blocked-boat"
          ? "Another boat is in the way."
          : this.onBoat
            ? "The boat can't go there."
            : "Something blocks the way.";
      this.emit({
        kind: "blocked",
        pos: { ...this.pos },
        direction,
        reason: "blocked",
      });
      this.emit({ kind: "log", message });
      return;
    }

    // Movement commits — same side-effects regardless of move kind.
    const from = { ...this.pos };
    const to: Position = { col: targetCol, row: targetRow };
    // Capture the cell the party is leaving BEFORE updating pos —
    // disembark drops the boat here.
    const leftFrom = { ...this.pos };
    this.pos = to;
    // Step counters tick AFTER movement: a torch with 1 step left
    // lights the tile you step onto, then burns out. Matches v1.
    this.party = { ...this.party, ...tickPartyTimers(this.party) };
    this.bridge.setPartyAt(to.col, to.row);

    // Boat state side-effects.
    if (kind === "board") {
      // Lift the boat off the world map (it's under the party now).
      // The cell's render texture swaps to water on the scene side;
      // we remember the boat's sprite so disembark can put it back.
      this.currentBoatSprite = targetBoatSprite;
      this.boatPositions.delete(targetKey);
      this.onBoat = true;
      this.bridge.setBoatPositions(this.snapshotBoats());
      this.bridge.setPartyBoatAt(to.col, to.row, true, targetBoatSprite);
      this.emit({ kind: "boarded", pos: { ...to } });
      this.emit({ kind: "log", message: "You board the boat." });
    } else if (kind === "sail") {
      // Boat moves with the party — no change to boatPositions or
      // the scene's tracked sprite, just a position update.
      this.bridge.setPartyBoatAt(to.col, to.row, true);
    } else if (kind === "disembark") {
      // Boat stays behind on the cell the party just left. The
      // scene swaps that cell's texture back to the boat sprite.
      const droppedSprite = this.currentBoatSprite ?? "";
      this.boatPositions.set(
        `${leftFrom.col},${leftFrom.row}`,
        droppedSprite,
      );
      this.onBoat = false;
      this.currentBoatSprite = null;
      this.bridge.setBoatPositions(this.snapshotBoats());
      this.bridge.setPartyBoatAt(to.col, to.row, false);
      this.emit({
        kind: "disembarked",
        pos: { ...to },
        boatAt: leftFrom,
      });
      this.emit({
        kind: "log",
        message: "You step ashore. The boat waits behind you.",
      });
    }

    // Lighting re-pass after the party (and any boat) has moved.
    this.bridge.setPartyLight(this.computeLightSource());
    this.bridge.relight();

    // Linked traversal — same emit ordering as the pre-boat version.
    if (kind === "linked" && target.link) {
      this.emit({ kind: "moved", from, to });
      this.emit({
        kind: "linked",
        from,
        to,
        link: target.link,
      });
      this.emit({
        kind: "log",
        message: `Link → ${target.link.map_id}@${target.link.x},${target.link.y}`,
      });
      this.emit({ kind: "state" });
      return;
    }

    this.emit({ kind: "moved", from, to });
    // Surface on-step tile text two ways: in the scrolling sim log
    // (durable, lets the player re-read), AND as an in-world floater
    // over the cell (immediate, ambient — the player doesn't have to
    // look away from the map). The bridge's floatText is optional so
    // hosts that haven't wired the renderer yet still log normally.
    const text = (target as unknown as { text?: string }).text;
    if (text) {
      this.emit({ kind: "log", message: text });
      this.bridge.floatText?.(to.col, to.row, text);
    }

    // ── Dungeon entrance ────────────────────────────────────────────
    // If the cell the party just stepped onto carries a `dungeon`
    // id, fire `dungeon_entered` and short-circuit the rest of the
    // step pipeline (spawns / roamers / placed encounters all
    // pause until the host transitions us). The host swaps in a
    // new MapSimulation for the dungeon's first floor; this
    // instance keeps the overworld grid alive in memory so the
    // host can dispose+remount cleanly when the party exits.
    const dungeonId = this.dungeonIdAt(to);
    if (dungeonId) {
      this.emit({
        kind: "dungeon_entered",
        dungeonId,
        pos: { col: to.col, row: to.row },
        returnPos: { col: from.col, row: from.row },
      });
      this.emit({
        kind: "log",
        message: `You descend into the dungeon.`,
      });
      this.emit({ kind: "state" });
      return;
    }

    // ── Spawn subsystem ─────────────────────────────────────────────
    // Order matters here:
    //   1. Boss trigger — if the cell the party just stepped onto is
    //      a live lair, fire the boss encounter NOW. The spawn loop
    //      and roamer pursuit don't run on a step that opens combat
    //      (matches v1 — the player isn't around to be roamed at).
    //   2. Spawn pass — each lair within the scan window rolls its
    //      own spawn_chance.
    //   3. Roamer pursuit — every roamer steps one cell toward the
    //      party. Roamers that land on the party's cell (or
    //      adjacent) trigger a roamer encounter and the pursuit
    //      stops short for the rest of the step.
    const bossOptions = this.spawnOptionsForLair(to);
    if (bossOptions) {
      this.pendingSpawn = bossOptions;
      this.emit({ kind: "spawn_encountered", options: bossOptions });
      this.emit({
        kind: "log",
        message: `Approach Lair: ${bossOptions.name}`,
      });
      this.emit({ kind: "state" });
      return;
    }

    this.runSpawnPass();
    const roamerOptions = this.advanceRoamersAndCheckCollision();
    if (roamerOptions) {
      this.pendingSpawn = roamerOptions;
      this.emit({ kind: "spawn_encountered", options: roamerOptions });
      this.emit({
        kind: "log",
        message: `A roaming ${this.monsterDisplayName(roamerOptions.monsters[0])} catches up!`,
      });
    }

    // Placed encounters pursue too. Run after roamers so a spawn
    // roamer that's been around longer wins the collision tie-break,
    // but the placed-encounter sprites still update each step. The
    // first one that collides triggers the encounter overlay; if a
    // roamer already triggered this step we still advance the
    // placed entities (so they don't appear frozen behind a paused
    // dialog) but don't open a second overlay.
    const placedOptions = this.advancePlacedEncountersAndCheckCollision();
    if (placedOptions && !this.pendingSpawn) {
      this.pendingSpawn = placedOptions;
      this.emit({ kind: "spawn_encountered", options: placedOptions });
      this.emit({
        kind: "log",
        message: `${placedOptions.name} ambushes the party!`,
      });
    }

    this.bridge.setRoamerPositions?.(this.snapshotRoamers());
    this.bridge.setPlacedEncounterPositions?.(this.snapshotPlacedEncounters());

    this.emit({ kind: "state" });
  }

  /** Move every placed encounter one cardinal step toward the party.
   *  Returns the encounter options for the first entity that lands
   *  Chebyshev-adjacent to the party, or null when nothing collides.
   *  Mirrors `advanceRoamersAndCheckCollision` but reads from
   *  `placedEncounters` and builds the "placed" kind. */
  private advancePlacedEncountersAndCheckCollision():
    | SpawnEncounterOptions
    | null {
    if (this.placedEncounters.length === 0) return null;
    let trigger: SpawnEncounterOptions | null = null;
    const occupied = new Set<string>(
      this.placedEncounters.map((p) => `${p.col},${p.row}`),
    );
    // Roamers already occupy cells; treat them as blocked too so
    // two monster types don't stack on the same tile.
    for (const r of this.roamers) occupied.add(`${r.col},${r.row}`);
    for (const placed of this.placedEncounters) {
      const fromKey = `${placed.col},${placed.row}`;
      occupied.delete(fromKey);
      const next = roamStep(
        { col: placed.col, row: placed.row },
        this.pos,
        (c, r) => {
          const cell = cellAt(this.grid, c, r);
          return cell !== null && cell.walkable;
        },
        (c, r) => occupied.has(`${c},${r}`),
      );
      placed.col = next.col;
      placed.row = next.row;
      occupied.add(`${next.col},${next.row}`);
      if (!trigger && roamerCollidesWithParty(placed, this.pos)) {
        const enc = this.encounterCatalog.get(placed.encounterId);
        if (enc) {
          trigger = {
            kind: "placed",
            name: enc.name,
            description: undefined,
            sourcePos: this.parseKey(placed.sourceKey) ?? {
              col: placed.col,
              row: placed.row,
            },
            monsters: enc.monsters,
            spawn: null,
            encounter: enc,
            roamerId: null,
            placedEncounterId: placed.id,
          };
        }
      }
    }
    return trigger;
  }

  /** Parse a "col,row" key back into a Position. Returns null when
   *  either coord doesn't fit. Used by placed-encounter resolution
   *  to recover the source cell. */
  private parseKey(key: string): Position | null {
    const [csStr, rsStr] = key.split(",");
    const c = Number(csStr);
    const r = Number(rsStr);
    if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
    return { col: c, row: r };
  }

  /** Snapshot of every live placed encounter for the bridge. */
  private snapshotPlacedEncounters(): Array<{
    id: string;
    col: number;
    row: number;
    sprite: string;
  }> {
    return this.placedEncounters.map((p) => ({
      id: p.id,
      col: p.col,
      row: p.row,
      sprite: p.sprite ?? "",
    }));
  }

  /** Set of source cells that should suppress their static encounter
   *  overlay during the sim — every cell with a still-active placed
   *  encounter, plus every defeated cell (the encounter is gone but
   *  the static sprite shouldn't reappear mid-session). */
  private suppressedEncounterCells(): Set<string> {
    const out = new Set<string>(this.defeatedEncounters);
    for (const p of this.placedEncounters) out.add(p.sourceKey);
    return out;
  }

  /** Returns the dungeon id painted on the cell at `at`, or null
   *  when the cell doesn't carry one. Used by the step pipeline to
   *  fire `dungeon_entered`. */
  private dungeonIdAt(at: Position): string | null {
    const cell = cellAt(this.grid, at.col, at.row) as
      | (SimCell & { dungeon?: string })
      | null;
    const id = cell?.dungeon;
    return id && id.length > 0 ? id : null;
  }

  /** Build the SpawnEncounterOptions snapshot for a lair the party
   *  just stepped onto. Returns null when the destination cell isn't
   *  a live lair (no spawn id, unknown id, destroyed, or empty
   *  boss_monsters). */
  private spawnOptionsForLair(at: Position): SpawnEncounterOptions | null {
    const cell = cellAt(this.grid, at.col, at.row) as
      | (SimCell & { spawn?: string })
      | null;
    const spawnId = cell?.spawn;
    if (!spawnId) return null;
    const key = `${at.col},${at.row}`;
    if (this.destroyedLairs.has(key)) return null;
    const spawn = this.spawnCatalog.get(spawnId);
    if (!spawn) return null;
    const roster = spawn.boss_monsters.length > 0
      ? [...spawn.boss_monsters]
      : [...spawn.spawn_monsters];
    if (roster.length === 0) return null;
    return {
      kind: "boss",
      name: spawn.name,
      description: spawn.description,
      sourcePos: { col: at.col, row: at.row },
      monsters: roster,
      spawn,
      encounter: null,
      roamerId: null,
      placedEncounterId: null,
    };
  }

  /** Iterate every live lair on the map and roll its spawn_chance.
   *  Successful rolls append a roamer to `this.roamers`. Pure-ish —
   *  doesn't emit events; the caller refreshes the bridge after
   *  the pursuit phase. */
  private runSpawnPass(): void {
    if (this.spawnCatalog.size === 0) return;
    const lairs = findLairs(
      this.grid as unknown as ReadonlyArray<
        ReadonlyArray<SpawnCellInfo | null | undefined>
      >,
      this.spawnCatalog,
    );
    for (const { col, row, spawn } of lairs) {
      if (this.destroyedLairs.has(`${col},${row}`)) continue;
      const roamer = trySpawnRoamer({
        lair: { col, row },
        spawn,
        party: this.pos,
        existing: this.roamers,
        isWalkable: (c, r) => {
          const cell = cellAt(this.grid, c, r);
          return cell !== null && cell.walkable;
        },
        rng: Math.random,
        spriteFor: (id) => this.monsterCatalog.get(id)?.sprite,
      });
      if (roamer) {
        this.roamers.push(roamer);
        this.emit({
          kind: "log",
          message: `A ${this.monsterDisplayName(roamer.monsterId)} prowls out of ${spawn.name}.`,
        });
      }
    }
  }

  /** Move every roamer one cardinal step toward the party. The first
   *  roamer that lands adjacent / on top of the party returns the
   *  encounter snapshot; remaining roamers still finish their step
   *  (so the map looks alive) but the encounter is what the caller
   *  reacts to. Returns null when no roamer collides. */
  private advanceRoamersAndCheckCollision(): SpawnEncounterOptions | null {
    if (this.roamers.length === 0) return null;
    let trigger: SpawnEncounterOptions | null = null;
    // Occupancy set is rebuilt each step from the moved positions so
    // two roamers don't end up sharing a cell.
    const occupied = new Set<string>(
      this.roamers.map((r) => `${r.col},${r.row}`),
    );
    for (const roamer of this.roamers) {
      const fromKey = `${roamer.col},${roamer.row}`;
      occupied.delete(fromKey);
      const next = roamStep(
        { col: roamer.col, row: roamer.row },
        this.pos,
        (c, r) => {
          const cell = cellAt(this.grid, c, r);
          return cell !== null && cell.walkable;
        },
        (c, r) => occupied.has(`${c},${r}`),
      );
      roamer.col = next.col;
      roamer.row = next.row;
      occupied.add(`${next.col},${next.row}`);
      if (!trigger && roamerCollidesWithParty(roamer, this.pos)) {
        // First collision wins — locate the lair the roamer came
        // from so the destroy-lair option survives even when the
        // player kills the roamer on its own tile. sourcePos falls
        // back to the roamer cell if the source coords are gone.
        const [scStr, srStr] = roamer.sourceKey.split(",");
        const sc = Number(scStr);
        const sr = Number(srStr);
        const spawnId = this.spawnIdAtSourceKey(roamer.sourceKey);
        const spawn = spawnId ? this.spawnCatalog.get(spawnId) : undefined;
        if (spawn) {
          trigger = {
            kind: "roamer",
            name: spawn.name,
            description: spawn.description,
            sourcePos: Number.isFinite(sc) && Number.isFinite(sr)
              ? { col: sc, row: sr }
              : { col: roamer.col, row: roamer.row },
            monsters: [roamer.monsterId],
            spawn,
            encounter: null,
            roamerId: roamer.id,
            placedEncounterId: null,
          };
        }
      }
    }
    return trigger;
  }

  /** Look up the spawn id painted on the cell at `sourceKey`. Used
   *  by the roamer-collision branch to recover the lair record after
   *  the roamer has moved away. Returns undefined when the cell has
   *  no spawn (e.g. the lair was destroyed mid-session). */
  private spawnIdAtSourceKey(sourceKey: string): string | undefined {
    const [csStr, rsStr] = sourceKey.split(",");
    const cs = Number(csStr);
    const rs = Number(rsStr);
    if (!Number.isFinite(cs) || !Number.isFinite(rs)) return undefined;
    const cell = cellAt(this.grid, cs, rs) as
      | (SimCell & { spawn?: string })
      | null;
    return cell?.spawn;
  }

  /** Display name for a monster id. Falls back to the id itself when
   *  the catalog doesn't define one (so log lines aren't empty). */
  private monsterDisplayName(id: string): string {
    return this.monsterCatalog.get(id)?.name ?? id;
  }

  /** Snapshot of every live roamer with the sprite the bridge needs
   *  to draw. Copied per call so later mutations don't bleed into
   *  the host. */
  private snapshotRoamers(): Array<{
    id: string;
    col: number;
    row: number;
    sprite: string;
  }> {
    return this.roamers.map((r) => ({
      id: r.id,
      col: r.col,
      row: r.row,
      sprite: r.sprite ?? this.monsterCatalog.get(r.monsterId)?.sprite ?? "",
    }));
  }

  /** Snapshot the loose-boat set as an array the bridge can hand to
   *  the scene. Each entry carries the boat's sprite so the scene
   *  can decide what texture to render. Copied per call so a later
   *  mutation here never bleeds into the host. */
  private snapshotBoats(): Array<{
    col: number;
    row: number;
    sprite: string;
  }> {
    const out: Array<{ col: number; row: number; sprite: string }> = [];
    for (const [key, sprite] of this.boatPositions) {
      const [c, r] = key.split(",").map((v) => Number.parseInt(v, 10));
      if (Number.isFinite(c) && Number.isFinite(r)) {
        out.push({ col: c, row: r, sprite });
      }
    }
    return out;
  }

  /** Light a torch — sets a step countdown that bumps the party's
   *  emitted light radius. Doesn't consume an inventory charge yet
   *  (the inventory model isn't wired up beyond display); when items
   *  become first-class in the engine this should deduct one Torch. */
  lightTorch(steps = 100): void {
    if (this.disposed) return;
    this.party = { ...this.party, torch_steps: steps };
    this.bridge.setPartyLight(this.computeLightSource());
    this.bridge.relight();
    this.emit({ kind: "log", message: `Torch lit (${steps} steps).` });
    this.emit({ kind: "state" });
  }

  /** Cast Galadriel's Light — sets a step countdown for the Elven
   *  light effect. Same caveat as lightTorch re: MP costs. */
  castMagicLight(steps = 200): void {
    if (this.disposed) return;
    this.party = { ...this.party, galadriels_light_steps: steps };
    this.bridge.setPartyLight(this.computeLightSource());
    this.bridge.relight();
    this.emit({
      kind: "log",
      message: `Galadriel's Light shines (${steps} steps).`,
    });
    this.emit({ kind: "state" });
  }

  /** Activate or deactivate the party's infravision ability. The
   *  ability itself is a passive race trait (Dwarf in the default
   *  module); this method is the player-controlled switch that
   *  decides whether the lighting renderer applies the
   *  infravision band.
   *
   *  Silently no-ops if no roster member has the ability — that
   *  way callers (button handlers, prop syncs) don't have to gate
   *  themselves; only the UI needs to know whether to *expose*
   *  the toggle. */
  setInfravisionActive(active: boolean): void {
    if (this.disposed) return;
    if (!this.partyHasInfravision()) return;
    const next = !!active;
    if ((this.party.infravision_active ?? false) === next) return;
    this.party = { ...this.party, infravision_active: next };
    this.bridge.setPartyInfravisionActive?.(next);
    this.bridge.relight();
    this.emit({
      kind: "log",
      message: next
        ? "Infravision engaged."
        : "Infravision disengaged.",
    });
    this.emit({ kind: "state" });
  }

  /** Teleport the party to (col, row) without going through normal
   *  step-classification.
   *
   *  Used for same-map link traversal. A regular `move()` only steps
   *  one cell in a cardinal direction; portals can connect arbitrary
   *  cells, and the URL-navigation path used for cross-map links
   *  doesn't fire when the link target is the current map (the route
   *  doesn't remount), so the sim has to land the party itself.
   *
   *  Out-of-bounds is rejected — destinations off the grid are
   *  treated as a no-op. Walkability is NOT checked: link targets are
   *  authored and may legitimately point at a cell whose walkable
   *  flag is false (e.g. landing on a small platform). The author
   *  controls the destination; the sim trusts it.
   *
   *  Side effects mirror `move()`'s "walk" branch:
   *    - bridge.setPartyAt
   *    - party timer tick
   *    - lighting re-pass
   *    - emits `moved` + `state`. */
  teleport(col: number, row: number): void {
    if (this.disposed) return;
    if (col < 0 || row < 0) return;
    if (row >= this.grid.length) return;
    const rowArr = this.grid[row];
    if (!rowArr || col >= rowArr.length) return;
    const from = { ...this.pos };
    const to: Position = { col, row };
    this.pos = to;
    this.party = { ...this.party, ...tickPartyTimers(this.party) };
    this.bridge.setPartyAt(to.col, to.row);
    this.bridge.setPartyLight(this.computeLightSource());
    this.bridge.relight();
    this.emit({ kind: "moved", from, to });
    this.emit({ kind: "state" });
  }

  /** True iff at least one currently-active roster member has a
   *  race carrying the `infravision` ability. Computed on demand —
   *  the active-member list is fixed at construction so this is
   *  effectively a constant. */
  private partyHasInfravision(): boolean {
    const racesById = new Map(
      this.catalog.races.map((r) => [r.id, r]),
    );
    for (const m of this.activeMembers) {
      const race = racesById.get(m.race);
      if (!race) continue;
      if ((race.abilities ?? []).includes("infravision")) return true;
    }
    return false;
  }

  /** Snapshot of state the panel UI renders. Always fresh — no
   *  caching, the underlying data is tiny. The mutation sets
   *  alias the kernel's internal Sets (cheap) — hosts persisting
   *  them across mounts should clone first. */
  snapshot(): SimSnapshot {
    return {
      pos: { ...this.pos },
      party: this.party,
      activeMembers: this.activeMembers,
      lightRange: this.currentLightRange(),
      classNameById: this.classNameById,
      raceNameById: this.raceNameById,
      partyHasInfravision: this.partyHasInfravision(),
      unlockedCells: this.unlockedCells,
      defeatedEncounters: this.defeatedEncounters,
      destroyedLairs: this.destroyedLairs,
    };
  }

  /** Subscribe to sim events. Returns a teardown that removes the
   *  listener. The host calls snapshot() inside the listener when it
   *  receives a `state` event. */
  subscribe(listener: SimEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Lock-unlock dialog ─────────────────────────────────────────
  // These are the host-driven entrypoints the LockDialogOverlay
  // calls. The host opens the dialog on `lock_encountered` and then
  // hands control back through one of these three methods. Each
  // clears `pendingLock` before returning so a subsequent bump on
  // the same (or another) cell re-builds a fresh options snapshot.

  /** Returns the currently-pending lock encounter, if any. The host
   *  uses this on initial mount of the overlay to fill its rows
   *  without having to remember the event payload. */
  getPendingLock(): LockEncounterOptions | null {
    return this.pendingLock;
  }

  /**
   * Attempt to pick the current pending lock. Consumes one Lockpick
   * charge regardless of outcome (mirrors v1's behaviour — fumbling
   * still snaps a pick). On success the cell is added to
   * `unlockedCells` so the gate lifts for the remainder of the sim
   * session. Returns the dice math + a human-readable message; null
   * means the request was a no-op (no pending lock, no picker, or no
   * picks available).
   */
  attemptPickLock(): LockAttemptResult | null {
    if (this.disposed || !this.pendingLock) return null;
    const enc = this.pendingLock;
    if (!enc.picker || enc.lockpickCharges <= 0) return null;
    // Consume one charge from the party's stash — find the first
    // Lockpick entry with charges and decrement (drop entry at 0).
    this.consumeLockpick();
    const dex = enc.picker.dexterity ?? 10;
    const mod = statModFor(dex);
    const roll = 1 + Math.floor(Math.random() * 20);
    const total = roll + mod;
    const success = total >= PICK_LOCK_DC;
    const sign = mod >= 0 ? "+" : "";
    const message = success
      ? `${enc.picker.name} picks the lock! (d20:${roll}${sign}${mod}=${total} vs DC ${PICK_LOCK_DC})`
      : `${enc.picker.name} fumbles the pick. (d20:${roll}${sign}${mod}=${total} vs DC ${PICK_LOCK_DC}) — one lockpick snapped.`;
    if (success) this.applyUnlock(enc.pos, "picked");
    this.pendingLock = null;
    this.emit({ kind: "log", message });
    this.emit({ kind: "state" });
    return { kind: "pick", success, roll, mod, total, dc: PICK_LOCK_DC, message };
  }

  /**
   * Attempt to cast Knock on the pending lock. Deducts the spell's
   * MP cost regardless of outcome — same as the in-combat cast path.
   * The DC + save stat come from `knockSpell.action_params` so
   * authors can tune the spell without touching code. Returns null
   * when the request can't proceed (no caster, no spell, no MP).
   */
  attemptKnock(): LockAttemptResult | null {
    if (this.disposed || !this.pendingLock) return null;
    const enc = this.pendingLock;
    const spell = this.catalog.knockSpell;
    if (!enc.knockCaster || !spell) return null;
    const cost = spell.mp_cost ?? 0;
    if ((enc.knockCaster.mp ?? 0) < cost) return null;
    // Deduct MP from the catalog's character record so subsequent
    // pendingLock builds see the depleted total. Catalog members are
    // technically readonly at the type level — cast to a mutable
    // alias for this single in-session bookkeeping (the simulator
    // doesn't persist anything back to disk).
    const mutableCaster = enc.knockCaster as unknown as { mp: number };
    mutableCaster.mp = Math.max(0, (mutableCaster.mp ?? 0) - cost);
    const params = (spell.action_params ?? {}) as {
      save_dc_base?: number;
      save_stat?: string;
    };
    const dc = typeof params.save_dc_base === "number"
      ? params.save_dc_base
      : KNOCK_DEFAULT_DC;
    const statName = typeof params.save_stat === "string"
      ? params.save_stat
      : "intelligence";
    const statValue = readStat(enc.knockCaster, statName);
    const mod = statModFor(statValue);
    const roll = 1 + Math.floor(Math.random() * 20);
    const total = roll + mod;
    const success = total >= dc;
    const sign = mod >= 0 ? "+" : "";
    const message = success
      ? `${enc.knockCaster.name} casts Knock — the lock snaps open! (d20:${roll}${sign}${mod}=${total} vs DC ${dc})`
      : `${enc.knockCaster.name} casts Knock and the spell fizzles. (d20:${roll}${sign}${mod}=${total} vs DC ${dc}) — ${cost} MP gone.`;
    if (success) this.applyUnlock(enc.pos, "knocked");
    this.pendingLock = null;
    this.emit({ kind: "log", message });
    this.emit({ kind: "state" });
    return { kind: "knock", success, roll, mod, total, dc, message };
  }

  // ── Spawn-encounter dialog ─────────────────────────────────────
  // The host opens the SpawnEncounterOverlay on `spawn_encountered`
  // and feeds the outcome back through `resolveSpawnEncounter`. The
  // outcome is the only signal the kernel needs — the actual fight
  // is rendered (or stubbed) in the host. This contract lets us
  // ship the spawn loop now and slot real combat in later without
  // changing the kernel.

  /** Snapshot of the currently-pending spawn encounter, or null
   *  when none is queued. Host uses this on mount to refill its
   *  overlay state without remembering the event payload. */
  getPendingSpawn(): SpawnEncounterOptions | null {
    return this.pendingSpawn;
  }

  /**
   * Resolve the pending spawn encounter. Outcomes:
   *
   *   - "won":  The party defeated the roster.
   *     • Boss encounter → destroy the lair (cell reverts to ground,
   *       every roamer tied to that lair is removed). Emits
   *       `spawn_destroyed` and `setCellSprite` if a ground tile is
   *       available.
   *     • Roamer encounter → remove that one roamer; lair survives.
   *   - "fled": Party retreats. No roamer or lair is removed; the
   *     overlay closes and movement resumes. (Retreat doesn't
   *     teleport the party — host can wire in a step-back if it
   *     wants something fancier later.)
   *
   * Returns true when the resolution applied (i.e. an encounter was
   * pending). Returns false if there was nothing to resolve.
   */
  resolveSpawnEncounter(outcome: "won" | "fled"): boolean {
    if (this.disposed || !this.pendingSpawn) return false;
    const enc = this.pendingSpawn;
    this.pendingSpawn = null;
    if (outcome === "fled") {
      this.emit({ kind: "log", message: "The party retreats." });
      this.emit({ kind: "state" });
      return true;
    }
    if (enc.kind === "boss" && enc.spawn) {
      this.destroyLair(enc.sourcePos, enc.spawn);
    } else if (enc.kind === "roamer") {
      // Roamer fight — remove just the offending roamer.
      const before = this.roamers.length;
      if (enc.roamerId) {
        this.roamers = this.roamers.filter((r) => r.id !== enc.roamerId);
      }
      if (this.roamers.length !== before) {
        this.emit({
          kind: "log",
          message: `Defeated a ${this.monsterDisplayName(enc.monsters[0])}.`,
        });
      }
      this.bridge.setRoamerPositions?.(this.snapshotRoamers());
    } else if (enc.kind === "placed") {
      // Placed encounter fight — remove the entity permanently and
      // mark its source cell defeated so the suppression set keeps
      // the static overlay hidden after victory.
      const before = this.placedEncounters.length;
      if (enc.placedEncounterId) {
        const target = this.placedEncounters.find(
          (p) => p.id === enc.placedEncounterId,
        );
        if (target) this.defeatedEncounters.add(target.sourceKey);
        this.placedEncounters = this.placedEncounters.filter(
          (p) => p.id !== enc.placedEncounterId,
        );
      }
      if (this.placedEncounters.length !== before) {
        this.emit({
          kind: "log",
          message: `${enc.name} defeated.`,
        });
      }
      this.bridge.setPlacedEncounterPositions?.(
        this.snapshotPlacedEncounters(),
      );
      this.bridge.setSuppressedEncounterCells?.(
        this.suppressedEncounterCells(),
      );
    }
    this.emit({ kind: "state" });
    return true;
  }

  /** Mark a lair cell as destroyed: track it in `destroyedLairs` so
   *  the spawn pass + boss trigger ignore it, visually swap the cell
   *  to the configured ground tile, and clear every roamer that
   *  traces back to it. The painted grid is NOT mutated — the
   *  destruction is per-session only (matches the unlocked-cells
   *  convention). */
  private destroyLair(pos: Position, spawn: SimSpawn): void {
    const key = `${pos.col},${pos.row}`;
    this.destroyedLairs.add(key);
    if (this.groundTile) {
      this.bridge.setCellSprite?.(
        pos.col,
        pos.row,
        this.groundTile.sprite,
        this.groundTile.walkable,
      );
    }
    // Drop every roamer that was tied to this lair.
    const before = this.roamers.length;
    this.roamers = this.roamers.filter((r) => r.sourceKey !== key);
    if (this.roamers.length !== before) {
      this.bridge.setRoamerPositions?.(this.snapshotRoamers());
    }
    this.emit({
      kind: "spawn_destroyed",
      pos,
      spawnId: spawn.id,
    });
    this.emit({
      kind: "log",
      message: `${spawn.name} destroyed — the lair falls silent.`,
    });
  }

  /** Close the lock dialog without trying anything. The cell stays
   *  locked; the party stays put. */
  dismissLock(): void {
    if (this.disposed || !this.pendingLock) return;
    const enc = this.pendingLock;
    this.pendingLock = null;
    this.emit({ kind: "lock_resolved", pos: enc.pos, outcome: "left" });
    this.emit({ kind: "log", message: "The door stays locked." });
    this.emit({ kind: "state" });
  }

  /** True when the cell at (col, row) is currently treated as locked
   *  (cell flag is on AND no successful unlock attempt has cleared
   *  it during this sim run). */
  private isCellLocked(col: number, row: number): boolean {
    const cell = cellAt(this.grid, col, row);
    if (!cell?.locked) return false;
    return !this.unlockedCells.has(`${col},${row}`);
  }

  /** Build the option snapshot the dialog renders. Mirrors the
   *  branching in `Lock.ts.buildLockOptions` but uses the sim's
   *  catalog types (no PartyMember conversion needed). */
  private buildLockOptions(pos: Position): LockEncounterOptions {
    const picker = this.findLockpicker();
    const lockpickCharges = countLockpicks(this.party);
    const knockSpell = this.catalog.knockSpell ?? null;
    const knockCaster = knockSpell
      ? this.findKnockCaster(knockSpell)
      : null;
    const knockMpCost = knockSpell ? (knockSpell.mp_cost ?? 0) : null;
    return { pos, picker, lockpickCharges, knockCaster, knockMpCost };
  }

  private findLockpicker(): SimCharacter | null {
    // Thief always wins (specialist); a L3+ Ranger is the fallback.
    let ranger: SimCharacter | null = null;
    for (const m of this.activeMembers) {
      if (m.hp <= 0) continue;
      if (m.class === "thief") return m;
      if (m.class === "ranger" && m.level >= 3 && !ranger) ranger = m;
    }
    return ranger;
  }

  private findKnockCaster(spell: SimSpell): SimCharacter | null {
    const classes = this.catalog.characterClasses ?? [];
    const classById = new Map<string, SimCharacterClass>();
    for (const c of classes) classById.set(c.id, c);
    for (const m of this.activeMembers) {
      if (m.hp <= 0) continue;
      const klass = classById.get(m.class);
      if (!klass || !klass.casting_type) continue;
      if (!klass.casting_type.includes(spell.casting_type)) continue;
      if (m.level < (spell.min_level ?? 1)) continue;
      return m;
    }
    return null;
  }

  private consumeLockpick(): void {
    const inv = this.party.inventory;
    if (!inv) return;
    for (let i = 0; i < inv.length; i++) {
      const entry = inv[i];
      if (!isLockpickEntry(entry.item)) continue;
      const charges = (entry.charges ?? 1) - 1;
      if (charges <= 0) inv.splice(i, 1);
      else inv[i] = { ...entry, charges };
      return;
    }
  }

  private applyUnlock(pos: Position, outcome: "picked" | "knocked"): void {
    this.unlockedCells.add(`${pos.col},${pos.row}`);
    // The sprite for a "Locked Door" tile_id stays the same in the
    // simulator — we don't have a per-id sprite swap in the sim
    // pipeline (the editor pipeline owns sprites). The host can
    // listen for `lock_resolved` and re-render if it wants to. We
    // do trigger a relight in case the unlocked cell's obstructs
    // flag flips elsewhere.
    this.bridge.relight();
    this.emit({ kind: "lock_resolved", pos, outcome });
  }

  /** Tear down: clear the sprite, remove the key listener, mark the
   *  instance as inert. Calling step / etc. after dispose is a no-op. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeKeyListener();
    this.bridge.setPartyLight(null);
    this.bridge.clearParty();
    // Clear any drawn roamers / placed encounters so a re-entry to
    // sim mode starts blank. Also restore the static cell overlays
    // by emptying the suppression set.
    this.bridge.setRoamerPositions?.([]);
    this.bridge.setPlacedEncounterPositions?.([]);
    this.bridge.setSuppressedEncounterCells?.(new Set());
    this.bridge.relight();
    this.listeners.clear();
  }

  // ── internals ───────────────────────────────────────────────────

  private onKey(key: string): void {
    const dir = directionForKey(key);
    if (!dir) return;
    this.stepInDirection(dir);
  }

  private currentLightRange(): number {
    return partyLightRange(
      this.party,
      this.activeMembers,
      this.catalog.races,
      this.catalog.effects,
    );
  }

  private computeLightSource(): SimLightSource | null {
    return partyLightSource(this.pos, this.currentLightRange());
  }

  private emit(event: SimEvent): void {
    for (const listener of this.listeners) {
      // Listeners are user code — never let one throw take down the
      // dispatch loop for the others.
      try {
        listener(event);
      } catch {
        /* swallow */
      }
    }
  }
}
