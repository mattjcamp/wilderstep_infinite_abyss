import { describe, expect, it } from "vitest";
import { ownRecordsAfterEdit, sameRecord } from "./ownRecords";

const inherited = [
  { id: "grotto", name: "Grotto", size: { width: 32, height: 32 } },
  { id: "halls", name: "Halls" },
];

describe("ownRecordsAfterEdit", () => {
  it("keeps the module's own records and drops untouched inherited ones", () => {
    const merged = [...inherited, { id: "mine", name: "Mine" }];
    expect(ownRecordsAfterEdit(merged, inherited)).toEqual([{ id: "mine", name: "Mine" }]);
  });
  it("keeps an inherited record the module changed (an override)", () => {
    const merged = [{ ...inherited[0], name: "Grotto II" }, inherited[1]];
    expect(ownRecordsAfterEdit(merged, inherited).map((r) => r.id)).toEqual(["grotto"]);
  });
  it("drops a stale copy identical to the inherited record, key order aside", () => {
    const copy = { size: { height: 32, width: 32 }, name: "Grotto", id: "grotto" };
    expect(ownRecordsAfterEdit([copy, inherited[1]], inherited)).toEqual([]);
  });
  it("with nothing inherited, everything is own", () => {
    expect(ownRecordsAfterEdit(inherited, [])).toEqual(inherited);
  });
});

describe("sameRecord", () => {
  it("ignores key order, not values", () => {
    expect(sameRecord({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameRecord({ a: 1, b: [2, 1] }, { b: [1, 2], a: 1 })).toBe(false);
  });
});
