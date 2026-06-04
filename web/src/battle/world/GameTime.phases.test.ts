/**
 * Phase-window + camp-to-dawn coverage for the re-tuned day/night
 * cycle (day 6AM–8PM, dusk 8–10PM, night 10PM–4AM, dawn 4–6AM).
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
    expect(isDay(at(19, 59))).toBe(true); // ...through 7:59 PM
    expect(isDusk(at(20))).toBe(true); // dusk 8 PM
    expect(isDusk(at(21, 59))).toBe(true); // ...through 9:59 PM
    expect(isNight(at(22))).toBe(true); // night 10 PM
    expect(isNight(at(3, 59))).toBe(true); // ...through 3:59 AM
    expect(isDawn(at(4))).toBe(true); // dawn 4 AM
    expect(isDawn(at(5, 59))).toBe(true); // ...through 5:59 AM
  });

  it("keeps night to 6 of 24 hours (25%)", () => {
    let nightHours = 0;
    for (let h = 0; h < 24; h++) if (isNight(at(h))) nightHours += 1;
    expect(nightHours).toBe(6);
  });
});

describe("nextMorningMinutes (camp through the night)", () => {
  it("skips to the next 6:00 AM from inside the night window", () => {
    const c = at(23, 30); // 11:30 PM
    const morning = nextMorningMinutes(c);
    expect(morning).not.toBeNull();
    const woke = { totalMinutes: morning! };
    expect(hour(woke)).toBe(6);
    // 11:30 PM → 6:00 AM is 6.5 hours.
    expect(morning! - c.totalMinutes).toBe(6.5 * 60);
  });

  it("skips forward (same day) from the small hours and from dawn", () => {
    const night = at(2, 0); // 2 AM, night
    expect(nextMorningMinutes(night)! - night.totalMinutes).toBe(4 * 60);
    const dawn = at(5, 0); // 5 AM, dawn
    expect(nextMorningMinutes(dawn)! - dawn.totalMinutes).toBe(60);
  });

  it("returns null during day and dusk (no daytime fast-forward)", () => {
    expect(nextMorningMinutes(at(12))).toBeNull(); // noon
    expect(nextMorningMinutes(at(19))).toBeNull(); // 7 PM, still day
    expect(nextMorningMinutes(at(20, 30))).toBeNull(); // dusk
  });
});
