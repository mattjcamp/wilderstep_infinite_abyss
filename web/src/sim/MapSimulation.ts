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
import type {
  Direction,
  Position,
  SimCharacter,
  SimCharacterClass,
  SimEffect,
  SimGrid,
  SimLightSource,
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
}

/** DC the Pick Lock attempt rolls against. Matches `Lock.ts`
 *  (`PICK_LOCK_DC = 12`); duplicated here so the sim doesn't pull
 *  the v1battle world layer into its dependency graph. */
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
 *  display name (`"Lockpick"` — still used by `public/data/party.json`
 *  before the sync script flattens it). Matching both keeps the
 *  simulator working against either data shape without the user
 *  having to clean up their module first. */
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
   *  map to its authored state. */
  private readonly unlockedCells = new Set<string>();
  /** Live lock encounter while the dialog is up. Cleared by
   *  `attemptPickLock` (on success or failure-with-charge-consumed),
   *  `attemptKnock`, or `dismissLock`. */
  private pendingLock: LockEncounterOptions | null = null;
  private disposed = false;

  constructor(opts: MapSimulationOptions) {
    this.bridge = opts.bridge;
    this.grid = opts.grid;
    this.catalog = opts.catalog;
    this.classNameById = opts.classNameById;
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
    this.emit({ kind: "state" });
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

  /** Snapshot of state the panel UI renders. Always fresh — no
   *  caching, the underlying data is tiny. */
  snapshot(): SimSnapshot {
    return {
      pos: { ...this.pos },
      party: this.party,
      activeMembers: this.activeMembers,
      lightRange: this.currentLightRange(),
      classNameById: this.classNameById,
      raceNameById: this.raceNameById,
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
