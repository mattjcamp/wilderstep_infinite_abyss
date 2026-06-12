/**
 * publish-api worker — unit tests over the item handlers with an
 * in-memory R2 mock. Pins the hosted-mode rules the local publish
 * server never had: ownership by handle, system content read-only,
 * server-derived index, owner-prefixed sprites, size caps.
 */
import { describe, expect, it } from "vitest";

import {
  assertOwnedModuleId,
  canExtendModule,
  handleItem,
  parseModuleId,
  pngBytesFromDataUrl,
  reindexModules,
} from "./worker.mjs";

/** Minimal R2 mock: get/put/delete/list over a Map. */
function mockBucket() {
  const store = new Map();
  return {
    store,
    async get(key) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      return {
        json: async () =>
          JSON.parse(
            typeof value === "string" ? value : new TextDecoder().decode(value),
          ),
      };
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix }) {
      const objects = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key }));
      return { objects, truncated: false };
    },
  };
}

const env = () => ({ BUCKET: mockBucket() });

/** Read a stored value as parsed JSON regardless of whether the
 *  worker put it as a string or encoded bytes. */
function readJson(store, key) {
  const v = store.get(key);
  const text =
    typeof v === "string" ? v : new TextDecoder().decode(v);
  return JSON.parse(text);
}

// A real 1×1 transparent PNG.
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("id + ownership rules", () => {
  it("mirrors the front-end grammar", () => {
    expect(parseModuleId("@matt/sunken-keep")).toMatchObject({
      handle: "matt",
      slug: "sunken-keep",
    });
    expect(parseModuleId("default")).toMatchObject({ qualified: false });
    expect(parseModuleId("@matt/../x")).toBeNull();
  });

  it("rejects system ids and other handles for writes", () => {
    expect(() => assertOwnedModuleId("default", "matt")).toThrow(/read-only/);
    expect(() => assertOwnedModuleId("@core/tavern", "matt")).toThrow(
      /read-only/,
    );
    expect(() => assertOwnedModuleId("@sara/keep", "matt")).toThrow(/owned/);
    expect(assertOwnedModuleId("@matt/keep", "matt")).toMatchObject({
      slug: "keep",
    });
  });

  it("applies the v1 extends policy", () => {
    expect(canExtendModule("default", "matt")).toBe(true);
    expect(canExtendModule("@core/default", "matt")).toBe(true);
    expect(canExtendModule("@matt/base", "matt")).toBe(true);
    expect(canExtendModule("@sara/base", "matt")).toBe(false);
  });
});

describe("handleItem — manifests and models", () => {
  it("writes an owned manifest and derives the index entry", async () => {
    const e = env();
    const out = await handleItem(
      {
        kind: "manifest",
        moduleId: "@matt/keep",
        content: { id: "@matt/keep", title: "The Keep", extends: "@core/default" },
      },
      "matt",
      e,
    );
    expect(out.path).toBe("modules/@matt/keep/module.json");
    const index = readJson(e.BUCKET.store, "modules/index.json");
    expect(index.modules).toEqual([{ id: "@matt/keep", title: "The Keep" }]);
  });

  it("rejects a manifest whose extends violates the policy", async () => {
    await expect(
      handleItem(
        {
          kind: "manifest",
          moduleId: "@matt/keep",
          content: { extends: "@sara/base" },
        },
        "matt",
        env(),
      ),
    ).rejects.toThrow(/cross-author/);
  });

  it("accepts index items as a no-op and rejects system audio", async () => {
    // The editor's publish-all flow sends its local index draft;
    // the hosted index is server-derived, so the item succeeds
    // WITHOUT writing anything (the client may then clear the
    // draft — the server index already reflects the batch).
    const e = env();
    const out = await handleItem({ kind: "index", content: {} }, "matt", e);
    expect(out.path).toMatch(/server-derived/);
    expect(e.BUCKET.store.has("modules/index.json")).toBe(false);
    await expect(
      handleItem({ kind: "audio-index", tracks: [] }, "matt", env()),
    ).rejects.toThrow(/system content/);
  });

  it("writes model files only into owned modules", async () => {
    const e = env();
    const out = await handleItem(
      {
        kind: "model",
        moduleId: "@matt/keep",
        fileName: "races.json",
        content: { races: [] },
      },
      "matt",
      e,
    );
    expect(out.path).toBe("modules/@matt/keep/races.json");
    await expect(
      handleItem(
        { kind: "model", moduleId: "default", fileName: "races.json", content: {} },
        "matt",
        e,
      ),
    ).rejects.toThrow(/read-only/);
  });

  it("delete-module clears the prefix and the index entry", async () => {
    const e = env();
    await handleItem(
      { kind: "manifest", moduleId: "@matt/keep", content: { title: "K" } },
      "matt",
      e,
    );
    await handleItem(
      { kind: "model", moduleId: "@matt/keep", fileName: "races.json", content: {} },
      "matt",
      e,
    );
    await handleItem({ kind: "delete-module", moduleId: "@matt/keep" }, "matt", e);
    const keys = [...e.BUCKET.store.keys()];
    expect(keys.filter((k) => k.startsWith("modules/@matt/keep/"))).toEqual([]);
    const index = readJson(e.BUCKET.store, "modules/index.json");
    expect(index.modules).toEqual([]);
  });
});

describe("reindexModules", () => {
  it("rebuilds the index from every manifest in the bucket", async () => {
    const e = env();
    // Simulate the post-clobber state: module files exist (shipped +
    // player-published) but the index lists only the shipped ones.
    await e.BUCKET.put(
      "modules/default/module.json",
      JSON.stringify({ id: "default", title: "Default Module", role: "core" }),
    );
    await e.BUCKET.put(
      "modules/@matt/keep/module.json",
      JSON.stringify({ id: "@matt/keep", title: "The Keep", role: "playable" }),
    );
    await e.BUCKET.put("modules/default/races.json", "{}"); // non-manifest: ignored
    await e.BUCKET.put("modules/../evil/module.json", "{}"); // invalid id: ignored
    await e.BUCKET.put(
      "modules/index.json",
      JSON.stringify({ modules: [{ id: "default", title: "Default Module" }] }),
    );

    const entries = await reindexModules(e);
    expect(entries.map((x) => x.id).sort()).toEqual([
      "@matt/keep",
      "default",
    ]);
    const index = readJson(e.BUCKET.store, "modules/index.json");
    expect(index.modules.find((m) => m.id === "@matt/keep")).toEqual({
      id: "@matt/keep",
      title: "The Keep",
      role: "playable",
    });
    expect(index.modules.find((m) => m.id === "default").role).toBe("core");
  });
});

describe("handleItem — sprites", () => {
  it("writes under the caller's prefix and regenerates the owner index", async () => {
    const e = env();
    const out = await handleItem(
      { kind: "sprite", category: "monster", fileName: "slime.png", dataUrl: PNG_1X1 },
      "matt",
      e,
    );
    expect(out.path).toBe("sprites/@matt/monster/slime.png");
    const idx = readJson(e.BUCKET.store, "sprites/@matt/index.json");
    expect(idx.categories).toEqual({ monster: ["slime.png"] });
  });

  it("rejects non-PNG payloads by signature", () => {
    const fakePng = `data:image/png;base64,${btoa("GIF89a not a png")}`;
    expect(() => pngBytesFromDataUrl(fakePng)).toThrow(/signature/);
    expect(() => pngBytesFromDataUrl("data:image/jpeg;base64,AAAA")).toThrow(
      /image\/png/,
    );
  });
});
