import { describe, it, expect } from "vitest";
import { questsTargetingPlace } from "./questPlacardTargets";
import type { QuestDef, QuestState, QuestStep } from "@/battle/world/Quests";

function step(over: Partial<QuestStep>): QuestStep {
  return {
    id: "s",
    name: "Step",
    description: "",
    tags: [],
    kind: "kill",
    params: {},
    locationKind: "",
    mapId: "",
    dungeonId: "",
    col: 0,
    row: 0,
    encounterId: "",
    count: 1,
    itemId: "",
    positions: [],
    rewards: { items: [], returnItems: [], tileAdds: [] },
    ...over,
  };
}

function quest(id: string, name: string, steps: QuestStep[]): QuestDef {
  return {
    id,
    name,
    description: "",
    tags: [],
    steps,
    questGiver: { npcName: "", npcSprite: "", startDialog: "", endDialog: "" },
    rewards: { xp: 0, gold: 0, items: [], tileAdds: [] },
  };
}

function state(
  status: QuestState["status"],
  stepProgress: boolean[],
): QuestState {
  return { status, stepProgress, stepKills: {}, guardianDefeated: {} };
}

const ratQuest = quest("rats", "Rat Problem", [
  step({ id: "talk", name: "Talk to the mayor" }),
  step({
    id: "clear",
    name: "Clear the rat patrols",
    locationKind: "map",
    mapId: "sewer_map",
  }),
  step({
    id: "boss",
    name: "Slay the Rat King",
    locationKind: "map",
    mapId: "sewer_map",
  }),
]);

const spelunkQuest = quest("spelunk", "Spelunk the Grotto", [
  step({
    id: "floor1",
    name: "Descend: Mouth",
    kind: "reach",
    locationKind: "dungeon",
    dungeonId: "grotto",
    dungeonLevel: 1,
  }),
  step({
    id: "floor2",
    name: "Descend: The Deep",
    kind: "reach",
    locationKind: "dungeon",
    dungeonId: "grotto",
    dungeonLevel: 2,
  }),
]);

describe("questsTargetingPlace", () => {
  it("reports an active quest's first incomplete step on the destination map", () => {
    const states = new Map([["rats", state("active", [true, false, false])]]);
    const out = questsTargetingPlace([ratQuest], states, {
      placeKind: "link",
      mapId: "sewer_map",
    });
    expect(out).toEqual([
      {
        questId: "rats",
        questName: "Rat Problem",
        stepId: "clear",
        stepName: "Clear the rat patrols",
      },
    ]);
  });

  it("skips completed steps — reports the NEXT objective on that map", () => {
    const states = new Map([["rats", state("active", [true, true, false])]]);
    const out = questsTargetingPlace([ratQuest], states, {
      placeKind: "link",
      mapId: "sewer_map",
    });
    expect(out.map((t) => t.stepId)).toEqual(["boss"]);
  });

  it("returns nothing for maps no active step targets", () => {
    const states = new Map([["rats", state("active", [false, false, false])]]);
    const out = questsTargetingPlace([ratQuest], states, {
      placeKind: "link",
      mapId: "town_square",
    });
    expect(out).toEqual([]);
  });

  it("ignores quests that aren't active (available / completed / turned_in)", () => {
    for (const status of ["available", "completed", "turned_in"] as const) {
      const states = new Map([
        ["rats", state(status, [false, false, false])],
      ]);
      expect(
        questsTargetingPlace([ratQuest], states, {
          placeKind: "link",
          mapId: "sewer_map",
        }),
      ).toEqual([]);
    }
  });

  it("ignores quests with no runtime state at all", () => {
    const out = questsTargetingPlace([ratQuest], new Map(), {
      placeKind: "link",
      mapId: "sewer_map",
    });
    expect(out).toEqual([]);
  });

  it("matches dungeon placards by dungeonId regardless of floor", () => {
    const states = new Map([["spelunk", state("active", [true, false])]]);
    const out = questsTargetingPlace([spelunkQuest], states, {
      placeKind: "dungeon",
      dungeonId: "grotto",
    });
    expect(out.map((t) => t.stepId)).toEqual(["floor2"]);
  });

  it("never matches a map placard against dungeon steps (and vice versa)", () => {
    const states = new Map([
      ["rats", state("active", [false, false, false])],
      ["spelunk", state("active", [false, false])],
    ]);
    expect(
      questsTargetingPlace([ratQuest, spelunkQuest], states, {
        placeKind: "dungeon",
        dungeonId: "sewer_map",
      }),
    ).toEqual([]);
    expect(
      questsTargetingPlace([ratQuest, spelunkQuest], states, {
        placeKind: "link",
        mapId: "grotto",
      }),
    ).toEqual([]);
  });

  it("reports one line per quest even when several quests share the destination", () => {
    const otherQuest = quest("amulet", "The Lost Amulet", [
      step({
        id: "search",
        name: "Search the sewers",
        locationKind: "map",
        mapId: "sewer_map",
      }),
    ]);
    const states = new Map([
      ["rats", state("active", [true, false, false])],
      ["amulet", state("active", [false])],
    ]);
    const out = questsTargetingPlace([ratQuest, otherQuest], states, {
      placeKind: "link",
      mapId: "sewer_map",
    });
    expect(out.map((t) => t.questId)).toEqual(["rats", "amulet"]);
  });
});
