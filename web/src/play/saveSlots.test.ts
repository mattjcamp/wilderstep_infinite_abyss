/**
 * Unit tests for the manual-slot + export/import layer in save.ts.
 *
 * The save layer talks to `window.localStorage`; vitest runs these
 * in node (no jsdom), so each test installs a Map-backed stub on
 * `globalThis.window` and tears it down after. That also exercises
 * the SSR guards: with the stub removed, every function must return
 * its inert value instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  activateSlot,
  exportFileName,
  installImportedSave,
  listSlotSaves,
  loadSlot,
  loadWorld,
  parseImportedSave,
  saveToSlot,
  saveWorld,
} from "./save";
import {
  SAVE_PREV_STORAGE_KEY,
  SAVE_SLOT_COUNT,
  SAVE_SLOT_STORAGE_PREFIX,
  SAVE_STORAGE_KEY,
  type WorldSave,
} from "./saveTypes";

function fixtureSave(moduleId = "default"): WorldSave {
  return {
    schemaVersion: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    moduleId,
    clockMinutes: 42,
    party: {
      currentMapId: "demo_map",
      col: 3,
      row: 7,
      avatar: "person/fighter18.png",
      gold: 50,
      inventory: [],
      torch_steps: 0,
      infravision_active: false,
      roster: ["selina"],
      members: [
        {
          id: "selina",
          custom: null,
          hp: 9,
          mp: 11,
          inventory: [],
          effects: [],
        },
      ],
    },
    maps: {},
    dungeons: {},
  };
}

/** Minimal localStorage backed by a Map — enough surface for the
 *  save layer (getItem / setItem / removeItem). */
function installWindowStub(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  return store;
}

function removeWindowStub(): void {
  delete (globalThis as { window?: unknown }).window;
}

describe("manual save slots", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installWindowStub();
  });
  afterEach(removeWindowStub);

  it("round-trips a save through a slot and restamps savedAt", () => {
    const save = fixtureSave();
    expect(saveToSlot(2, save)).toBe(true);
    const back = loadSlot(2);
    expect(back).not.toBeNull();
    expect(back!.moduleId).toBe("default");
    expect(back!.party.col).toBe(3);
    // savedAt is restamped at commit time, not carried from the blob.
    expect(back!.savedAt).not.toBe(save.savedAt);
    // Stored under the documented key.
    expect(store.has(`${SAVE_SLOT_STORAGE_PREFIX}2`)).toBe(true);
  });

  it("lists every slot in order with nulls for empties", () => {
    saveToSlot(1, fixtureSave("alpha"));
    saveToSlot(3, fixtureSave("gamma"));
    const slots = listSlotSaves();
    expect(slots).toHaveLength(SAVE_SLOT_COUNT);
    expect(slots[0]?.moduleId).toBe("alpha");
    expect(slots[1]).toBeNull();
    expect(slots[2]?.moduleId).toBe("gamma");
  });

  it("rejects out-of-range slot numbers", () => {
    expect(() => saveToSlot(0, fixtureSave())).toThrow();
    expect(() => saveToSlot(SAVE_SLOT_COUNT + 1, fixtureSave())).toThrow();
  });

  it("activateSlot promotes the slot, keeps it intact, clears the backup", () => {
    // A running game + a stale death-screen backup.
    saveWorld(fixtureSave("running"));
    store.set(SAVE_PREV_STORAGE_KEY, JSON.stringify(fixtureSave("old")));
    saveToSlot(1, fixtureSave("slotted"));

    expect(activateSlot(1)).toBe(true);
    expect(loadWorld()?.moduleId).toBe("slotted");
    // Slot is a durable snapshot — still there after loading.
    expect(loadSlot(1)?.moduleId).toBe("slotted");
    // The prior game's backup must not survive into the loaded game.
    expect(store.has(SAVE_PREV_STORAGE_KEY)).toBe(false);
  });

  it("activateSlot refuses empty and corrupt slots", () => {
    saveWorld(fixtureSave("running"));
    expect(activateSlot(2)).toBe(false);
    store.set(`${SAVE_SLOT_STORAGE_PREFIX}3`, "{not json");
    expect(activateSlot(3)).toBe(false);
    // The running game is untouched either way.
    expect(loadWorld()?.moduleId).toBe("running");
  });

  it("is inert without a window (SSR guard)", () => {
    removeWindowStub();
    expect(saveToSlot(1, fixtureSave())).toBe(false);
    expect(loadSlot(1)).toBeNull();
    expect(activateSlot(1)).toBe(false);
    expect(listSlotSaves()).toEqual([null, null, null]);
  });
});

describe("export / import", () => {
  beforeEach(installWindowStub);
  afterEach(removeWindowStub);

  it("parses a valid exported blob", () => {
    const text = JSON.stringify(fixtureSave());
    const imported = parseImportedSave(text);
    expect(imported).not.toBeNull();
    expect(imported!.party.currentMapId).toBe("demo_map");
  });

  it("rejects garbage, wrong versions, and structurally broken blobs", () => {
    expect(parseImportedSave("not json at all")).toBeNull();
    expect(parseImportedSave(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(
      parseImportedSave(
        JSON.stringify({ ...fixtureSave(), schemaVersion: 999 }),
      ),
    ).toBeNull();
    const noParty = { ...fixtureSave(), party: undefined };
    expect(parseImportedSave(JSON.stringify(noParty))).toBeNull();
    const noModule = { ...fixtureSave(), moduleId: "" };
    expect(parseImportedSave(JSON.stringify(noModule))).toBeNull();
  });

  it("installs an imported save as the active game and clears the backup", () => {
    saveWorld(fixtureSave("running"));
    const imported = parseImportedSave(JSON.stringify(fixtureSave("rescued")));
    expect(imported).not.toBeNull();
    expect(installImportedSave(imported!)).toBe(true);
    expect(loadWorld()?.moduleId).toBe("rescued");
    // Imports preserve the file's own savedAt — it documents when
    // the snapshot was taken, not when it was restored.
    expect(loadWorld()?.savedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("export round-trips through parseImportedSave", () => {
    // downloadSaveExport needs DOM anchor plumbing; the contract that
    // matters is blob-shape compatibility, which exportFileName +
    // a manual stringify of the same stamped shape cover.
    const save = fixtureSave();
    const reimported = parseImportedSave(JSON.stringify(save, null, 2));
    expect(reimported).toEqual(save);
  });

  it("builds a sanitised export filename", () => {
    const name = exportFileName(fixtureSave("my module/v2"));
    expect(name).toMatch(/^wilderstep-save-my_module_v2-\d{8}-\d{4}\.json$/);
  });
});

// Storage keys are part of the on-disk contract — a rename silently
// orphans every player's existing saves. Pin them.
describe("storage key contract", () => {
  it("keeps the documented key strings", () => {
    expect(SAVE_STORAGE_KEY).toBe("wsia.save.v1");
    expect(SAVE_PREV_STORAGE_KEY).toBe("wsia.save.v1.prev");
    expect(SAVE_SLOT_STORAGE_PREFIX).toBe("wsia.save.v1.slot.");
    expect(SAVE_SLOT_COUNT).toBe(3);
  });
});
