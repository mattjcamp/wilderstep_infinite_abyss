/**
 * Regression test for the Camping Supplies "rest doesn't persist into
 * combat" bug.
 *
 * The actual root cause was sneaky: `gameState.partyData` is a
 * module-level global that CombatScene caches the party into. The
 * scene's boot path reads `if (!gameState.partyData) gameState.partyData
 * = await loadParty();` — so a non-null value is reused as-is.
 * Without an explicit reset, the wounded party from fight N stayed in
 * the global, and fight N+1 (after a Party-screen rest) booted with
 * the stale wounded values even though the save and the v1 party
 * cache had been correctly updated.
 *
 * The fix is one line in `clearAllSeededCaches`: `gameState.partyData
 * = null`. This test plants a fake "stale" party in `gameState.partyData`,
 * runs `seedBattleCaches`, and asserts the stale reference is gone.
 * If anyone removes the reset, this fails.
 */
import { describe, expect, it, vi } from "vitest";

import { gameState } from "@/battle/state";
import type { Party } from "@/battle/world/Party";
import {
  _clearEncountersCache,
  loadAllEncounters,
} from "@/battle/world/Encounters";
import { __resetModuleSourceForTests } from "@/data_model/sourceConfig";
import {
  seedBattleCaches,
  seedBattleCachesFromCatalog,
} from "./seedBattleCaches";
import type { WorldSave } from "./saveTypes";

function minimalSave(): WorldSave {
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    moduleId: "default",
    clockMinutes: 0,
    party: {
      currentMapId: "demo_map",
      col: 0,
      row: 0,
      avatar: "person/fighter18.png",
      gold: 0,
      inventory: [],
      torch_steps: 0,
      infravision_active: false,
      roster: [],
      members: [],
    },
    maps: {},
    dungeons: {},
  };
}

/** Build a sentinel "stale" party with values nothing in the seed
 *  pipeline could ever produce — so the assertion is unambiguous. */
function stalePartySentinel(): Party {
  return {
    gold: 999_999,
    torch_steps: 0,
    magic_light_steps: 0,
    roster: [],
    inventory: [],
    party_effects: [],
    avatar: "__STALE_SENTINEL__",
    start_position: { map_id: "__none__", col: -1, row: -1 },
  } as unknown as Party;
}

describe("seedBattleCaches", () => {
  it("clears gameState.partyData so CombatScene re-fetches the healed party", async () => {
    // Stub fetch so the seed's HTTP calls return null (catalog loads
    // are tolerated when null in the existing code path) — this test
    // runs in Node, not the browser. We only care about the side
    // effect on gameState.partyData, not the catalog contents.
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchStub);
    // URL.createObjectURL is called by the blob-URL seeding helpers.
    // jsdom doesn't expose it; stub to a no-op string. revokeObjectURL
    // gets a matching stub so the cleanup call doesn't throw.
    const urlStub = vi.fn().mockReturnValue("blob:stub");
    const revokeStub = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: urlStub,
      revokeObjectURL: revokeStub,
    });

    try {
      const stale = stalePartySentinel();
      gameState.partyData = stale;

      await seedBattleCaches("default", minimalSave());

      // After seeding the stale sentinel MUST be gone. The seed
      // either nulls it (so loadParty re-fetches the freshly-seeded
      // party cache on next combat) or replaces it with a freshly-
      // built one. Either is fine — what matters is "not the stale
      // wounded party from before".
      expect(gameState.partyData).not.toBe(stale);
      // And if the seed left it null, that's the documented behavior
      // the comment in clearAllSeededCaches promises — CombatScene
      // will re-fetch via loadParty(). If the seed set it to a fresh
      // party, that's also fine for the bug we're guarding.
      if (gameState.partyData !== null) {
        // Sanity: any non-null value should at least not carry our
        // sentinel marker.
        expect(gameState.partyData.avatar).not.toBe("__STALE_SENTINEL__");
      }
    } finally {
      vi.unstubAllGlobals();
      gameState.partyData = null;
    }
  });
});

describe("seedBattleCachesFromCatalog (Battle Simulator, inheriting module)", () => {
  it("seeds encounters resolved up the `extends` chain", async () => {
    // Emulate the static module layout for a child module that extends
    // a parent and ships ONLY module.json (no encounters.json) — the
    // exact shape of the reported bug (`test-module extends default`).
    const routes: Record<string, unknown> = {
      "/modules/child/module.json": {
        id: "child",
        title: "Child",
        extends: "parent",
      },
      "/modules/parent/module.json": { id: "parent", title: "Parent" },
      // Encounters live ONLY on the parent — the child inherits them.
      "/modules/parent/encounters.json": {
        encounters: [
          {
            id: "inherited_rats",
            area: "dungeon",
            name: "Inherited Rats",
            level: 1,
            monsters: ["rat"],
          },
        ],
      },
    };
    const fetchStub = vi.fn((input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : (input as { url?: string })?.url ?? String(input);
      const path = url.split("?")[0];
      if (path in routes) {
        return Promise.resolve(
          new Response(JSON.stringify(routes[path]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      // Everything else (the child's own files, other catalogs) 404s,
      // exactly like an inheriting module on disk.
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchStub);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:stub"),
      revokeObjectURL: vi.fn(),
    });
    __resetModuleSourceForTests();
    _clearEncountersCache();

    try {
      await seedBattleCachesFromCatalog("child");
      // The flat fetch path would have 404'd on
      // /modules/child/encounters.json; the seed must have resolved the
      // parent's catalog and populated the cache instead.
      const list = await loadAllEncounters();
      expect(list.map((e) => e.id)).toEqual(["inherited_rats"]);
    } finally {
      vi.unstubAllGlobals();
      __resetModuleSourceForTests();
      _clearEncountersCache();
      gameState.partyData = null;
    }
  });
});
