import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOG_STYLES,
  normalizeFogStyles,
  resolveFogStyle,
} from "./fogStyle";

describe("resolveFogStyle", () => {
  it("uses each band's default when nothing is authored", () => {
    expect(DEFAULT_FOG_STYLES).toEqual({
      day: "cloud",
      twilight: "dark_cloud",
      night: "darkness",
    });
    expect(resolveFogStyle(undefined, "day")).toBe("cloud");
    expect(resolveFogStyle(null, "twilight")).toBe("dark_cloud");
    expect(resolveFogStyle({}, "night")).toBe("darkness");
  });

  it("picks the authored style for the active band only", () => {
    const styles = { night: "cloud" as const };
    expect(resolveFogStyle(styles, "night")).toBe("cloud");
    expect(resolveFogStyle(styles, "day")).toBe("cloud");
    expect(resolveFogStyle(styles, "twilight")).toBe("dark_cloud");
  });

  it("ignores garbage values", () => {
    const styles = { day: "smoke", night: "fog" } as unknown as Record<string, string>;
    expect(resolveFogStyle(styles as never, "day")).toBe("cloud");
    expect(resolveFogStyle(styles as never, "night")).toBe("darkness");
  });
});

describe("normalizeFogStyles", () => {
  it("returns undefined for non-objects and all-default records", () => {
    expect(normalizeFogStyles(undefined)).toBeUndefined();
    expect(normalizeFogStyles("darkness")).toBeUndefined();
    expect(normalizeFogStyles(["darkness"])).toBeUndefined();
    expect(
      normalizeFogStyles({ day: "cloud", twilight: "dark_cloud", night: "darkness" }),
    ).toBeUndefined();
  });

  it("keeps only valid entries that differ from the band's default", () => {
    expect(
      normalizeFogStyles({
        day: "cloud",
        twilight: "darkness",
        night: "darkness",
        dawn: "darkness",
      }),
    ).toEqual({ twilight: "darkness" });
    expect(normalizeFogStyles({ night: "fog" })).toBeUndefined();
    // An explicit "clouds" at twilight / night is no longer the default,
    // so it must survive a save.
    expect(normalizeFogStyles({ twilight: "cloud", night: "cloud" })).toEqual({
      twilight: "cloud",
      night: "cloud",
    });
    expect(normalizeFogStyles({ day: "darkness" })).toEqual({ day: "darkness" });
  });
});
