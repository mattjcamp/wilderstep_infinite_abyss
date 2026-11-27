import { describe, expect, it } from "vitest";
import {
  equippedGrantsLight,
  itemGrantsLight,
  partyHasItemLight,
  partyItemLightSources,
} from "./itemLight";

const items = new Map([
  ["sun_sword", { name: "Sun Sword", grants_effect: "magic_light" }],
  ["sword", {}],
]);
const byId = (id: string) => items.get(id);

describe("item-granted light", () => {
  it("recognises Light-granting items", () => {
    expect(itemGrantsLight({ grants_effect: "magic_light" })).toBe(true);
    expect(itemGrantsLight({ grants_effect: "sun_sword_aura" })).toBe(true);
    expect(itemGrantsLight({ grants_effect: "bless" })).toBe(false);
    expect(itemGrantsLight({})).toBe(false);
  });

  it("checks every equipped slot", () => {
    expect(equippedGrantsLight({ hands: "sun_sword" }, byId)).toBe(true);
    expect(equippedGrantsLight({ hands: "sword", body: null }, byId)).toBe(false);
  });

  it("needs a living roster member to hold it", () => {
    const party = (hp: number, roster: string[]) => ({
      roster,
      members: [{ id: "a", hp, equipped: { hands: "sun_sword" } }],
    });
    expect(partyHasItemLight(party(10, ["a"]), byId)).toBe(true);
    expect(partyHasItemLight(party(0, ["a"]), byId)).toBe(false);
    expect(partyHasItemLight(party(10, []), byId)).toBe(false);
  });

  it("names the items the light comes from", () => {
    const party = {
      roster: ["a", "b"],
      members: [
        { id: "a", hp: 5, equipped: { hands: "sun_sword" } },
        { id: "b", hp: 5, equipped: { hands: "sun_sword" } },
      ],
    };
    expect(partyItemLightSources(party, byId)).toEqual(["Sun Sword"]);
    expect(partyItemLightSources({ roster: [], members: [] }, byId)).toEqual([]);
  });
});
