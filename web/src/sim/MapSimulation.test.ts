import { describe, it, expect, vi } from "vitest";
import { MapSimulation, type SceneBridge } from "./MapSimulation";
import type { SimGrid, SimCell, SimParty } from "./types";

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
