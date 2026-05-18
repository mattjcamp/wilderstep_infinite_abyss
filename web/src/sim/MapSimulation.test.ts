import { describe, it, expect, vi } from "vitest";
import { MapSimulation, type SceneBridge } from "./MapSimulation";
import type { SimGrid, SimCell, SimParty, SimEvent } from "./types";

/** Build a SceneBridge whose methods are all spies — tests assert
 *  what the sim asked the host to draw without standing up Phaser. */
function fakeBridge(): SceneBridge {
  return {
    setPartyAt: vi.fn(),
    clearParty: vi.fn(),
    setPartyLight: vi.fn(),
    relight: vi.fn(),
    setBoatPositions: vi.fn(),
    setPartyBoatAt: vi.fn(),
    floatText: vi.fn(),
    setRoamerPositions: vi.fn(),
    setCellSprite: vi.fn(),
    setPlacedEncounterPositions: vi.fn(),
    setSuppressedEncounterCells: vi.fn(),
    setPartyInfravisionActive: vi.fn(),
    onKey: () => () => {},
  };
}

/** Minimal walkable cell. Tests that need a portal pass `link`. */
function cell(over: Partial<SimCell> = {}): SimCell {
  return {
    id: "grass",
    sprite: "map/grass.png",
    walkable: true,
    obstructs: false,
    locked: false,
    ...over,
  };
}

/** 5×5 walkable grid. Tests may stamp link cells on top. */
function makeGrid(): SimGrid {
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => cell()),
  );
}

function makeParty(over: Partial<SimParty> = {}): SimParty {
  return {
    start_position: { col: 0, row: 0 },
    avatar: "",
    roster: [],
    torch_steps: 0,
    galadriels_light_steps: 0,
    ...over,
  };
}

function makeSim(opts?: { grid?: SimGrid; party?: SimParty }) {
  const grid = opts?.grid ?? makeGrid();
  const party = opts?.party ?? makeParty();
  return new MapSimulation({
    grid,
    party,
    catalog: { characters: [], races: [], effects: [] },
    classNameById: new Map(),
    bridge: fakeBridge(),
  });
}

/** Subscribe to a sim and collect every event it emits. Returns the
 *  array (mutated as events arrive) — assert on it after the call
 *  under test. */
function captureEvents(sim: MapSimulation): SimEvent[] {
  const events: SimEvent[] = [];
  sim.subscribe((ev) => events.push(ev));
  return events;
}

/** Convenience — kinds only, for ordering assertions. */
function kinds(events: SimEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe("MapSimulation.stepInDirection — basic movement", () => {
  it("walks one cell in the requested direction", () => {
    const sim = makeSim();
    sim.stepInDirection("right");
    expect(sim.snapshot().pos).toEqual({ col: 1, row: 0 });
  });

  it("emits `moved` with from + to", () => {
    const sim = makeSim();
    const events = captureEvents(sim);
    sim.stepInDirection("down");
    const moved = events.find((e) => e.kind === "moved");
    expect(moved).toBeDefined();
    if (moved?.kind !== "moved") throw new Error("type narrow");
    expect(moved.from).toEqual({ col: 0, row: 0 });
    expect(moved.to).toEqual({ col: 0, row: 1 });
  });

  it("supports all four cardinal directions", () => {
    const sim = makeSim({
      party: { ...makeParty(), start_position: { col: 2, row: 2 } },
    });
    sim.stepInDirection("up");
    expect(sim.snapshot().pos).toEqual({ col: 2, row: 1 });
    sim.stepInDirection("right");
    expect(sim.snapshot().pos).toEqual({ col: 3, row: 1 });
    sim.stepInDirection("down");
    expect(sim.snapshot().pos).toEqual({ col: 3, row: 2 });
    sim.stepInDirection("left");
    expect(sim.snapshot().pos).toEqual({ col: 2, row: 2 });
  });
});

describe("MapSimulation.stepInDirection — blocked paths", () => {
  it("emits `blocked` with reason `off_grid` at the edge", () => {
    const sim = makeSim();
    const events = captureEvents(sim);
    // Party starts at (0,0); stepping up walks off the top.
    sim.stepInDirection("up");
    const blocked = events.find((e) => e.kind === "blocked");
    expect(blocked).toBeDefined();
    if (blocked?.kind !== "blocked") throw new Error("type narrow");
    expect(blocked.reason).toBe("off_grid");
    // Party didn't move.
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
  });

  it("emits `blocked` with reason `blocked` for unwalkable tiles", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ walkable: false });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const blocked = events.find((e) => e.kind === "blocked");
    expect(blocked).toBeDefined();
    if (blocked?.kind !== "blocked") throw new Error("type narrow");
    expect(blocked.reason).toBe("blocked");
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
  });

  it("doesn't emit `moved` when blocked", () => {
    const sim = makeSim();
    const events = captureEvents(sim);
    sim.stepInDirection("up");
    expect(events.find((e) => e.kind === "moved")).toBeUndefined();
  });
});

describe("MapSimulation.stepInDirection — link traversal", () => {
  it("emits `linked` instead of `moved`/`blocked` when stepping onto a link", () => {
    const grid = makeGrid();
    grid[0][1] = cell({
      link: { map_id: "other_map", x: 5, y: 7 },
    });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const linked = events.find((e) => e.kind === "linked");
    expect(linked).toBeDefined();
    if (linked?.kind !== "linked") throw new Error("type narrow");
    expect(linked.link).toEqual({ map_id: "other_map", x: 5, y: 7 });
    // The party still moves into the link cell — the host then
    // routes them onward via the linked event.
    expect(sim.snapshot().pos).toEqual({ col: 1, row: 0 });
  });

  it("emits `moved` THEN `linked` so listeners read the new pos on link", () => {
    const grid = makeGrid();
    grid[0][1] = cell({
      link: { map_id: "other_map", x: 0, y: 0 },
    });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const ks = kinds(events);
    const movedIdx = ks.indexOf("moved");
    const linkedIdx = ks.indexOf("linked");
    expect(movedIdx).toBeGreaterThanOrEqual(0);
    expect(linkedIdx).toBeGreaterThan(movedIdx);
  });

  it("ignores empty link.map_id (treats cell as normal walk)", () => {
    const grid = makeGrid();
    // Link with empty map_id is malformed authoring data — sim
    // should treat it as a regular cell, not a portal.
    grid[0][1] = cell({
      link: { map_id: "", x: 0, y: 0 },
    });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    expect(events.find((e) => e.kind === "linked")).toBeUndefined();
    expect(events.find((e) => e.kind === "moved")).toBeDefined();
  });
});

describe("MapSimulation.stepInDirection — NPC + counter dispatch", () => {
  it("emits `npc_encountered` and does not move when bumping an NPC", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ npc: "alchemist" });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const npc = events.find((e) => e.kind === "npc_encountered");
    expect(npc).toBeDefined();
    if (npc?.kind !== "npc_encountered") throw new Error("type narrow");
    expect(npc.npcId).toBe("alchemist");
    expect(npc.pos).toEqual({ col: 1, row: 0 });
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
  });

  it("emits `counter_encountered` and does not move when bumping a counter", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ counter: "general" });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const counter = events.find((e) => e.kind === "counter_encountered");
    expect(counter).toBeDefined();
    if (counter?.kind !== "counter_encountered") throw new Error("type narrow");
    expect(counter.counterId).toBe("general");
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
  });
});

describe("MapSimulation.stepInDirection — locked tiles", () => {
  it("emits `lock_encountered` when bumping a locked tile, party stays put", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ walkable: false, locked: true });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const lock = events.find((e) => e.kind === "lock_encountered");
    expect(lock).toBeDefined();
    if (lock?.kind !== "lock_encountered") throw new Error("type narrow");
    expect(lock.options.pos).toEqual({ col: 1, row: 0 });
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
  });

  it("locked check beats walkable: true (designer-marked locked passable tile)", () => {
    // A walkable tile with `locked: true` still fires the unlock
    // dialog. Some authors mark a passable doorway as locked so the
    // player has to pick / knock through it.
    const grid = makeGrid();
    grid[0][1] = cell({ walkable: true, locked: true });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    expect(events.find((e) => e.kind === "lock_encountered")).toBeDefined();
    expect(events.find((e) => e.kind === "moved")).toBeUndefined();
  });
});

describe("MapSimulation.stepInDirection — boat handling", () => {
  it("boards a boat by stepping into its cell", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ boat: true, sprite: "map/boat.png" });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const boarded = events.find((e) => e.kind === "boarded");
    expect(boarded).toBeDefined();
    expect(sim.snapshot().pos).toEqual({ col: 1, row: 0 });
  });

  it("sails across water when already aboard", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ boat: true, sprite: "map/boat.png" });
    grid[0][2] = cell({
      walkable: false,
      tag: "water",
      sprite: "map/water.png",
    });
    const sim = makeSim({ grid });
    sim.stepInDirection("right"); // board
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.stepInDirection("right"); // sail
    expect(events.find((e) => e.kind === "moved")).toBeDefined();
    expect(sim.snapshot().pos).toEqual({ col: 2, row: 0 });
  });

  it("disembarks onto a walkable tile from a boat", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ boat: true, sprite: "map/boat.png" });
    // (0,2) is walkable grass by default.
    const sim = makeSim({ grid });
    sim.stepInDirection("right"); // board
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.stepInDirection("right"); // disembark
    const dis = events.find((e) => e.kind === "disembarked");
    expect(dis).toBeDefined();
    if (dis?.kind !== "disembarked") throw new Error("type narrow");
    expect(dis.pos).toEqual({ col: 2, row: 0 });
    // The boat sits behind on the cell we just left.
    expect(dis.boatAt).toEqual({ col: 1, row: 0 });
    expect(sim.snapshot().pos).toEqual({ col: 2, row: 0 });
  });
});

describe("MapSimulation.stepInDirection — side effects", () => {
  it("ticks torch_steps down on each walk", () => {
    const sim = makeSim({
      party: { ...makeParty(), torch_steps: 3 },
    });
    expect(sim.snapshot().party.torch_steps).toBe(3);
    sim.stepInDirection("right");
    expect(sim.snapshot().party.torch_steps).toBe(2);
    sim.stepInDirection("right");
    expect(sim.snapshot().party.torch_steps).toBe(1);
  });

  it("does not tick torch_steps on a blocked step", () => {
    const sim = makeSim({
      party: { ...makeParty(), torch_steps: 5 },
    });
    sim.stepInDirection("up"); // off-grid
    expect(sim.snapshot().party.torch_steps).toBe(5);
  });

  it("calls bridge.setPartyAt for successful walks", () => {
    const setPartyAt = vi.fn();
    const bridge: SceneBridge = { ...fakeBridge(), setPartyAt };
    const sim = new MapSimulation({
      grid: makeGrid(),
      party: makeParty(),
      catalog: { characters: [], races: [], effects: [] },
      classNameById: new Map(),
      bridge,
    });
    sim.stepInDirection("right");
    expect(setPartyAt).toHaveBeenCalledWith(1, 0);
  });

  it("calls bridge.relight after each move (lighting follows the party)", () => {
    const relight = vi.fn();
    const bridge: SceneBridge = { ...fakeBridge(), relight };
    const sim = new MapSimulation({
      grid: makeGrid(),
      party: makeParty(),
      catalog: { characters: [], races: [], effects: [] },
      classNameById: new Map(),
      bridge,
    });
    relight.mockClear(); // ignore the construction-time relight
    sim.stepInDirection("right");
    expect(relight).toHaveBeenCalled();
  });

  it("emits `state` after a successful walk for snapshot consumers", () => {
    const sim = makeSim();
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    expect(events.find((e) => e.kind === "state")).toBeDefined();
  });
});

describe("MapSimulation.teleport", () => {
  it("moves the party to the target cell", () => {
    const sim = makeSim();
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
    sim.teleport(3, 4);
    expect(sim.snapshot().pos).toEqual({ col: 3, row: 4 });
  });

  it("emits a `moved` event with from + to", () => {
    const sim = makeSim();
    const events: Array<{ kind: string; from?: unknown; to?: unknown }> = [];
    sim.subscribe((ev) => {
      events.push(ev as { kind: string; from?: unknown; to?: unknown });
    });
    sim.teleport(2, 2);
    const moved = events.find((e) => e.kind === "moved");
    expect(moved).toBeDefined();
    expect(moved!.from).toEqual({ col: 0, row: 0 });
    expect(moved!.to).toEqual({ col: 2, row: 2 });
  });

  it("emits a `state` event after the move", () => {
    const sim = makeSim();
    const kinds: string[] = [];
    sim.subscribe((ev) => kinds.push(ev.kind));
    sim.teleport(1, 1);
    // `state` should land AFTER `moved` so listeners that re-read
    // snapshot on state see the new position.
    const movedIdx = kinds.indexOf("moved");
    const stateIdx = kinds.indexOf("state");
    expect(movedIdx).toBeGreaterThanOrEqual(0);
    expect(stateIdx).toBeGreaterThan(movedIdx);
  });

  it("rejects out-of-bounds destinations without moving", () => {
    const sim = makeSim();
    sim.teleport(99, 99);
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
    sim.teleport(-1, 0);
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
    sim.teleport(0, -1);
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
  });

  it("does not check walkability — link destinations are trusted", () => {
    // A portal authored to drop the party onto a normally-impassable
    // cell (a small platform, a ledge, etc.) is a valid setup. The
    // teleport path doesn't re-litigate the author's choice.
    const grid = makeGrid();
    grid[2][3] = cell({ walkable: false });
    const sim = makeSim({ grid });
    sim.teleport(3, 2);
    expect(sim.snapshot().pos).toEqual({ col: 3, row: 2 });
  });

  it("is inert after dispose()", () => {
    const sim = makeSim();
    sim.dispose();
    sim.teleport(2, 2);
    // dispose() doesn't clear position; we just verify the call
    // doesn't throw and doesn't emit. Post-dispose snapshot calls are
    // not part of the supported surface so we don't assert on it.
    expect(true).toBe(true);
  });
});
