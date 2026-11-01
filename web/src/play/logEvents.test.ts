import { describe, expect, it } from "vitest";
import { dueLogEventLines, normalizeLogEvents } from "./logEvents";

const events = normalizeLogEvents([
  {
    id: "intro",
    map_id: "caravan",
    entries: [
      { steps: 0, text: "Smoke rises." },
      { steps: 3, text: "Tracks lead north." },
      { steps: 3, text: "" },
    ],
  },
  { id: "town", map_id: "town", repeat: "every_visit", entries: [{ steps: 0, text: "Bells ring." }] },
  { id: "broken", map_id: "", entries: [{ steps: 0, text: "x" }] },
]);

describe("log events", () => {
  it("normalises records", () => {
    expect(events.map((e) => e.id)).toEqual(["intro", "town"]);
    expect(events[0].entries).toHaveLength(2);
    expect(events[0].repeat).toBe("once");
  });

  it("returns lines due at a step count on a map", () => {
    expect(dueLogEventLines(events, "caravan", 0, new Set())).toEqual({
      lines: ["Smoke rises."],
      shownKeys: ["intro#0"],
    });
    expect(dueLogEventLines(events, "caravan", 3, new Set()).lines).toEqual([
      "Tracks lead north.",
    ]);
    expect(dueLogEventLines(events, "caravan", 2, new Set()).lines).toEqual([]);
  });

  it("skips once-lines already shown; every_visit always shows", () => {
    expect(dueLogEventLines(events, "caravan", 0, new Set(["intro#0"])).lines).toEqual([]);
    expect(dueLogEventLines(events, "town", 0, new Set(["town#0"]))).toEqual({
      lines: ["Bells ring."],
      shownKeys: [],
    });
  });
});
