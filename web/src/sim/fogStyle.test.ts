import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOG_STYLE,
  normalizeFogStyles,
  resolveFogStyle,
} from "./fogStyle";

describe("resolveFogStyle", () => {
  it("defaults every band to cloud when nothing is authored", () => {
    expect(DEFAULT_FOG_STYLE).toBe("cloud");
    expect(resolveFogStyle(undefined, "day")).toBe("cloud");
    expect(resolveFogStyle(null, "twilight")).toBe("cloud");
    expect(resolveFogStyle({}, "night")).toBe("cloud");
  });

  it("picks the authored style for the active band only", () => {
    const styles = { night: "darkness" as const };
    expect(resolveFogStyle(styles, "night")).toBe("darkness");
    expect(resolveFogStyle(styles, "day")).toBe("cloud");
    expect(resolveFogStyle(styles, "twilight")).toBe("cloud");
  });

  it("ignores garbage values", () => {
    const styles = { day: "smoke" } as unknown as Record<string, string>;
    expect(resolveFogStyle(styles as never, "day")).toBe("cloud");
  });
});

describe("normalizeFogStyles", () => {
  it("returns undefined for non-objects and all-default records", () => {
    expect(normalizeFogStyles(undefined)).toBeUndefined();
    expect(normalizeFogStyles("darkness")).toBeUndefined();
    expect(normalizeFogStyles(["darkness"])).toBeUndefined();
    expect(
      normalizeFogStyles({ day: "cloud", twilight: "cloud", night: "cloud" }),
    ).toBeUndefined();
  });

  it("keeps only valid, non-default entries", () => {
    expect(
      normalizeFogStyles({
        day: "cloud",
        twilight: "darkness",
        night: "darkness",
        dawn: "darkness",
      }),
    ).toEqual({ twilight: "darkness", night: "darkness" });
    expect(normalizeFogStyles({ night: "fog" })).toBeUndefined();
    expect(normalizeFogStyles({ twilight: "dark_cloud" })).toEqual({
      twilight: "dark_cloud",
    });
  });
});
