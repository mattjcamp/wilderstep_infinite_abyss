/**
 * RemoteModuleSource — the hosted-read seam. Stubs fetch with a fake
 * Read API origin and asserts the inherited resolution logic
 * (extends chain, @core aliasing, merge) runs against remote URLs.
 * This is the contract the future Cloudflare Worker must serve —
 * see docs/dev_guides/ugc_api_contract.md.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RemoteModuleSource, remoteLocator } from "./RemoteModuleSource";

const HOST = "https://read.example.com";

/** Fake Read API: path → JSON body. */
function installFetchStub(routes: Record<string, unknown>): string[] {
  const hits: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = String(url);
    hits.push(u);
    const path = u.startsWith(HOST) ? u.slice(HOST.length) : u;
    const body = routes[path] ?? null;
    return {
      ok: body !== null,
      status: body !== null ? 200 : 404,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return hits;
}

describe("remoteLocator", () => {
  it("builds origin-rooted URLs with the static tree's layout", () => {
    const loc = remoteLocator(`${HOST}/`); // trailing slash normalised
    expect(loc.index()).toBe(`${HOST}/modules/index.json`);
    expect(loc.moduleFile("tavern", "races.json")).toBe(
      `${HOST}/modules/tavern/races.json`,
    );
    expect(loc.moduleFile("@matt/sunken-keep", "module.json")).toBe(
      `${HOST}/modules/@matt/sunken-keep/module.json`,
    );
    // @core aliasing applies at the URL layer.
    expect(loc.moduleFile("@core/default", "spells.json")).toBe(
      `${HOST}/modules/default/spells.json`,
    );
  });
});

describe("RemoteModuleSource", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => undefined);
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("lists the hosted catalog", async () => {
    installFetchStub({
      "/modules/index.json": {
        modules: [{ id: "@matt/sunken-keep", title: "Sunken Keep" }],
      },
      "/modules/@matt/sunken-keep/module.json": {
        id: "@matt/sunken-keep",
        title: "Sunken Keep",
        author: "matt",
        extends: "@core/default",
      },
    });
    const src = new RemoteModuleSource(HOST);
    const list = await src.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("@matt/sunken-keep");
    expect(list[0].extends).toBe("@core/default");
  });

  it("walks a qualified extends chain across the alias boundary", async () => {
    const hits = installFetchStub({
      "/modules/@matt/sunken-keep/module.json": {
        id: "@matt/sunken-keep",
        extends: "@core/default",
      },
      // "@core/default" resolves to the bare storage path.
      "/modules/default/module.json": { id: "default" },
      "/modules/default/effects.json": {
        effects: [
          { id: "sleep", name: "Asleep" },
          { id: "curse", name: "Cursed" },
        ],
      },
      "/modules/@matt/sunken-keep/effects.json": {
        effects: [{ id: "sleep", name: "Deep Slumber" }],
      },
    });
    const src = new RemoteModuleSource(HOST);
    const layers = await src.loadModelLayers("@matt/sunken-keep", "effects");
    // Inherited view came from the aliased core module…
    expect(hits).toContain(`${HOST}/modules/default/effects.json`);
    const inherited = (layers.inherited as { effects: Array<{ id: string }> })
      .effects;
    expect(inherited.map((e) => e.id)).toEqual(["sleep", "curse"]);
    // …and the child's overlay is reported separately, override intact.
    const own = (layers.ownFile as {
      effects: Array<{ id: string; name: string }>;
    }).effects;
    expect(own).toEqual([{ id: "sleep", name: "Deep Slumber" }]);
    // parentId reports the parent's CANONICAL id (from its own
    // manifest), not the child's "@core/…" spelling — UI labels
    // show the real module identity.
    expect(layers.parentId).toBe("default");
  });

  it("detects extends cycles across alias spellings", async () => {
    installFetchStub({
      "/modules/@matt/loop/module.json": {
        id: "@matt/loop",
        extends: "@core/default",
      },
      // A hostile/buggy core manifest pointing back at the child's
      // ALIASED parent — the alias-resolved visited set must catch
      // the revisit instead of looping forever.
      "/modules/default/module.json": {
        id: "default",
        extends: "@core/default",
      },
    });
    const src = new RemoteModuleSource(HOST);
    await expect(
      src.loadModelLayers("@matt/loop", "effects"),
    ).rejects.toThrow(/cycle/i);
  });
});
