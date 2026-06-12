/**
 * summarizeValue — the read-only property-sheet renderer that
 * replaced the browse views' raw JSON dumps. The dialogs case mirrors
 * the real records authors will look at most.
 */
import { describe, expect, it } from "vitest";

import { summarizeValue } from "./RecordSummary";

describe("summarizeValue", () => {
  it("renders scalars plainly and empties as an em-dash", () => {
    expect(summarizeValue("Wolf")).toBe("Wolf");
    expect(summarizeValue(42)).toBe("42");
    expect(summarizeValue(true)).toBe("yes");
    expect(summarizeValue(false)).toBe("no");
    expect(summarizeValue(null)).toBe("—");
    expect(summarizeValue(undefined)).toBe("—");
    expect(summarizeValue("")).toBe("—");
    expect(summarizeValue([])).toBe("—");
    expect(summarizeValue({})).toBe("—");
  });

  it("joins scalar arrays and truncates long ones", () => {
    expect(summarizeValue(["goblin", "wolf"])).toBe("goblin, wolf");
    const long = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const out = summarizeValue(long);
    expect(out).toContain("m0");
    expect(out).toContain("(12 total)");
    expect(out).not.toContain("m11");
  });

  it("summarises object arrays by their handles (dialogs case)", () => {
    const dialogs = [
      { id: "introduction", title: "The King's Message", text: "Seek…" },
      { id: "farewell", text: "Go now." },
    ];
    expect(summarizeValue(dialogs)).toBe(
      "2 entries: The King's Message, farewell",
    );
  });

  it("renders objects as shallow key: value pairs", () => {
    expect(summarizeValue({ min: 2, max: 8 })).toBe("min: 2, max: 8");
    expect(
      summarizeValue({ teleport: { map_id: "crypt", col: 3, row: 7 } }),
    ).toBe("teleport: map_id: crypt, col: 3, row: 7");
  });

  it("caps recursion depth instead of walls of text", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    expect(summarizeValue(deep)).toBe("a: b: (nested)");
  });
});
