import { describe, expect, it } from "vitest";
import {
  allFolderPaths,
  ancestorFolders,
  buildSpriteTree,
  countSprites,
} from "./spriteTree";

const cats = {
  town: ["well.png", "house/chapel/door.png", "house/roof.png", "fences/wood/post.png"],
  actions: ["attack.png"],
};

describe("buildSpriteTree", () => {
  it("mirrors the folder structure", () => {
    const root = buildSpriteTree(cats);
    expect(root.children.map((c) => c.name)).toEqual(["town", "actions"]);
    const town = root.children[0];
    expect(town.files).toEqual(["town/well.png"]);
    expect(town.children.map((c) => c.path)).toEqual(["town/fences", "town/house"]);
    const house = town.children[1];
    expect(house.files).toEqual(["town/house/roof.png"]);
    expect(house.children[0].path).toBe("town/house/chapel");
    expect(house.children[0].files).toEqual(["town/house/chapel/door.png"]);
    expect(countSprites(town)).toBe(4);
  });

  it("drops folders the filter empties", () => {
    const root = buildSpriteTree(cats, (p) => p.includes("door"));
    expect(allFolderPaths(root)).toEqual(["town", "town/house", "town/house/chapel"]);
  });

  it("lists ancestors of a sprite", () => {
    expect(ancestorFolders("town/house/chapel/door.png")).toEqual([
      "town",
      "town/house",
      "town/house/chapel",
    ]);
  });
});
