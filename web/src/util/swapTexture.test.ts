import { describe, expect, it } from "vitest";
import { swapTexture } from "./renderScale";

/** Mimics Phaser: setTexture keeps scale, so display size follows the
 *  new texture's native size. */
function fakeImage(native: number) {
  const img = {
    scale: 1,
    native,
    get displayWidth() { return this.native * this.scale; },
    get displayHeight() { return this.native * this.scale; },
    setTexture(key: string) { this.native = key === "big" ? 64 : 32; return this; },
    setDisplaySize(w: number) { this.scale = w / this.native; return this; },
  };
  return img;
}

describe("swapTexture", () => {
  it("keeps the on-screen size when swapping 32px art for 64px art", () => {
    const img = fakeImage(32).setDisplaySize(32);
    swapTexture(img, "big");
    expect(img.displayWidth).toBe(32);
    expect(img.displayHeight).toBe(32);
  });
  it("still swaps when the object has no display size (test fakes)", () => {
    let key = "";
    swapTexture({ setTexture: (k: string) => (key = k) }, "x");
    expect(key).toBe("x");
  });
});
