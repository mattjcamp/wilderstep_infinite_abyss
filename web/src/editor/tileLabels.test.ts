import { describe, expect, it } from "vitest";
import { shortTileLabels } from "./tileLabels";

describe("shortTileLabels", () => {
  it("drops the words every name shares", () => {
    expect(
      shortTileLabels([
        "Dungeon Wall, Corner Top Left",
        "Dungeon Wall, Divider",
        "Dungeon Wall, T (down)",
      ]),
    ).toEqual({
      prefix: "Dungeon Wall",
      labels: ["Corner Top Left", "Divider", "T (down)"],
    });
  });

  it("only cuts at whole words", () => {
    expect(shortTileLabels(["Town Tree", "Town Trees"]).labels).toEqual([
      "Tree",
      "Trees",
    ]);
    expect(shortTileLabels(["Grass", "Grassland"]).labels).toEqual([
      "Grass",
      "Grassland",
    ]);
  });

  it("never empties a label", () => {
    expect(shortTileLabels(["Dungeon Pit", "Dungeon Pit, Edge"]).labels).toEqual([
      "Pit",
      "Pit, Edge",
    ]);
  });

  it("leaves a single tile or unrelated names alone", () => {
    expect(shortTileLabels(["Dungeon Door"])).toEqual({
      prefix: "",
      labels: ["Dungeon Door"],
    });
    expect(shortTileLabels(["Water", "Ship"]).prefix).toBe("");
  });
});
