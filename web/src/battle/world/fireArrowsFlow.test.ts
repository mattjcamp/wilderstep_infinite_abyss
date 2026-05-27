/**
 * Sanity test for the data-side fire-arrows flow. The Combat scene's
 * picker + ignite path is hard to test (Phaser scene), but we can pin
 * the data that drives both: a party with fire_arrows in stash should
 * (a) show up under compatibleAmmoIds, (b) decrement on
 * consumeAmmoFromStash, and (c) point at an Item that has ignite=true
 * with a sane fire damage value.
 *
 * The user reported fire arrows behaving identical to regular arrows
 * with no fire. If this test passes, the picker + igniteCell wiring
 * is the next suspect. If it fails, the data layer is the culprit.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  compatibleAmmoIds,
  consumeAmmoFromStash,
  partyHasAmmo,
} from "./Party";
import type { Party } from "./Party";
import { loadItems, _clearItemsCache } from "./Items";

function makeParty(): Party {
  return {
    members: [],
    roster: [],
    inventory: [
      { item: "arrows", charges: 100 },
      { item: "fire_arrows", charges: 20 },
    ],
    gold: 0,
    party_effects: [],
    avatar: "",
    start_position: { map_id: "world", col: 0, row: 0 },
    torch_steps: 0,
    magic_light_steps: 0,
  } as unknown as Party;
}

beforeEach(() => {
  _clearItemsCache();
});

describe("Fire arrows — data flow sanity", () => {
  it("partyHasAmmo sees fire_arrows in a party that carries them", () => {
    const p = makeParty();
    expect(partyHasAmmo(p, "fire_arrows")).toBe(true);
  });

  it("compatibleAmmoIds returns both ammos for a bow", () => {
    const p = makeParty();
    const shortBow = {
      id: "short_bow",
      category: "weapons" as const,
      name: "Short Bow",
      ranged: true,
      ammo: "arrows",
    };
    expect(compatibleAmmoIds(shortBow, p)).toEqual([
      "arrows",
      "fire_arrows",
    ]);
  });

  it("consumeAmmoFromStash deducts one fire_arrow on a shot", () => {
    const p = makeParty();
    const ok = consumeAmmoFromStash(p, "fire_arrows");
    expect(ok).toBe(true);
    const row = p.inventory.find((e) => e.item === "fire_arrows");
    expect(row?.charges).toBe(19);
  });

  it("the items.json catalog flags fire_arrows as ignite=true with non-zero fire damage", async () => {
    // This is the asserting case the user's bug likely tripped:
    // if `ignite` is missing or `power` is 0, the CombatScene's
    // ignite branch silently no-ops. Mocking fetch so loadItems
    // reads the on-disk JSON via a synthetic stub.
    const itemsJson = await import(
      "../../../public/modules/default/items.json"
    );
    const fa = (itemsJson as { items: Array<Record<string, unknown>> }).items
      .find((i) => i.id === "fire_arrows");
    expect(fa).toBeDefined();
    expect(fa?.ignite).toBe(true);
    expect(fa?.light_range).toBeGreaterThan(0);
    expect(fa?.power).toBeGreaterThan(0);
  });

  it("loadItems() carries ignite + light_range + power through onto the runtime Item", async () => {
    // Mock fetch so loadItems pulls our local items.json blob.
    const itemsJson = await import(
      "../../../public/modules/default/items.json"
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => itemsJson,
    })) as unknown as typeof fetch;
    try {
      const items = await loadItems();
      const fa = items.get("fire_arrows");
      expect(fa).toBeDefined();
      expect(fa?.ignite).toBe(true);
      expect(fa?.light_range).toBe(3);
      expect(fa?.power).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
