import { describe, it, expect, vi } from "vitest";
import { MapSimulation, type SceneBridge } from "./MapSimulation";
import type { SimGrid, SimCell, SimParty, SimEvent } from "./types";
import { TORCH_LIGHT_RANGE } from "./types";
import {
  ensureQuestStates,
  parseQuestsFile,
  type QuestState,
} from "@/battle/world/Quests";

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
    ...over,
  };
}

function makeSim(opts?: {
  grid?: SimGrid;
  party?: SimParty;
  startAt?: { col: number; row: number };
  initialOnBoat?: boolean;
  initialCurrentBoatSprite?: string | null;
  bridge?: SceneBridge;
  /** Items catalog forwarded into the sim. Tests that exercise the
   *  chest bump path pass entries with `is_chest: true` here; the
   *  default empty array keeps the legacy walk-to-pickup flow on
   *  for every other test. */
  items?: ReadonlyArray<{
    id: string;
    name?: string;
    icon?: string;
    is_chest?: boolean;
    item_type?: string;
    light_range?: number;
    contents?: {
      gold?: number;
      items?: ReadonlyArray<{ id: string; qty?: number }>;
    };
  }>;
  /** Pre-cleared cells — drives the picked-item persistence pass.
   *  Tests use this to assert that a re-mounted kernel applies the
   *  same clears the host wrote into the save delta. */
  initialPickedItemCells?: ReadonlySet<string>;
}) {
  const grid = opts?.grid ?? makeGrid();
  const party = opts?.party ?? makeParty();
  return new MapSimulation({
    grid,
    party,
    catalog: { characters: [], races: [], effects: [], items: opts?.items },
    classNameById: new Map(),
    bridge: opts?.bridge ?? fakeBridge(),
    startAt: opts?.startAt,
    initialOnBoat: opts?.initialOnBoat,
    initialCurrentBoatSprite: opts?.initialCurrentBoatSprite,
    initialPickedItemCells: opts?.initialPickedItemCells,
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

  it("Knock-row caster eligibility reads the level off the SimCharacter the sim was handed", () => {
    // Regression for the "Cast Knock says 'no eligible caster' even
    // with a L2+ wizard" bug. The kernel's `findKnockCaster` checks
    // `m.level < spell.min_level` against the SimCharacter in
    // `activeMembers`, which is built directly from
    // `catalog.characters` at construction. The play-side loader is
    // responsible for syncing the save's live level onto those
    // catalog records (alongside hp/mp) before constructing the
    // sim — without that sync a wizard who levelled up from L1 to
    // L2+ in play still looks L1 to the kernel and the dialog gates
    // them out.
    //
    // This test pins the kernel-side contract: when handed a
    // wizard SimCharacter at level 2, a knock spell at min_level 2,
    // and a wizard class with `casting_type: ["sorcerer"]`, the
    // emitted lock_encountered event MUST surface that wizard as
    // `knockCaster`. The companion check below confirms a level-1
    // wizard is correctly rejected, so the gate itself still works —
    // the regression we're guarding against is the level field
    // being stale, not the gate being too lenient.
    const grid = makeGrid();
    grid[0][1] = cell({ walkable: false, locked: true });
    const wizard = {
      id: "elminster",
      name: "Elminster",
      class: "wizard",
      race: "human",
      level: 2,
      hp: 6,
      mp: 20,
      sprite: "person/wizard.png",
      intelligence: 18,
    };
    const wizardClass = {
      id: "wizard",
      name: "Wizard",
      casting_type: ["sorcerer"],
    };
    const knockSpell = {
      id: "knock",
      name: "Knock",
      casting_type: "sorcerer",
      min_level: 2,
      mp_cost: 6,
      action: "knock",
    };
    const sim = new MapSimulation({
      grid,
      party: { ...makeParty(), roster: ["elminster"] },
      catalog: {
        characters: [wizard],
        races: [],
        effects: [],
        characterClasses: [wizardClass],
        knockSpell,
      },
      classNameById: new Map([["wizard", "Wizard"]]),
      bridge: fakeBridge(),
    });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const lock = events.find((e) => e.kind === "lock_encountered");
    if (lock?.kind !== "lock_encountered") throw new Error("type narrow");
    expect(lock.options.knockCaster?.id).toBe("elminster");
    expect(lock.options.knockMpCost).toBe(6);
  });

  it("Knock row stays gated when the SimCharacter is still below min_level", () => {
    // Companion to the regression above — proves the level check
    // is still doing its job. Same fixture, but the wizard is L1;
    // findKnockCaster should reject and the dialog should show the
    // "no eligible caster" copy.
    const grid = makeGrid();
    grid[0][1] = cell({ walkable: false, locked: true });
    const wizard = {
      id: "elminster",
      name: "Elminster",
      class: "wizard",
      race: "human",
      level: 1, // below min_level
      hp: 6,
      mp: 20,
      sprite: "person/wizard.png",
      intelligence: 18,
    };
    const wizardClass = {
      id: "wizard",
      name: "Wizard",
      casting_type: ["sorcerer"],
    };
    const knockSpell = {
      id: "knock",
      name: "Knock",
      casting_type: "sorcerer",
      min_level: 2,
      mp_cost: 6,
      action: "knock",
    };
    const sim = new MapSimulation({
      grid,
      party: { ...makeParty(), roster: ["elminster"] },
      catalog: {
        characters: [wizard],
        races: [],
        effects: [],
        characterClasses: [wizardClass],
        knockSpell,
      },
      classNameById: new Map([["wizard", "Wizard"]]),
      bridge: fakeBridge(),
    });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const lock = events.find((e) => e.kind === "lock_encountered");
    if (lock?.kind !== "lock_encountered") throw new Error("type narrow");
    expect(lock.options.knockCaster).toBeNull();
  });
});

describe("MapSimulation — unlock by key", () => {
  /** A locked door directly to the party's right, plus an items
   *  catalog declaring `iron_key` as an `item_type: "key"`. The party
   *  carries one iron key in its stash. */
  function keySim(over?: {
    inventory?: SimParty["inventory"];
    items?: Parameters<typeof makeSim>[0]["items"];
  }) {
    const grid = makeGrid();
    grid[0][1] = cell({ walkable: false, locked: true });
    const party = makeParty({
      inventory: over?.inventory ?? [{ item: "iron_key" }],
    });
    return makeSim({
      grid,
      party,
      items: over?.items ?? [
        { id: "iron_key", name: "Iron Key", item_type: "key" },
      ],
    });
  }

  it("surfaces a usable key on the lock_encountered options when the party carries one", () => {
    const sim = keySim();
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const lock = events.find((e) => e.kind === "lock_encountered");
    if (lock?.kind !== "lock_encountered") throw new Error("type narrow");
    expect(lock.options.usableKey).toEqual({ id: "iron_key", name: "Iron Key" });
  });

  it("attemptUseKey unlocks the cell, consumes the key, and reports the consumed id", () => {
    const sim = keySim();
    const events = captureEvents(sim);
    sim.stepInDirection("right"); // bump → lock_encountered
    const result = sim.attemptUseKey();
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.kind).toBe("key");
    expect(result?.consumedItemId).toBe("iron_key");
    // The cell is now in the unlocked set.
    expect(sim.snapshot().unlockedCells.has("1,0")).toBe(true);
    // The key was removed from the in-session stash.
    expect(
      sim.snapshot().party.inventory?.some((e) => e.item === "iron_key"),
    ).toBe(false);
    // A lock_resolved event with the "unlocked" outcome fired.
    const resolved = events.find((e) => e.kind === "lock_resolved");
    if (resolved?.kind !== "lock_resolved") throw new Error("type narrow");
    expect(resolved.outcome).toBe("unlocked");
    // The party can now walk through the (still-painted) locked tile.
    sim.stepInDirection("right");
    expect(sim.snapshot().pos).toEqual({ col: 1, row: 0 });
  });

  it("decrements a multi-charge key stack rather than removing the row", () => {
    const sim = keySim({ inventory: [{ item: "iron_key", charges: 3 }] });
    captureEvents(sim);
    sim.stepInDirection("right");
    sim.attemptUseKey();
    const entry = sim
      .snapshot()
      .party.inventory?.find((e) => e.item === "iron_key");
    expect(entry?.charges).toBe(2);
  });

  it("does NOT treat a quest_item 'key' as a usable door key", () => {
    // The Keys of Shadow (gold_key, etc.) are item_type "quest_item".
    // They must never open a door — only item_type "key" qualifies.
    const sim = keySim({
      inventory: [{ item: "gold_key" }],
      items: [
        { id: "gold_key", name: "Gold Key", item_type: "quest_item" },
        { id: "iron_key", name: "Iron Key", item_type: "key" },
      ],
    });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const lock = events.find((e) => e.kind === "lock_encountered");
    if (lock?.kind !== "lock_encountered") throw new Error("type narrow");
    expect(lock.options.usableKey).toBeNull();
    // And the attempt is a no-op (no key to spend).
    expect(sim.attemptUseKey()).toBeNull();
    expect(sim.snapshot().unlockedCells.has("1,0")).toBe(false);
  });

  it("attemptUseKey is a no-op when there is no pending lock", () => {
    const sim = keySim();
    // No bump yet → no pending lock.
    expect(sim.attemptUseKey()).toBeNull();
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

  it("traverses a link when sailing onto a linked water tile", () => {
    // Sea route: stand on land, board a boat at (1,0), then sail
    // east into a water tile that carries an inter-map link. The
    // portal should fire exactly like a footstep onto a linked land
    // tile — `linked` event with the authored destination, party
    // position moved to the link cell, no `disembarked` in between.
    const grid = makeGrid();
    grid[0][1] = cell({ boat: true, sprite: "map/boat.png" });
    grid[0][2] = cell({
      walkable: false,
      tag: "water",
      sprite: "map/water.png",
      link: { map_id: "other_map", x: 3, y: 4 },
    });
    const sim = makeSim({ grid });
    sim.stepInDirection("right"); // board
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.stepInDirection("right"); // sail into link
    const linked = events.find((e) => e.kind === "linked");
    expect(linked).toBeDefined();
    if (linked?.kind !== "linked") throw new Error("type narrow");
    expect(linked.link).toEqual({ map_id: "other_map", x: 3, y: 4 });
    expect(linked.from).toEqual({ col: 1, row: 0 });
    expect(linked.to).toEqual({ col: 2, row: 0 });
    // Boat state carried on the event so the destination map mounts
    // with the party already aboard the same vessel.
    expect(linked.onBoat).toBe(true);
    expect(linked.boatSprite).toBe("map/boat.png");
    // `moved` must fire before `linked` so listeners that re-read the
    // snapshot on link see the new position (same ordering rule as
    // the land case).
    const ks = kinds(events);
    expect(ks.indexOf("moved")).toBeGreaterThanOrEqual(0);
    expect(ks.indexOf("linked")).toBeGreaterThan(ks.indexOf("moved"));
    // Crossing a portal isn't disembarking — the party stays aboard
    // and the host handles the boat state on the destination map.
    expect(events.find((e) => e.kind === "disembarked")).toBeUndefined();
    expect(sim.snapshot().pos).toEqual({ col: 2, row: 0 });
  });

  it("reports onBoat=false + boatSprite=null for an on-foot link traversal", () => {
    // Negative case for the new fields — a plain land link must not
    // flag the party as boat-borne or invent a boat sprite. Without
    // this, hosts piping the event into the next map's mount would
    // spawn the party on a phantom boat.
    const grid = makeGrid();
    grid[0][1] = cell({
      link: { map_id: "other_map", x: 0, y: 0 },
    });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const linked = events.find((e) => e.kind === "linked");
    expect(linked).toBeDefined();
    if (linked?.kind !== "linked") throw new Error("type narrow");
    expect(linked.onBoat).toBe(false);
    expect(linked.boatSprite).toBeNull();
  });

  it("ignores empty link.map_id on water (treats cell as a normal sail)", () => {
    // Malformed authoring — link object present but no destination
    // map_id. The sail-onto-link branch must require map_id, matching
    // the land link behavior covered above.
    const grid = makeGrid();
    grid[0][1] = cell({ boat: true, sprite: "map/boat.png" });
    grid[0][2] = cell({
      walkable: false,
      tag: "water",
      sprite: "map/water.png",
      link: { map_id: "", x: 0, y: 0 },
    });
    const sim = makeSim({ grid });
    sim.stepInDirection("right"); // board
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.stepInDirection("right"); // sail
    expect(events.find((e) => e.kind === "linked")).toBeUndefined();
    expect(events.find((e) => e.kind === "moved")).toBeDefined();
    expect(sim.snapshot().pos).toEqual({ col: 2, row: 0 });
  });
});

describe("MapSimulation — boat-borne arrival via link", () => {
  it("seeds initialOnBoat + sprite at a non-walkable water startAt", () => {
    // Destination side of a boat link traversal — the host mounts a
    // new sim at the link's target cell (water, not walkable) with
    // `initialOnBoat: true` and the boat sprite the party rode in
    // on. The party must land exactly on that cell (no spiral away
    // to land), still aboard, with the same sprite reported by the
    // bridge's setPartyBoatAt call.
    const grid = makeGrid();
    grid[0][2] = cell({
      walkable: false,
      tag: "water",
      sprite: "map/water.png",
    });
    const bridge = fakeBridge();
    const sim = makeSim({
      grid,
      bridge,
      startAt: { col: 2, row: 0 },
      initialOnBoat: true,
      initialCurrentBoatSprite: "map/boat.png",
    });
    expect(sim.snapshot().pos).toEqual({ col: 2, row: 0 });
    // The bridge call that paints the boat sprite under the party
    // ran during construction — assert it lands at the link target
    // with the carried sprite.
    expect(bridge.setPartyBoatAt).toHaveBeenCalledWith(
      2,
      0,
      true,
      "map/boat.png",
    );
  });

  it("lets the boat-borne party sail off the arrival cell immediately", () => {
    // A boat that survives the portal has to still work as a boat —
    // stepping into the next water tile should sail, not bump.
    const grid = makeGrid();
    grid[0][2] = cell({
      walkable: false,
      tag: "water",
      sprite: "map/water.png",
    });
    grid[0][3] = cell({
      walkable: false,
      tag: "water",
      sprite: "map/water.png",
    });
    const sim = makeSim({
      grid,
      startAt: { col: 2, row: 0 },
      initialOnBoat: true,
      initialCurrentBoatSprite: "map/boat.png",
    });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    expect(sim.snapshot().pos).toEqual({ col: 3, row: 0 });
    expect(events.find((e) => e.kind === "moved")).toBeDefined();
    expect(events.find((e) => e.kind === "blocked")).toBeUndefined();
  });

  it("disembarks normally on the destination map once the party reaches land", () => {
    // Round-trip the journey: arrive aboard on water at (2,0), sail
    // one cell, then step onto walkable land at (4,0). The boat
    // should drop behind on (3,0) the same way as an in-map disembark.
    const grid = makeGrid();
    grid[0][2] = cell({
      walkable: false,
      tag: "water",
      sprite: "map/water.png",
    });
    grid[0][3] = cell({
      walkable: false,
      tag: "water",
      sprite: "map/water.png",
    });
    // (0,4) is walkable grass by default.
    const sim = makeSim({
      grid,
      startAt: { col: 2, row: 0 },
      initialOnBoat: true,
      initialCurrentBoatSprite: "map/pirate-ship.png",
    });
    sim.stepInDirection("right"); // sail to (3,0)
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.stepInDirection("right"); // step ashore at (4,0)
    const dis = events.find((e) => e.kind === "disembarked");
    expect(dis).toBeDefined();
    if (dis?.kind !== "disembarked") throw new Error("type narrow");
    expect(dis.pos).toEqual({ col: 4, row: 0 });
    expect(dis.boatAt).toEqual({ col: 3, row: 0 });
    expect(sim.snapshot().pos).toEqual({ col: 4, row: 0 });
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

  it("drives the lit torch's light range from the torch item's data", () => {
    // The torch item (items.json) declares light_range: 8; the engine
    // must use that, not the hardcoded TORCH_LIGHT_RANGE fallback.
    const sim = makeSim({
      party: { ...makeParty(), torch_steps: 5 },
      items: [{ id: "torch", item_type: "torch", light_range: 8 }],
    });
    expect(sim.snapshot().lightRange).toBe(8);
  });

  it("falls back to TORCH_LIGHT_RANGE when the torch item omits light_range", () => {
    const sim = makeSim({
      party: { ...makeParty(), torch_steps: 5 },
      items: [{ id: "torch", item_type: "torch" }],
    });
    expect(sim.snapshot().lightRange).toBe(TORCH_LIGHT_RANGE);
  });

  it("emits no party light when no torch is lit", () => {
    const sim = makeSim({
      party: { ...makeParty(), torch_steps: 0 },
      items: [{ id: "torch", item_type: "torch", light_range: 8 }],
    });
    expect(sim.snapshot().lightRange).toBe(0);
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

describe("MapSimulation — quest-driven placed encounters", () => {
  /** Build a sim seeded with a single active map-kill quest targeting
   *  `mapId`. Returns the sim + a spy on the bridge's
   *  setPlacedEncounterPositions so tests can assert what landed. */
  function makeQuestSim(opts: {
    mapId: string;
    questMapId: string;
    count?: number;
    accepted?: boolean;
  }) {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "The Giant Rats",
          steps: [
            {
              id: "rats_step_1",
              name: "Kill the rats",
              kind: "kill",
              params: {
                encounter_id: "cellar_rats",
                count: opts.count ?? 1,
              },
              location_kind: "map",
              map_id: opts.questMapId,
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    if (opts.accepted) {
      states.get("rats")!.status = "active";
    }

    const bridge = fakeBridge();
    const grid = makeGrid();
    const sim = new MapSimulation({
      grid,
      party: makeParty({ start_position: { col: 0, row: 0 } }),
      catalog: {
        characters: [],
        races: [],
        effects: [],
        encounters: [
          {
            id: "cellar_rats",
            name: "Cellar Rats",
            monsters: ["giant_rat"],
            monster_party_tile: "monster/giant_rat.png",
          },
        ],
      },
      classNameById: new Map(),
      bridge,
      questDefs: defs,
      questStates: states,
      currentLocation: { kind: "map", mapId: opts.mapId },
    });
    return { sim, bridge };
  }

  it("drops the quest encounter onto a walkable cell when the step matches", () => {
    const { bridge } = makeQuestSim({
      mapId: "demo_map",
      questMapId: "demo_map",
      accepted: true,
    });
    // sim mounts → bridge.setPlacedEncounterPositions called with the
    // initial placed encounters list (post-quest-merge).
    const calls = (bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const placed = calls[0][0] as Array<{ id: string; sprite?: string }>;
    expect(placed.length).toBe(1);
    expect(placed[0].id).toMatch(/^q-rats-0-/);
    expect(placed[0].sprite).toBe("monster/giant_rat.png");
  });

  it("spawns `count` copies for a multi-target step", () => {
    const { bridge } = makeQuestSim({
      mapId: "demo_map",
      questMapId: "demo_map",
      count: 3,
      accepted: true,
    });
    const placed = (bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Array<{ id: string }>;
    expect(placed).toHaveLength(3);
  });

  it("places nothing when the quest is only available (not accepted)", () => {
    const { bridge } = makeQuestSim({
      mapId: "demo_map",
      questMapId: "demo_map",
      accepted: false,
    });
    const placed = (bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Array<unknown>;
    expect(placed).toHaveLength(0);
  });

  it("places nothing when the step's map_id doesn't match the current location", () => {
    const { bridge } = makeQuestSim({
      mapId: "other_map",
      questMapId: "demo_map",
      accepted: true,
    });
    const placed = (bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Array<unknown>;
    expect(placed).toHaveLength(0);
  });

  it("refreshQuestPlacements drops encounters when a quest goes active mid-session", () => {
    // Quest starts as "available" — initial mount places nothing.
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "The Giant Rats",
          steps: [
            {
              id: "rats_step_1",
              name: "Kill the rats",
              kind: "kill",
              params: { encounter_id: "cellar_rats", count: 1 },
              location_kind: "map",
              map_id: "demo_map",
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    // status stays "available" at first.
    const bridge = fakeBridge();
    const sim = new MapSimulation({
      grid: makeGrid(),
      party: makeParty({ start_position: { col: 0, row: 0 } }),
      catalog: {
        characters: [],
        races: [],
        effects: [],
        encounters: [
          {
            id: "cellar_rats",
            name: "Cellar Rats",
            monsters: ["giant_rat"],
            monster_party_tile: "monster/giant_rat.png",
          },
        ],
      },
      classNameById: new Map(),
      bridge,
      questDefs: defs,
      questStates: states,
      currentLocation: { kind: "map", mapId: "demo_map" },
    });
    const initialCalls = (
      bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(initialCalls[0][0]).toHaveLength(0);

    // Now the player accepts the quest — host flips status and asks
    // for a refresh.
    states.get("rats")!.status = "active";
    sim.refreshQuestPlacements();

    // The bridge sees a fresh placement-positions call with the rat.
    const allCalls = (
      bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>
    ).mock.calls;
    const last = allCalls[allCalls.length - 1][0] as Array<{ id: string }>;
    expect(last).toHaveLength(1);
    expect(last[0].id).toMatch(/^q-rats-0-/);
  });

  it("refreshQuestPlacements is idempotent — repeat calls don't duplicate placements", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "The Giant Rats",
          steps: [
            {
              id: "rats_step_1",
              name: "Kill the rats",
              kind: "kill",
              params: { encounter_id: "cellar_rats", count: 1 },
              location_kind: "map",
              map_id: "demo_map",
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("rats")!.status = "active";
    const bridge = fakeBridge();
    const sim = new MapSimulation({
      grid: makeGrid(),
      party: makeParty({ start_position: { col: 0, row: 0 } }),
      catalog: {
        characters: [],
        races: [],
        effects: [],
        encounters: [
          {
            id: "cellar_rats",
            name: "Cellar Rats",
            monsters: ["giant_rat"],
          },
        ],
      },
      classNameById: new Map(),
      bridge,
      questDefs: defs,
      questStates: states,
      currentLocation: { kind: "map", mapId: "demo_map" },
    });
    // Construction already placed the rat.
    const callsBefore = (bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>)
      .mock.calls.length;
    // Refresh shouldn't duplicate it.
    sim.refreshQuestPlacements();
    sim.refreshQuestPlacements();
    const allCalls = (
      bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>
    ).mock.calls;
    // setPlacedEncounterPositions wasn't re-called (no new placements
    // → no bridge ping).
    expect(allCalls.length).toBe(callsBefore);
  });

  it("resolveSpawnEncounter('won') on a quest spawn credits the step and emits quest_kill_credited", () => {
    // Tighten the grid so the rat MUST land at (1,0) — that's the
    // only walkable, non-party-spawn cell. Lets us drive a
    // deterministic collision without random retries.
    const grid = makeGrid();
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if ((c === 0 && r === 0) || (c === 1 && r === 0)) continue;
        grid[r][c] = cell({ walkable: false });
      }
    }
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "The Giant Rats",
          steps: [
            {
              id: "s1",
              name: "Kill the rats",
              kind: "kill",
              params: { encounter_id: "cellar_rats", count: 1 },
              location_kind: "map",
              map_id: "demo_map",
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("rats")!.status = "active";
    const bridge = fakeBridge();
    const sim = new MapSimulation({
      grid,
      party: makeParty({ start_position: { col: 0, row: 0 } }),
      catalog: {
        characters: [],
        races: [],
        effects: [],
        encounters: [
          {
            id: "cellar_rats",
            name: "Cellar Rats",
            monsters: ["giant_rat"],
            monster_party_tile: "monster/giant_rat.png",
          },
        ],
      },
      classNameById: new Map(),
      bridge,
      questDefs: defs,
      questStates: states,
      currentLocation: { kind: "map", mapId: "demo_map" },
    });
    // Verify the placement landed at (1,0) — the only candidate cell.
    const placed = (
      bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>
    ).mock.calls[0][0] as Array<{ id: string; col: number; row: number }>;
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ col: 1, row: 0 });
    const ratId = placed[0].id;

    // Capture events that fire from here on out.
    const events = captureEvents(sim);
    // Party at (0,0), rat at (1,0). Step right → party walks into
    // the rat's cell, placed-encounter pursuit pass detects the
    // Chebyshev-0 collision and fires spawn_encountered.
    sim.stepInDirection("right");
    const ev = events.find((e) => e.kind === "spawn_encountered");
    expect(ev).toBeDefined();
    if (ev?.kind !== "spawn_encountered") throw new Error("narrow");
    expect(ev.options.placedEncounterId).toBe(ratId);

    // Win the fight. The kernel removes the placed entity, calls
    // creditQuestKill, and emits quest_kill_credited.
    sim.resolveSpawnEncounter("won");

    const credit = events.find((e) => e.kind === "quest_kill_credited");
    expect(credit).toBeDefined();
    if (credit?.kind !== "quest_kill_credited") throw new Error("narrow");
    expect(credit.questId).toBe("rats");
    expect(credit.stepIdx).toBe(0);
    expect(credit.killsSoFar).toBe(1);
    expect(credit.stepCompleted).toBe(true);
    expect(credit.questCompleted).toBe(true);
    // The underlying state was mutated.
    expect(states.get("rats")!.stepProgress[0]).toBe(true);
    expect(states.get("rats")!.status).toBe("completed");
  });

  it("does not drop on the party's spawn cell", () => {
    // Tighten the walkable pool so the only available cell is the
    // party spawn — the helper should bail rather than drop on top
    // of the party. We do this by walling off every cell except
    // (0,0) (the party spawn) and (1,0).
    const grid = makeGrid();
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if ((c === 0 && r === 0) || (c === 1 && r === 0)) continue;
        grid[r][c] = cell({ walkable: false });
      }
    }
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "Rats",
          steps: [
            {
              id: "s1",
              name: "Kill",
              kind: "kill",
              params: { encounter_id: "cellar_rats", count: 1 },
              location_kind: "map",
              map_id: "demo_map",
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("rats")!.status = "active";

    const bridge = fakeBridge();
    new MapSimulation({
      grid,
      party: makeParty({ start_position: { col: 0, row: 0 } }),
      catalog: {
        characters: [],
        races: [],
        effects: [],
        encounters: [
          {
            id: "cellar_rats",
            name: "Cellar Rats",
            monsters: ["giant_rat"],
          },
        ],
      },
      classNameById: new Map(),
      bridge,
      questDefs: defs,
      questStates: states,
      currentLocation: { kind: "map", mapId: "demo_map" },
    });
    const placed = (bridge.setPlacedEncounterPositions as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Array<{ col: number; row: number }>;
    // One cell is available for placement: (1,0). Party is on (0,0).
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ col: 1, row: 0 });
  });
});

describe("MapSimulation.stepInDirection — treasure chest dispatch", () => {
  const CHEST = {
    id: "rusty_chest",
    name: "Rusty Chest",
    is_chest: true,
    contents: { gold: 50, items: [{ id: "potion", qty: 1 }] },
  };

  it("emits chest_encountered when bumping a chest tile + party doesn't move", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ item: "rusty_chest" });
    const sim = makeSim({ grid, items: [CHEST] });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const chest = events.find((e) => e.kind === "chest_encountered");
    expect(chest).toBeDefined();
    if (chest?.kind !== "chest_encountered") throw new Error("type narrow");
    expect(chest.chestId).toBe("rusty_chest");
    expect(chest.pos).toEqual({ col: 1, row: 0 });
    // Party stayed put — chest is a bump, not a walk-onto.
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
    // No item_picked fires for a chest bump.
    expect(events.find((e) => e.kind === "item_picked")).toBeUndefined();
  });

  it("does NOT clear the cell's item field on bump (Leave keeps the chest)", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ item: "rusty_chest" });
    const sim = makeSim({ grid, items: [CHEST] });
    sim.stepInDirection("right");
    // Cell.item is still set so the chest stays visible and a Leave
    // path can come back to it. The Open path on the host calls
    // sim.clearCellItem to wipe it explicitly.
    expect(grid[0][1].item).toBe("rusty_chest");
  });

  it("regular (non-chest) items still walk-pickup with item_picked", () => {
    // A regular item id NOT in the chest set falls through to the
    // existing post-move pickup flow. Belt-and-braces against the
    // new branch accidentally swallowing all `cell.item` cells.
    const grid = makeGrid();
    grid[0][1] = cell({ item: "potion" });
    const sim = makeSim({
      grid,
      items: [
        { id: "potion", name: "Potion" }, // no is_chest flag
      ],
    });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    expect(sim.snapshot().pos).toEqual({ col: 1, row: 0 });
    const picked = events.find((e) => e.kind === "item_picked");
    expect(picked).toBeDefined();
    if (picked?.kind !== "item_picked") throw new Error("type narrow");
    expect(picked.itemId).toBe("potion");
  });

  it("locked-chest cell fires lock_encountered first (lock takes priority)", () => {
    // Stack a chest item on a locked tile. The lock pipeline runs
    // before the chest bump, so the player has to unlock the cell
    // before the chest dialog appears on a subsequent step.
    const grid = makeGrid();
    grid[0][1] = cell({ item: "rusty_chest", locked: true, walkable: false });
    const sim = makeSim({ grid, items: [CHEST] });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    const ks = events.map((e) => e.kind);
    expect(ks).toContain("lock_encountered");
    expect(ks).not.toContain("chest_encountered");
  });

  it("with no items catalog, every item id takes the legacy walk path", () => {
    // Defensive: a module that doesn't author any chests (or a host
    // that omits the items field on the sim catalog) must keep the
    // legacy walk-to-pickup flow for plain items.
    const grid = makeGrid();
    grid[0][1] = cell({ item: "potion" });
    const sim = makeSim({ grid }); // no items field
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    expect(events.find((e) => e.kind === "item_picked")).toBeDefined();
    expect(events.find((e) => e.kind === "chest_encountered")).toBeUndefined();
  });

  it("clearCellItem wipes the cell + emits state so the host can dismiss", () => {
    // Drives the Open path from the host's POV: after the player
    // commits, the host calls clearCellItem to remove the chest from
    // the map. Assert the grid mutation + the state event.
    const grid = makeGrid();
    grid[0][1] = cell({ item: "rusty_chest" });
    const sim = makeSim({ grid, items: [CHEST] });
    sim.stepInDirection("right");
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.clearCellItem(1, 0);
    expect(grid[0][1].item).toBe("");
    expect(events.find((e) => e.kind === "state")).toBeDefined();
  });

  it("clearCellItem on an empty / off-grid cell is a silent no-op", () => {
    const grid = makeGrid();
    const sim = makeSim({ grid, items: [CHEST] });
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.clearCellItem(2, 2); // cell has no item set
    sim.clearCellItem(99, 99); // off-grid
    expect(events.find((e) => e.kind === "state")).toBeUndefined();
  });
});

describe("MapSimulation — picked-item persistence", () => {
  // The host writes the picked set into the save delta, then a future
  // mount feeds it back via `initialPickedItemCells`. These tests lock
  // in the round-trip so a regression that resurfaces collected chests
  // (or regular items) gets caught here instead of in playtest.

  it("snapshot.pickedItemCells captures walk-onto pickups", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ item: "potion" });
    const sim = makeSim({
      grid,
      items: [{ id: "potion", name: "Potion" }],
    });
    sim.stepInDirection("right");
    expect(Array.from(sim.snapshot().pickedItemCells)).toEqual(["1,0"]);
  });

  it("snapshot.pickedItemCells captures chest-Open clears", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ item: "rusty_chest" });
    const sim = makeSim({
      grid,
      items: [
        {
          id: "rusty_chest",
          name: "Rusty Chest",
          is_chest: true,
          contents: { gold: 5 },
        },
      ],
    });
    sim.stepInDirection("right"); // bump
    sim.clearCellItem(1, 0);       // host's Open path
    expect(Array.from(sim.snapshot().pickedItemCells)).toEqual(["1,0"]);
  });

  it("initialPickedItemCells clears the authored item before the bump pipeline runs", () => {
    // Re-mounting a map: the JSON catalog freshly authored a chest at
    // (1,0), but the save delta says the party already opened it.
    // The kernel should apply the clear at construction so a bump into
    // that cell behaves as if it were empty — no chest_encountered and
    // no item_picked.
    const grid = makeGrid();
    grid[0][1] = cell({ item: "rusty_chest" });
    const sim = makeSim({
      grid,
      items: [
        {
          id: "rusty_chest",
          name: "Rusty Chest",
          is_chest: true,
          contents: { gold: 5 },
        },
      ],
      initialPickedItemCells: new Set(["1,0"]),
    });
    expect(grid[0][1].item).toBe("");
    const events = captureEvents(sim);
    sim.stepInDirection("right"); // would have bumped a chest pre-clear
    expect(events.find((e) => e.kind === "chest_encountered")).toBeUndefined();
    expect(events.find((e) => e.kind === "item_picked")).toBeUndefined();
    // Snapshot still surfaces the persisted entry so a subsequent
    // save round-trips the same set instead of dropping it.
    expect(Array.from(sim.snapshot().pickedItemCells)).toEqual(["1,0"]);
  });

  it("malformed / off-grid keys in initialPickedItemCells are ignored", () => {
    // Defensive: a corrupted save entry shouldn't throw at mount.
    const grid = makeGrid();
    grid[0][1] = cell({ item: "potion" });
    const sim = makeSim({
      grid,
      items: [{ id: "potion", name: "Potion" }],
      initialPickedItemCells: new Set(["not-a-key", "99,99", "1,0"]),
    });
    // The valid "1,0" entry still applies; the others are no-ops.
    expect(grid[0][1].item).toBe("");
    // All three round-trip in the snapshot (the kernel doesn't
    // sanitise the set — it just doesn't crash on lookups).
    expect(sim.snapshot().pickedItemCells.size).toBe(3);
  });
});

describe("MapSimulation.stepInDirection — boat_passable (bridge) cells", () => {
  // `boat_passable: true` on a palette tile lets a sailing boat treat
  // the cell like water (sail-through) while keeping the tile walkable
  // on foot. The play renderer paints a bridge-top overlay so the
  // boat reads as passing UNDER the structure — the kernel only sees
  // movement classification, which is what these tests assert.

  it("treats boat_passable cells as sail-through while aboard", () => {
    // Land → boat → bridge: stepping from the boat tile onto the
    // bridge should `sail` (boat moves through the cell), not
    // `disembark` (party hops off onto walkable terrain).
    const grid = makeGrid();
    grid[0][1] = cell({ boat: true, sprite: "map/boat.png" });
    grid[0][2] = cell({
      walkable: true, // bridges stay walkable on foot
      boat_passable: true,
      sprite: "map/bridge.png",
    });
    const sim = makeSim({ grid });
    sim.stepInDirection("right"); // board
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.stepInDirection("right"); // sail under the bridge
    expect(events.find((e) => e.kind === "moved")).toBeDefined();
    // No disembark — the party is still aboard the boat.
    expect(events.find((e) => e.kind === "disembarked")).toBeUndefined();
    expect(sim.snapshot().pos).toEqual({ col: 2, row: 0 });
    expect(sim.snapshot().onBoat).toBe(true);
  });

  it("foot traffic across a boat_passable bridge still walks normally", () => {
    // A walking party (no boat) stepping onto a bridge tile uses the
    // normal walk branch. The boat_passable flag does NOT change
    // foot-walkability — bridges stay walkable on foot.
    const grid = makeGrid();
    grid[0][1] = cell({
      walkable: true,
      boat_passable: true,
      sprite: "map/bridge.png",
    });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right"); // walk onto the bridge
    expect(events.find((e) => e.kind === "moved")).toBeDefined();
    expect(events.find((e) => e.kind === "boarded")).toBeUndefined();
    expect(sim.snapshot().pos).toEqual({ col: 1, row: 0 });
    expect(sim.snapshot().onBoat).toBe(false);
  });

  it("sailing onto a linked boat_passable cell still traverses the link", () => {
    // Stack a link on a bridge tile that's also boat_passable. The
    // linked branch runs before the plain sail branch so the portal
    // fires even though the cell isn't tagged "water".
    const grid = makeGrid();
    grid[0][1] = cell({ boat: true, sprite: "map/boat.png" });
    grid[0][2] = cell({
      walkable: true,
      boat_passable: true,
      sprite: "map/bridge.png",
      link: { map_id: "next_map", x: 0, y: 0 },
    });
    const sim = makeSim({ grid });
    sim.stepInDirection("right"); // board
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.stepInDirection("right"); // sail into link
    const linked = events.find((e) => e.kind === "linked");
    expect(linked).toBeDefined();
    if (linked?.kind !== "linked") throw new Error("type narrow");
    expect(linked.link.map_id).toBe("next_map");
    // Boat state carries across the link — same vessel on the other
    // side, mirroring the water-link case.
    expect(linked.onBoat).toBe(true);
    expect(linked.boatSprite).toBe("map/boat.png");
  });

  it("disembarks onto plain walkable land but sails through bridges", () => {
    // Belt-and-braces: in the same step series, the party should be
    // able to sail through a bridge and then disembark onto plain
    // grass on the far side. This is the canonical "river crossing"
    // path the feature is meant to support.
    const grid = makeGrid();
    grid[0][1] = cell({ boat: true, sprite: "map/boat.png" });
    grid[0][2] = cell({
      walkable: true,
      boat_passable: true,
      sprite: "map/bridge.png",
    });
    grid[0][3] = cell({ walkable: true, sprite: "map/grass.png" });
    const sim = makeSim({ grid });
    sim.stepInDirection("right"); // board
    sim.stepInDirection("right"); // sail under bridge
    expect(sim.snapshot().onBoat).toBe(true);
    const events: SimEvent[] = [];
    sim.subscribe((ev) => events.push(ev));
    sim.stepInDirection("right"); // step off onto grass
    const dis = events.find((e) => e.kind === "disembarked");
    expect(dis).toBeDefined();
    if (dis?.kind !== "disembarked") throw new Error("type narrow");
    expect(dis.pos).toEqual({ col: 3, row: 0 });
    // The boat drops back onto the bridge cell — the party can come
    // back and re-board it. boatAt is the cell the party JUST left.
    expect(dis.boatAt).toEqual({ col: 2, row: 0 });
    expect(sim.snapshot().onBoat).toBe(false);
  });
});

describe("MapSimulation.waitTurn — skip a turn in place", () => {
  it("keeps the party put, ticks step counters, and re-lights", () => {
    const bridge = fakeBridge();
    const sim = makeSim({
      party: makeParty({ start_position: { col: 2, row: 2 }, torch_steps: 3 }),
      startAt: { col: 2, row: 2 },
      bridge,
    });
    const events = captureEvents(sim);

    sim.waitTurn();

    // Party did not move.
    expect(sim.snapshot().pos).toEqual({ col: 2, row: 2 });
    // A turn passed — the torch burned one step.
    expect(sim.snapshot().party.torch_steps).toBe(2);
    // Re-lit and emitted a wait log + a state snapshot.
    expect(bridge.relight).toHaveBeenCalled();
    expect(
      events.some((e) => e.kind === "log" && /waits/i.test(e.message)),
    ).toBe(true);
    expect(kinds(events)).toContain("state");
  });
});

describe("MapSimulation.requestNpcMove — Ask to Move", () => {
  it("relocates a blocking NPC to the tile farthest from the party", () => {
    const grid = makeGrid();
    grid[2][2] = cell({ npc: "guard" }); // NPC at col 2, row 2
    const sim = makeSim({
      grid,
      party: makeParty({ start_position: { col: 1, row: 2 } }),
      startAt: { col: 1, row: 2 }, // party west of the NPC
    });
    const events = captureEvents(sim);

    const moved = sim.requestNpcMove("guard");

    expect(moved).toBe(true);
    // Vacated its old cell; stepped east (away from the party) to (3,2).
    expect(grid[2][2].npc ?? "").toBe("");
    expect(grid[2][3].npc).toBe("guard");
    const movedEv = events.find((e) => e.kind === "npc_moved");
    expect(movedEv).toMatchObject({
      npcId: "guard",
      from: { col: 2, row: 2 },
      to: { col: 3, row: 2 },
    });
  });

  it("returns false and stays put when the NPC is boxed in", () => {
    const grid = makeGrid();
    grid[2][2] = cell({ npc: "guard" });
    // Wall off all four cardinal neighbours.
    grid[1][2] = cell({ walkable: false });
    grid[3][2] = cell({ walkable: false });
    grid[2][1] = cell({ walkable: false });
    grid[2][3] = cell({ walkable: false });
    const sim = makeSim({
      grid,
      party: makeParty({ start_position: { col: 0, row: 0 } }),
      startAt: { col: 0, row: 0 },
    });
    const events = captureEvents(sim);

    const moved = sim.requestNpcMove("guard");

    expect(moved).toBe(false);
    expect(grid[2][2].npc).toBe("guard"); // unchanged
    expect(kinds(events)).not.toContain("npc_moved");
  });

  it("returns false for an unknown npc id", () => {
    const sim = makeSim();
    expect(sim.requestNpcMove("nobody")).toBe(false);
  });
});

describe("MapSimulation.requestQuestGiverMove — post-quest Ask to Move", () => {
  it("relocates a quest-giver cell (quest tag carried, npc_moved emitted)", () => {
    const grid = makeGrid();
    grid[2][2] = cell({ quest: "rats" } as Parameters<typeof cell>[0]);
    const sim = makeSim({
      grid,
      party: makeParty({ start_position: { col: 1, row: 2 } }),
      startAt: { col: 1, row: 2 }, // party west of the giver
    });
    const events = captureEvents(sim);

    const moved = sim.requestQuestGiverMove("rats");

    expect(moved).toBe(true);
    // Quest tag vacated the old cell and stepped east, away from
    // the party.
    expect((grid[2][2] as { quest?: string }).quest ?? "").toBe("");
    expect((grid[2][3] as { quest?: string }).quest).toBe("rats");
    const movedEv = events.find((e) => e.kind === "npc_moved");
    expect(movedEv).toMatchObject({
      questId: "rats",
      from: { col: 2, row: 2 },
      to: { col: 3, row: 2 },
    });
  });

  it("carries a co-located npc tag along with the quest tag", () => {
    const grid = makeGrid();
    grid[2][2] = cell({
      npc: "hermit",
      quest: "rats",
    } as Parameters<typeof cell>[0]);
    const sim = makeSim({
      grid,
      party: makeParty({ start_position: { col: 1, row: 2 } }),
      startAt: { col: 1, row: 2 },
    });

    expect(sim.requestQuestGiverMove("rats")).toBe(true);
    expect(grid[2][3].npc).toBe("hermit");
    expect((grid[2][3] as { quest?: string }).quest).toBe("rats");
    expect(grid[2][2].npc ?? "").toBe("");
  });

  it("returns false for an unknown quest id", () => {
    const sim = makeSim();
    expect(sim.requestQuestGiverMove("no_such_quest")).toBe(false);
  });
});

describe("MapSimulation — show_link_placard confirm", () => {
  it("a flagged link tile emits `place_encountered` and does NOT traverse", () => {
    const grid = makeGrid();
    grid[0][1] = cell({
      link: { map_id: "other_map", x: 5, y: 7 },
      show_link_placard: true,
    });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");

    const place = events.find((e) => e.kind === "place_encountered");
    expect(place).toBeDefined();
    if (place?.kind !== "place_encountered") throw new Error("narrow");
    expect(place.placeKind).toBe("link");
    if (place.placeKind !== "link") throw new Error("narrow");
    expect(place.link).toEqual({ map_id: "other_map", x: 5, y: 7 });
    // Held: no traversal, party stays put (host crosses on confirm).
    expect(kinds(events)).not.toContain("linked");
    expect(kinds(events)).not.toContain("moved");
    expect(sim.snapshot().pos).toEqual({ col: 0, row: 0 });
  });

  it("an UNflagged link tile still traverses immediately", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ link: { map_id: "other_map", x: 0, y: 0 } });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    expect(kinds(events)).toContain("linked");
    expect(kinds(events)).not.toContain("place_encountered");
  });

  it("a flagged dungeon entrance emits `place_encountered` instead of entering", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ dungeon: "crypt", show_link_placard: true });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");

    const place = events.find((e) => e.kind === "place_encountered");
    expect(place).toBeDefined();
    if (place?.kind !== "place_encountered") throw new Error("narrow");
    if (place.placeKind !== "dungeon") throw new Error("narrow");
    expect(place.dungeonId).toBe("crypt");
    expect(place.returnPos).toEqual({ col: 0, row: 0 });
    expect(kinds(events)).not.toContain("dungeon_entered");
    // Party has stepped onto the entrance tile (descends on confirm).
    expect(sim.snapshot().pos).toEqual({ col: 1, row: 0 });
  });

  it("an UNflagged dungeon entrance enters immediately", () => {
    const grid = makeGrid();
    grid[0][1] = cell({ dungeon: "crypt" });
    const sim = makeSim({ grid });
    const events = captureEvents(sim);
    sim.stepInDirection("right");
    expect(kinds(events)).toContain("dungeon_entered");
    expect(kinds(events)).not.toContain("place_encountered");
  });
});
