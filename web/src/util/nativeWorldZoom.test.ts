import { describe, expect, it } from "vitest";
import { NATIVE_TILE_CSS_PX, RENDER_SCALE, nativeWorldZoom } from "./renderScale";

const TILE = 32;
/** CSS px a tile ends up at for a given world zoom + canvas display scale. */
const tileCss = (z: number, ds: number) => TILE * RENDER_SCALE * z * ds;

describe("nativeWorldZoom", () => {
  it("shows tiles at 64 CSS px when the canvas is shown at half its backbuffer", () => {
    const z = nativeWorldZoom(0.5, TILE);
    expect(z).toBe(2);
    expect(tileCss(z, 0.5)).toBe(NATIVE_TILE_CSS_PX);
  });

  it("compensates for FIT scaling at other window sizes", () => {
    for (const ds of [0.62, 0.75, 0.9, 1]) {
      const z = nativeWorldZoom(ds, TILE);
      // within one backbuffer pixel of native
      expect(Math.abs(tileCss(z, ds) - NATIVE_TILE_CSS_PX)).toBeLessThanOrEqual(ds);
      // a tile is a whole number of backbuffer pixels
      expect(Number.isInteger(TILE * RENDER_SCALE * z)).toBe(true);
    }
  });

  it("applies Z steps as multiples of native", () => {
    expect(tileCss(nativeWorldZoom(0.5, TILE, 2), 0.5)).toBe(128);
  });

  it("falls back to the step when the display scale is unknown", () => {
    expect(nativeWorldZoom(0, TILE, 1.5)).toBe(1.5);
  });
});

describe("Z zoom steps", () => {
  it("cycle 100% → 50% → 25%", async () => {
    const { WORLD_ZOOM_STEPS, zoomStepLabel } = await import("./renderScale");
    expect([...WORLD_ZOOM_STEPS]).toEqual([1, 0.5, 0.25]);
    expect([0, 1, 2].map(zoomStepLabel)).toEqual(["100%", "50%", "25%"]);
  });
  it("50% shows tiles at 32 CSS px and 25% at 16", () => {
    expect(tileCss(nativeWorldZoom(0.5, TILE, 0.5), 0.5)).toBe(32);
    expect(tileCss(nativeWorldZoom(0.5, TILE, 0.25), 0.5)).toBe(16);
  });
});
