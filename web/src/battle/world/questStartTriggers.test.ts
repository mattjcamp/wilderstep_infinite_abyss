import { describe, expect, it } from "vitest";
import {
  ensureQuestStates,
  parseQuestsFile,
  parseStartTriggers,
  questsOnBoard,
  questsStartedBy,
  type QuestState,
} from "./Quests";

const file = {
  quests: [
    {
      id: "main",
      name: "Main",
      start_triggers: [{ kind: "game_start", message: "Your story begins." }],
      steps: [{ id: "s", kind: "discover", map_id: "town", col: 1, row: 1 }],
    },
    {
      id: "haunt",
      name: "Haunt",
      start_triggers: [
        { kind: "enter_map", map_id: "crypt" },
        { kind: "read_lore", lore_id: "ghost_note" },
      ],
      steps: [],
    },
    {
      id: "flee",
      name: "Flee",
      start_triggers: [{ kind: "leave_map", map_id: "town" }],
      steps: [],
    },
    { id: "rats", name: "Rats", boards: ["hallowmere_board"], steps: [] },
    { id: "wolves", name: "Wolves", boards: ["hallowmere_board", "inn"], steps: [] },
  ],
};

function setup() {
  const defs = parseQuestsFile(file);
  const states = new Map<string, QuestState>();
  ensureQuestStates(defs, states);
  return { defs, states };
}

describe("parseStartTriggers", () => {
  it("drops unknown kinds and triggers missing their id", () => {
    const t = parseStartTriggers([
      { kind: "enter_map" },
      { kind: "read_lore", lore_id: "  " },
      { kind: "teleport", map_id: "x" },
      { kind: "leave_map", map_id: " town " },
      null,
    ]);
    expect(t).toEqual([{ kind: "leave_map", mapId: "town", loreId: "", message: "" }]);
  });
  it("returns [] for non-arrays", () => {
    expect(parseStartTriggers(undefined)).toEqual([]);
  });
});

describe("questsStartedBy", () => {
  it("matches each event kind", () => {
    const { defs, states } = setup();
    const ids = (ev: Parameters<typeof questsStartedBy>[2]) =>
      questsStartedBy(defs, states, ev).map((r) => r.def.id);
    expect(ids({ kind: "game_start" })).toEqual(["main"]);
    expect(ids({ kind: "enter_map", mapId: "crypt" })).toEqual(["haunt"]);
    expect(ids({ kind: "enter_map", mapId: "town" })).toEqual([]);
    expect(ids({ kind: "leave_map", mapId: "town" })).toEqual(["flee"]);
    expect(ids({ kind: "read_lore", loreId: "ghost_note" })).toEqual(["haunt"]);
  });
  it("carries the matching trigger's message", () => {
    const { defs, states } = setup();
    expect(questsStartedBy(defs, states, { kind: "game_start" })[0].trigger.message).toBe(
      "Your story begins.",
    );
  });
  it("skips quests that are no longer available", () => {
    const { defs, states } = setup();
    states.get("haunt")!.status = "active";
    expect(questsStartedBy(defs, states, { kind: "enter_map", mapId: "crypt" })).toEqual([]);
  });
});

describe("questsOnBoard", () => {
  it("lists available quests posted on the board", () => {
    const { defs, states } = setup();
    expect(questsOnBoard(defs, states, "hallowmere_board").map((d) => d.id)).toEqual([
      "rats",
      "wolves",
    ]);
    states.get("rats")!.status = "active";
    expect(questsOnBoard(defs, states, "hallowmere_board").map((d) => d.id)).toEqual(["wolves"]);
    expect(questsOnBoard(defs, states, "")).toEqual([]);
  });
});
