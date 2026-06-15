/**
 * Regression test for the "published tiles vanish on reload" bug.
 *
 * After a publish the editor discards its localStorage draft, so the
 * next load falls back to the server copy. If that read is served from
 * the browser's HTTP cache (locally there's no cache header; the hosted
 * Read API stamps model files with `max-age=60`), the author sees their
 * just-published map revert to the previous version until the cache
 * lapses. The fix: editor-mode reads (preferDrafts === true) must
 * bypass the cache, exactly as the freshness-critical index already
 * does. The game (preferDrafts === false) keeps the short cache.
 */
import { afterEach, describe, expect, it } from "vitest";

import { StaticModuleSource, type ModuleFileLocator } from "./StaticModuleSource";

const HOST = "https://files.example.test";

const locator: ModuleFileLocator = {
  moduleFile: (moduleId, fileName) => `${HOST}/modules/${moduleId}/${fileName}`,
  index: () => `${HOST}/modules/index.json`,
};

/** Record every (url, init) fetch pair so tests can assert cache mode. */
function installFetchSpy(
  routes: Record<string, unknown>,
): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const path = u.startsWith(HOST) ? u.slice(HOST.length) : u;
    const body = routes[path] ?? null;
    return {
      ok: body !== null,
      status: body !== null ? 200 : 404,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return calls;
}

const ROUTES = {
  "/modules/keep/module.json": { id: "keep", title: "Sunken Keep" },
  "/modules/keep/maps.json": { maps: [{ id: "m1", name: "Cellar" }] },
};

describe("StaticModuleSource cache behaviour", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("editor mode reads model + manifest files with cache: no-store", async () => {
    const calls = installFetchSpy(ROUTES);
    const src = new StaticModuleSource(locator, { preferDrafts: true });
    await src.loadModelLayers("keep", "maps");

    const mapsCall = calls.find((c) => c.url.endsWith("/keep/maps.json"));
    const manifestCall = calls.find((c) => c.url.endsWith("/keep/module.json"));
    expect(mapsCall?.init?.cache).toBe("no-store");
    expect(manifestCall?.init?.cache).toBe("no-store");
  });

  it("game mode keeps the default (cacheable) read for model files", async () => {
    const calls = installFetchSpy(ROUTES);
    const src = new StaticModuleSource(locator, { preferDrafts: false });
    await src.loadModelLayers("keep", "maps");

    const mapsCall = calls.find((c) => c.url.endsWith("/keep/maps.json"));
    expect(mapsCall).toBeDefined();
    expect(mapsCall?.init?.cache).toBeUndefined();
  });
});
