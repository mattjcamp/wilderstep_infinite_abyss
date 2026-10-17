import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPLORATION_XP,
  explorationRewardFor,
  markFirstTime,
  npcMeetKey,
  questGiverMeetKey,
  sanitizeExplorationXp,
  seedDiscoveredMaps,
  withExplorationDefaults,
} from "./explorationXp";

describe("exploration XP settings", () => {
  it("defaults to small amounts", () => {
    expect(DEFAULT_EXPLORATION_XP).toEqual({ map: 10, npc: 5 });
    expect(withExplorationDefaults(undefined)).toEqual({ map: 10, npc: 5 });
    expect(withExplorationDefaults({ npc: 0 })).toEqual({ map: 10, npc: 0 });
  });

  it("sanitises manifest values", () => {
    expect(sanitizeExplorationXp(undefined)).toBeUndefined();
    expect(sanitizeExplorationXp([1, 2])).toBeUndefined();
    expect(sanitizeExplorationXp({ map: -3, npc: "5" })).toBeUndefined();
    expect(sanitizeExplorationXp({ map: 12.7, npc: 0, junk: 4 })).toEqual({
      map: 12,
      npc: 0,
    });
  });
});

describe("explorationRewardFor", () => {
  it("uses the record override when valid, else the module amount", () => {
    expect(explorationRewardFor(undefined, 10)).toBe(10);
    expect(explorationRewardFor(null, 10)).toBe(10);
    expect(explorationRewardFor(0, 10)).toBe(0); // switched off
    expect(explorationRewardFor(40, 10)).toBe(40);
    expect(explorationRewardFor(-5, 10)).toBe(10);
    expect(explorationRewardFor("lots", 10)).toBe(10);
  });
});

describe("first-time tracking", () => {
  it("seeds the current map plus every map the save already knows", () => {
    expect(seedDiscoveredMaps("town", ["inn", "town"]).sort()).toEqual([
      "inn",
      "town",
    ]);
    expect(seedDiscoveredMaps("start", [])).toEqual(["start"]);
  });

  it("only reports firstTime once per key", () => {
    const a = markFirstTime(undefined, "inn");
    expect(a).toEqual({ firstTime: true, next: ["inn"] });
    const b = markFirstTime(a.next, "inn");
    expect(b.firstTime).toBe(false);
    expect(b.next).toEqual(["inn"]);
  });

  it("keys NPCs and quest givers apart", () => {
    expect(npcMeetKey("drago")).toBe("npc:drago");
    expect(questGiverMeetKey("drago")).toBe("quest:drago");
  });
});
