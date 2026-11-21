/**
 * Libraries (`uses`) are live layers: a module that uses a library gets
 * ALL of the library's content without importing records one by one,
 * and later edits to the library show up in the module. The module's
 * own file still overrides library records by id.
 */
import { afterEach, describe, expect, it } from "vitest";

import { StaticModuleSource, type ModuleFileLocator } from "./StaticModuleSource";

const HOST = "https://files.example.test";
const locator: ModuleFileLocator = {
  moduleFile: (moduleId, fileName) => `${HOST}/modules/${moduleId}/${fileName}`,
  index: () => `${HOST}/modules/index.json`,
};

function serve(routes: Record<string, unknown>): void {
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = String(url);
    const path = u.startsWith(HOST) ? u.slice(HOST.length) : u;
    const body = routes[path] ?? null;
    return { ok: body !== null, status: body !== null ? 200 : 404, json: async () => body } as Response;
  }) as typeof fetch;
}

function routes(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "/modules/default/module.json": { id: "default", role: "core" },
    "/modules/default/maps.json": { maps: [{ id: "arena", name: "Default Arena" }] },
    "/modules/world/module.json": { id: "world", role: "library", extends: "default" },
    "/modules/world/maps.json": {
      maps: [
        { id: "town", name: "Willowbrook" },
        { id: "arena", name: "World Arena" },
      ],
    },
    "/modules/world/npcs.json": { npcs: [{ id: "smith", name: "Smith" }] },
    "/modules/adventure/module.json": {
      id: "adventure",
      role: "playable",
      extends: "default",
      uses: ["world"],
    },
    ...overrides,
  };
}

const ids = (data: unknown, key: string): string[] =>
  ((data as Record<string, Array<{ id: string }>>)?.[key] ?? []).map((r) => r.id);

describe("libraries are live layers", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("a new module that uses a library gets all of its content (no imports)", async () => {
    serve(routes());
    const src = new StaticModuleSource(locator);
    const mod = await src.load("adventure");
    expect(ids(mod.data.maps, "maps").sort()).toEqual(["arena", "town"]);
    expect(ids(mod.data.npcs, "npcs")).toEqual(["smith"]);
    // Library beats the parent for the same id.
    const arena = (mod.data.maps as { maps: Array<{ id: string; name: string }> }).maps.find((m) => m.id === "arena");
    expect(arena?.name).toBe("World Arena");
    // Nothing left to import.
    expect(await src.listLibraryRecords("adventure", "maps")).toEqual([]);
  });

  it("library content shows as inherited in the editor's layered view", async () => {
    serve(routes());
    const layers = await new StaticModuleSource(locator).loadModelLayers("adventure", "maps");
    expect(ids(layers.inherited, "maps").sort()).toEqual(["arena", "town"]);
    expect(layers.ownFile).toBeNull();
    expect(layers.usedLibraryIds).toEqual(["world"]);
  });

  it("edits to the library show up in the module", async () => {
    serve(routes({
      "/modules/world/maps.json": { maps: [{ id: "town", name: "Willowbrook (rebuilt)" }, { id: "keep", name: "Keep" }] },
    }));
    const mod = await new StaticModuleSource(locator).load("adventure");
    const maps = (mod.data.maps as { maps: Array<{ id: string; name: string }> }).maps;
    expect(maps.find((m) => m.id === "town")?.name).toBe("Willowbrook (rebuilt)");
    expect(maps.some((m) => m.id === "keep")).toBe(true);
  });

  it("the module's own records still override the library's", async () => {
    serve(routes({
      "/modules/adventure/maps.json": { maps: [{ id: "town", name: "Willowbrook (burned)" }] },
    }));
    const mod = await new StaticModuleSource(locator).load("adventure");
    const maps = (mod.data.maps as { maps: Array<{ id: string; name: string }> }).maps;
    expect(maps.find((m) => m.id === "town")?.name).toBe("Willowbrook (burned)");
  });

  it("a library's own parent isn't re-applied over the module's parents", async () => {
    // adventure extends "base" (which overrides arena); the library
    // extends default. Default must not be re-applied after "base".
    serve(routes({
      "/modules/base/module.json": { id: "base", extends: "default" },
      "/modules/base/maps.json": { maps: [{ id: "arena", name: "Base Arena" }] },
      "/modules/world/maps.json": { maps: [{ id: "town", name: "Willowbrook" }] },
      "/modules/adventure/module.json": { id: "adventure", extends: "base", uses: ["world"] },
    }));
    const mod = await new StaticModuleSource(locator).load("adventure");
    const maps = (mod.data.maps as { maps: Array<{ id: string; name: string }> }).maps;
    expect(maps.find((m) => m.id === "arena")?.name).toBe("Base Arena");
  });

  it("a missing library is skipped, not fatal", async () => {
    serve(routes({
      "/modules/adventure/module.json": { id: "adventure", extends: "default", uses: ["gone"] },
    }));
    const mod = await new StaticModuleSource(locator).load("adventure");
    expect(ids(mod.data.maps, "maps")).toEqual(["arena"]);
  });
});
