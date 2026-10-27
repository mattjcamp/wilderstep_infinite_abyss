import { describe, expect, it } from "vitest";
import { multiTileLayout } from "./multiTileLayout";

const t = (id: string, sprite: string) => ({ id, sprite });

describe("multiTileLayout", () => {
  it("places 2x2 parts at their row/col", () => {
    const tiles = [
      t("br", "town/chapel_r1c1.png"),
      t("tl", "town/chapel_r0c0.png"),
      t("tr", "town/chapel_r0c1.png"),
      t("bl", "town/chapel_r1c0.png"),
    ];
    const l = multiTileLayout(tiles)!;
    expect(l.cols).toBe(2);
    expect(l.cells.map((c) => c?.id)).toEqual(["tl", "tr", "bl", "br"]);
  });
  it("leaves a gap where a part is missing (empty tile not written)", () => {
    const l = multiTileLayout([t("a", "x_r0c0.png"), t("b", "x_r1c1.png")])!;
    expect(l.cells.map((c) => c?.id ?? null)).toEqual(["a", null, null, "b"]);
  });
  it("falls back to the list for ordinary tiles", () => {
    expect(multiTileLayout([t("a", "town/barrel_1.png"), t("b", "x_r0c0.png")])).toBeNull();
    expect(multiTileLayout([t("a", "x_r0c0.png")])).toBeNull();
  });
});
