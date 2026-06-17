import { beforeEach, describe, expect, it } from "vitest";

import {
  ARENA_TAG,
  arenaMapFromRaw,
  loadArenaMaps,
  _clearMapsCache,
  _setMapsCache,
  type ArenaMap,
} from "./Maps";

describe("arenaMapFromRaw", () => {
  it("hydrates a raw map record and derives width/height from the grid", () => {
    const m = arenaMapFromRaw({
      id: "arena1",
      name: "Arena One",
      tags: [ARENA_TAG],
      grid: [
        [{ sprite: "a" }, { sprite: "b" }, { sprite: "c" }],
        [{ sprite: "d" }, { sprite: "e" }, { sprite: "f" }],
      ],
    });
    expect(m).not.toBeNull();
    expect(m!.width).toBe(3);
    expect(m!.height).toBe(2);
    expect(m!.tags).toEqual([ARENA_TAG]);
  });

  it("returns null for a record missing id / name", () => {
    expect(arenaMapFromRaw({ name: "no id" })).toBeNull();
    expect(arenaMapFromRaw(null)).toBeNull();
    expect(arenaMapFromRaw("not an object")).toBeNull();
  });
});

describe("_setMapsCache (inheritance-seed seam)", () => {
  beforeEach(() => _clearMapsCache());

  it("loadArenaMaps reads the seed and filters to ARENA_TAG (no fetch)", async () => {
    const arena = arenaMapFromRaw({
      id: "arena1",
      name: "Arena One",
      tags: [ARENA_TAG],
      grid: [],
    }) as ArenaMap;
    const town = arenaMapFromRaw({
      id: "town1",
      name: "Town One",
      tags: ["overworld"],
      grid: [],
    }) as ArenaMap;
    _setMapsCache([arena, town]);
    // No fetch stub — a cache miss would hit the network and throw.
    const arenas = await loadArenaMaps();
    expect(arenas.map((m) => m.id)).toEqual(["arena1"]);
  });
});
