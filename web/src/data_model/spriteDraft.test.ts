import { describe, it, expect, beforeEach } from "vitest";
import {
  copySpriteDraft,
  discardSpriteDraft,
  hasSpriteDraft,
  listSpriteDrafts,
  loadSpriteDraft,
  saveSpriteDraft,
} from "./spriteDraft";

/** Minimal in-memory localStorage stand-in for the test environment.
 *  The real DOM-level Storage type is iterable via `key(i)`, so the
 *  stub mirrors that surface enough for the module's listing path. */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
}

beforeEach(() => {
  // vitest's jsdom env provides a real localStorage, but some setups
  // (node-only) don't — install the in-memory stand-in unconditionally
  // so the tests are env-agnostic. Reset between each test so cases
  // don't bleed.
  (globalThis as { localStorage: Storage }).localStorage = new MemoryStorage();
});

const SAMPLE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("spriteDraft — save / load round-trip", () => {
  it("returns null when no draft has been written", () => {
    expect(loadSpriteDraft("mod-a", "map/grass.png")).toBeNull();
    expect(hasSpriteDraft("mod-a", "map/grass.png")).toBe(false);
  });

  it("round-trips a data URL through save + load", () => {
    expect(saveSpriteDraft("mod-a", "map/grass.png", SAMPLE_PNG)).toBe(true);
    expect(loadSpriteDraft("mod-a", "map/grass.png")).toBe(SAMPLE_PNG);
    expect(hasSpriteDraft("mod-a", "map/grass.png")).toBe(true);
  });

  it("normalises leading /sprites/ and / when keying the entry", () => {
    // Authors typing the path two different ways should still land on
    // the same storage slot — the editor's preview is allowed to
    // pre-pend /sprites/, the pixel editor strips its own input.
    saveSpriteDraft("mod-a", "/sprites/item/sword.png", SAMPLE_PNG);
    expect(loadSpriteDraft("mod-a", "item/sword.png")).toBe(SAMPLE_PNG);
    expect(loadSpriteDraft("mod-a", "/item/sword.png")).toBe(SAMPLE_PNG);
  });

  it("scopes drafts to their module id", () => {
    // Same path, different module → distinct slots. Avoids one
    // module's edits leaking into another when the editor's nav
    // jumps between them.
    saveSpriteDraft("mod-a", "map/grass.png", SAMPLE_PNG);
    expect(loadSpriteDraft("mod-b", "map/grass.png")).toBeNull();
    expect(hasSpriteDraft("mod-b", "map/grass.png")).toBe(false);
  });

  it("discards drafts idempotently", () => {
    saveSpriteDraft("mod-a", "map/grass.png", SAMPLE_PNG);
    discardSpriteDraft("mod-a", "map/grass.png");
    expect(loadSpriteDraft("mod-a", "map/grass.png")).toBeNull();
    // Second discard is a silent no-op — no exception, no surprise.
    discardSpriteDraft("mod-a", "map/grass.png");
    expect(loadSpriteDraft("mod-a", "map/grass.png")).toBeNull();
  });
});

describe("spriteDraft — listing", () => {
  it("returns drafted paths sorted, module-scoped, prefix-stripped", () => {
    saveSpriteDraft("mod-a", "map/grass.png", SAMPLE_PNG);
    saveSpriteDraft("mod-a", "item/sword.png", SAMPLE_PNG);
    saveSpriteDraft("mod-b", "map/water.png", SAMPLE_PNG);
    const list = listSpriteDrafts("mod-a");
    expect(list).toEqual(["item/sword.png", "map/grass.png"]);
  });

  it("returns an empty array when the module has no drafts", () => {
    expect(listSpriteDrafts("mod-empty")).toEqual([]);
  });
});

describe("spriteDraft — copy", () => {
  it("copies an existing draft to a new path", () => {
    saveSpriteDraft("mod-a", "map/grass.png", SAMPLE_PNG);
    expect(copySpriteDraft("mod-a", "map/grass.png", "map/grass2.png")).toBe(
      true,
    );
    expect(loadSpriteDraft("mod-a", "map/grass2.png")).toBe(SAMPLE_PNG);
    // The source draft stays in place — copy, not move.
    expect(loadSpriteDraft("mod-a", "map/grass.png")).toBe(SAMPLE_PNG);
  });

  it("falls back to the provided sourceDataUrl when no draft exists", () => {
    // The browser must pre-fetch the on-disk PNG (no draft yet) and
    // pass it to copySpriteDraft so the new slot has bytes.
    expect(
      copySpriteDraft("mod-a", "map/grass.png", "map/grass2.png", SAMPLE_PNG),
    ).toBe(true);
    expect(loadSpriteDraft("mod-a", "map/grass2.png")).toBe(SAMPLE_PNG);
  });

  it("returns false when no draft and no fallback data are supplied", () => {
    // Defensive: a caller that forgot to pre-fetch the source gets a
    // clean failure instead of writing an empty slot.
    expect(copySpriteDraft("mod-a", "map/grass.png", "map/grass2.png")).toBe(
      false,
    );
    expect(loadSpriteDraft("mod-a", "map/grass2.png")).toBeNull();
  });
});
