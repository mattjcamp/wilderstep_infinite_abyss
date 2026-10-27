import { describe, expect, it } from "vitest";
import { isPlayerModuleId, mergeCatalog } from "./catalogMerge.mjs";

describe("mergeCatalog", () => {
  const hosted = {
    modules: [
      { id: "default", title: "Default Module", role: "core" },
      { id: "underworld-invaders", title: "Emberscar" },
      { id: "@matt/my-quest", title: "My Quest", role: "playable" },
      { id: "@core/old", title: "Old core" },
    ],
  };
  const shipped = {
    _comment: "repo index",
    modules: [
      { id: "default", title: "Default Module", role: "core" },
      { id: "test", title: "Test", role: "playable" },
    ],
  };

  it("replaces built-in entries with the repo's list and keeps player modules", () => {
    expect(mergeCatalog(hosted, shipped).modules).toEqual([
      { id: "default", title: "Default Module", role: "core" },
      { id: "test", title: "Test", role: "playable" },
      { id: "@matt/my-quest", title: "My Quest", role: "playable" },
    ]);
  });

  it("works when there is no hosted index yet", () => {
    expect(mergeCatalog(null, shipped).modules.map((m) => m.id)).toEqual(["default", "test"]);
  });

  it("never lets the repo list claim a player id", () => {
    const sneaky = { modules: [{ id: "@matt/my-quest", title: "x" }] };
    expect(mergeCatalog({ modules: [] }, sneaky).modules).toEqual([]);
  });

  it("classifies ids", () => {
    expect(isPlayerModuleId("@matt/a")).toBe(true);
    expect(isPlayerModuleId("@core/a")).toBe(false);
    expect(isPlayerModuleId("default")).toBe(false);
  });
});
