import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadAnimations,
  getAnimationById,
  __resetAnimationsCatalogForTests,
} from "./animationsCatalog";

const CATALOG = {
  animations: [
    {
      id: "lightning_strike",
      name: "Lightning Strike",
      visual: "lightning_bolt",
      cast_sfx: "fireball",
      hit_sfx: "explosion",
    },
    {
      id: "heal_sparkles",
      name: "Healing Sparkles",
      visual: "none",
      cast_sfx: "heal",
      hit_sfx: "",
    },
  ],
};

describe("animationsCatalog", () => {
  beforeEach(() => {
    __resetAnimationsCatalogForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null before the catalog has been loaded", () => {
    expect(getAnimationById("lightning_strike")).toBeNull();
  });

  it("loads + caches the catalog so getAnimationById resolves ids", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(CATALOG), { status: 200 }),
      );
    await loadAnimations("/test-catalog.json");
    expect(getAnimationById("lightning_strike")?.visual).toBe("lightning_bolt");
    expect(getAnimationById("heal_sparkles")?.cast_sfx).toBe("heal");
    expect(getAnimationById("does_not_exist")).toBeNull();
    expect(getAnimationById(null)).toBeNull();
    expect(getAnimationById("")).toBeNull();

    // A second load is a no-op — no extra fetch — because the cache
    // is hot.
    await loadAnimations("/test-catalog.json");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to an empty map when the catalog can't be fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    // Silence the warn the loader emits on failure.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = await loadAnimations("/nope.json");
    expect(map.size).toBe(0);
    expect(getAnimationById("lightning_strike")).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to an empty map when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network down"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = await loadAnimations("/offline.json");
    expect(map.size).toBe(0);
  });

  it("dedupes concurrent loads — one fetch, multiple awaits", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  new Response(JSON.stringify(CATALOG), { status: 200 }),
                ),
              10,
            ),
          ),
      );
    const [a, b, c] = await Promise.all([
      loadAnimations("/x.json"),
      loadAnimations("/x.json"),
      loadAnimations("/x.json"),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
