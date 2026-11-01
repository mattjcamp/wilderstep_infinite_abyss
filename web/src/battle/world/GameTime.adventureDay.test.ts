import { describe, expect, it } from "vitest";
import { adventureDay, clockFromDate } from "./GameTime";

describe("adventureDay", () => {
  const start = clockFromDate({ year: 3, month: 4, day: 10, hour: 15, minute: 45 });
  it("is Day 1 on the starting day", () => {
    expect(adventureDay(start, start)).toBe(1);
    expect(adventureDay(clockFromDate({ year: 3, month: 4, day: 10, hour: 23, minute: 59 }), start)).toBe(1);
  });
  it("rolls over at midnight", () => {
    expect(adventureDay(clockFromDate({ year: 3, month: 4, day: 11, hour: 0 }), start)).toBe(2);
    expect(adventureDay(clockFromDate({ year: 3, month: 5, day: 10, hour: 12 }), start)).toBe(29);
  });
});
