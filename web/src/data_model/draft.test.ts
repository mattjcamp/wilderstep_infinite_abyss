/**
 * Draft-key parsing — regression coverage for the qualified-id bug:
 * keys are `drafts/<moduleId>/<modelKey>` and qualified module ids
 * contain a slash, so parsing must split at the LAST one. The
 * first-slash version silently dropped `@handle/slug` manifests
 * from publish payloads (the first hosted-publish attempt shipped
 * only the index item and stranded the module drafts).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listDraftKeys, MANIFEST_KEY } from "./draft";

function installWindowStub(keys: string[]): void {
  const store = new Map(keys.map((k) => [k, "x"]));
  const names = [...store.keys()];
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      get length() {
        return names.length;
      },
      key: (i: number) => names[i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  };
}

describe("listDraftKeys", () => {
  beforeEach(() => undefined);
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("parses bare-id draft keys (historical shape)", () => {
    installWindowStub(["drafts/tavern/effects", "drafts/tavern/module.json"]);
    expect(listDraftKeys()).toEqual([
      { moduleId: "tavern", modelKey: "effects" },
      { moduleId: "tavern", modelKey: MANIFEST_KEY },
    ]);
  });

  it("parses QUALIFIED-id draft keys at the last slash", () => {
    installWindowStub([
      "drafts/@matt/remote_test/module.json",
      "drafts/@matt/remote_test/maps",
    ]);
    expect(listDraftKeys()).toEqual([
      { moduleId: "@matt/remote_test", modelKey: MANIFEST_KEY },
      { moduleId: "@matt/remote_test", modelKey: "maps" },
    ]);
  });

  it("skips the index draft and foreign keys", () => {
    installWindowStub([
      "drafts/_index",
      "wsia.save.v1",
      "drafts/justonesegment",
    ]);
    // "_index" is the modules-index draft (own API); a prefix-matched
    // key with no inner slash can't be a module draft.
    expect(
      listDraftKeys().filter((d) => d.modelKey === "_index"),
    ).toEqual([]);
    expect(listDraftKeys()).toEqual([]);
  });
});
