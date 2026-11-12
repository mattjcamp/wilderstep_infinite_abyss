import { describe, expect, it } from "vitest";
import { stairsPlacardText } from "./stairsPlacard";
import { EXIT_TO_OVERWORLD_MAP_ID, floorMapId } from "@/sim/dungeon/dungeonLevelToMap";

describe("stairsPlacardText", () => {
  it("names the destination floor", () => {
    expect(
      stairsPlacardText({
        stairs: "down",
        linkMapId: floorMapId("grotto", 2),
        dungeonName: "Grotto",
        totalFloors: 4,
        floorName: (i) => (i === 2 ? "The Drowned Hall" : undefined),
      }),
    ).toEqual({
      placeKind: "stairs-down",
      name: "Stairs Down",
      description: "These stairs lead down to The Drowned Hall (Floor 3 of 4).",
    });
    expect(
      stairsPlacardText({ stairs: "up", linkMapId: floorMapId("g", 0), dungeonName: "G", totalFloors: 2 })
        .description,
    ).toBe("These stairs lead up to Floor 1 of 2.");
  });
  it("says when the stairs leave the dungeon", () => {
    const t = stairsPlacardText({
      stairs: "up",
      linkMapId: EXIT_TO_OVERWORLD_MAP_ID,
      dungeonName: "Grotto",
      totalFloors: 3,
    });
    expect(t.placeKind).toBe("stairs-up");
    expect(t.description).toBe("These stairs lead up and out of Grotto.");
  });
});
