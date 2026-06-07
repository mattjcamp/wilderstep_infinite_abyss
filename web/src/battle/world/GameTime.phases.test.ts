/**
 * Phase-window + camp-to-dawn coverage for the re-tuned day/night
 * cycle (day 6AM–11PM, dusk 11PM–12AM, night 12AM–4AM, dawn 4–6AM).
 */
import { describe, expect, it } from "vitest";
import {
  clockFromDate,
  hour,
  isDawn,
  isDay,
  isDusk,
  isNight,
  nextMorningMinutes,
} from "./GameTime";

/** Clock at year 10 (safely past the epoch) on a given hour:minute. */
function at(h: number, m = 0) {
  return clockFromDate({ year: 10, month: 6, day: 15, hour: h, minute: m });
}

describe("time-of-day phase windows", () => {
  it("classifies every hour into exactly one phase (no gaps, no overlaps)", () => {
    for (let h = 0; h < 24; h++) {
      const c = at(h);
      const matches = [isDay(c), isDusk(c), isNight(c), isDawn(c)].filter(
        Boolean,
      );
      expect(matches, `hour ${h}`).toHaveLength(1);
    }
  });

  it("uses the re-tuned boundaries", () => {
    expect(isDay(at(6))).toBe(true); // day starts 6 AM
    expect(isDay(at(22, 59))).toBe(true); // ...through 10:59 PM
    expect(isDusk(at(23))).toBe(true); // dusk (twilight) 11 PM
    expect(isDusk(at(23, 59))).toBe(true); // ...through 11:59 PM
    expect(isNight(at(0))).toBe(true); // night (darkness) 12 AM
    expect(isNight(at(3, 59))).toBe(true); // ...through 3:59 AM
    expect(isNight(at(22))).toBe(false); // 10 PM is still day now
    expect(isDawn(at(4))).toBe(true); // dawn 4 AM
    expect(isDawn(at(5, 59))).toBe(true); // ...through 5:59 AM
  });

  it("keeps night to 4 of 24 hours (16.7%)", () => {
    let nightHours = 0;
    for (let h = 0; h < 24; h++) if (isNight(at(h))) nightHours += 1;
    expect(nightHours).toBe(4);
  });
});

describe("nextMorningMinutes (camp through the night)", () => {
  it("skips to the next 6:00 AM from inside the night window", () => {
    const c = at(0, 30); // 12:30 AM, night
    const morning = nextMorningMinutes(c);
    expect(morning).not.toBeNull();
    const woke = { totalMinutes: morning! };
    expect(hour(woke)).toBe(6);
    // 12:30 AM → 6:00 AM is 5.5 hours.
    expect(morning! - c.totalMinutes).toBe(5.5 * 60);
  });

  it("skips forward (same day) from the small hours and from dawn", () => {
    const night = at(2, 0); // 2 AM, night
    expect(nextMorningMinutes(night)! - night.totalMinutes).toBe(4 * 60);
    const dawn = at(5, 0); // 5 AM, dawn
    expect(nextMorningMinutes(dawn)! - dawn.totalMinutes).toBe(60);
  });

  it("returns null during day and dusk (no daytime fast-forward)", () => {
    expect(nextMorningMinutes(at(12))).toBeNull(); // noon
    expect(nextMorningMinutes(at(22))).toBeNull(); // 10 PM, still day
    expect(nextMorningMinutes(at(23, 30))).toBeNull(); // dusk (11:30 PM)
  });
});
