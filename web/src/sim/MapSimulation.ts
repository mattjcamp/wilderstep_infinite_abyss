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
  directionForKey,
  findSpawn,
  partyLightRange,
  partyLightSource,
  step,
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
    // Resolve the active party (4 character ids) to their full records.
    // Missing ids drop silently; the panel renders a placeholder row.
    const byId = new Map(opts.catalog.characters.map((c) => [c.id, c]));
    const active: SimCharacter[] = [];
    for (const id of opts.party.active_party) {
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

    // Initial scene push — the sprite + light source land in place
    // before the first keypress.
    this.bridge.setPartyAt(this.pos.col, this.pos.row);
    this.bridge.setPartyLight(this.computeLightSource());
    this.bridge.relight();

    // Keyboard input. The bridge owns the actual listener registration
    // so the host can scope it however it likes (window vs. canvas vs.
    // Phaser keyboard manager).
    this.disposeKeyListener = this.bridge.onKey((key) => this.onKey(key));
  }

  /** Manually drive a step. Useful for buttons (e.g., a tap-up control
   *  in a mobile build) and for tests. */
  stepInDirection(direction: Direction): void {
    if (this.disposed) return;
    const result = step(this.grid, this.pos, direction);
    if (result.kind === "stayed") {
      this.emit({
        kind: "blocked",
        pos: { ...this.pos },
        direction,
        reason: result.reason,
      });
      this.emit({
        kind: "log",
        message:
          result.reason === "off_grid"
            ? "Edge of the map."
            : "Something blocks the way.",
      });
      return;
    }
    const from = { ...this.pos };
    const to: Position = { col: result.col, row: result.row };
    this.pos = to;
    // Step counters tick AFTER movement: a torch with 1 step left
    // lights the tile you step onto, then burns out. Matches v1.
    this.party = { ...this.party, ...tickPartyTimers(this.party) };
    // Push side-effects through the bridge.
    this.bridge.setPartyAt(to.col, to.row);
    this.bridge.setPartyLight(this.computeLightSource());
    this.bridge.relight();
    if (result.kind === "linked") {
      this.emit({ kind: "moved", from, to });
      this.emit({
        kind: "linked",
        from,
        to,
        link: result.link,
      });
      this.emit({
        kind: "log",
        message: `Link → ${result.link.map_id}@${result.link.x},${result.link.y}`,
      });
      this.emit({ kind: "state" });
      return;
    }
    this.emit({ kind: "moved", from, to });
    // Surface on-step tile text if the cell carries any. Useful for
    // testing scripted callouts when authoring a map.
    const cell = cellAt(this.grid, to.col, to.row);
    const text = (cell as unknown as { text?: string } | null)?.text;
    if (text) this.emit({ kind: "log", message: text });
    this.emit({ kind: "state" });
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
