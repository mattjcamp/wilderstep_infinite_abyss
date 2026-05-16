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
  SimEffect,
  SimGrid,
  SimLightSource,
  SimParty,
  SimRace,
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
}

/** Catalog data the sim needs to resolve character → race → effects.
 *  These three sets rarely change during play, so the host loads
 *  them once and hands them in. */
export interface SimCatalog {
  characters: ReadonlyArray<SimCharacter>;
  races: ReadonlyArray<SimRace>;
  effects: ReadonlyArray<SimEffect>;
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
    let kind: MoveKind;
    if (this.onBoat) {
      if (targetHasBoat) kind = "blocked-boat";
      else if (targetIsWater) kind = "sail";
      else if (target.walkable) kind = "disembark";
      else kind = "blocked";
    } else {
      if (targetHasBoat) kind = "board";
      else if (!target.walkable) kind = "blocked";
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
    // Surface on-step tile text if the cell carries any.
    const text = (target as unknown as { text?: string }).text;
    if (text) this.emit({ kind: "log", message: text });
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
