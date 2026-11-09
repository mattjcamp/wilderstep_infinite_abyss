import { describe, expect, it } from "vitest";
import { inheritedBackground } from "./paintBackground";

const OPAQUE = new Set([
  "floor/parquet.png",
  "floor/carpet.png",
  "rug/centre.png",
]);
const opacity = (s: string) =>
  OPAQUE.has(s) ? true : s.startsWith("loading/") ? undefined : false;

const parquet = { sprite: "floor/parquet.png" };
const chair = {
  sprite: "features/chair.png",
  background_sprite: "floor/parquet.png",
};

describe("inheritedBackground", () => {
  it("places a see-through tile on the floor it replaces", () => {
    expect(
      inheritedBackground({ sprite: "floor/carpet.png" }, chair, opacity),
    ).toBe("floor/carpet.png");
  });

  it("uses the brush's own background on an empty cell", () => {
    expect(inheritedBackground(undefined, chair, opacity)).toBe(
      "floor/parquet.png",
    );
    expect(inheritedBackground({ sprite: "" }, chair, opacity)).toBe(
      "floor/parquet.png",
    );
    expect(
      inheritedBackground(undefined, { sprite: "x.png" }, opacity),
    ).toBeUndefined();
  });

  it("keeps the cell's background when repainting the same sprite", () => {
    const placed = {
      sprite: "features/chair.png",
      background_sprite: "floor/carpet.png",
    };
    expect(inheritedBackground(placed, chair, opacity)).toBe(
      "floor/carpet.png",
    );
    expect(
      inheritedBackground({ sprite: "features/chair.png" }, chair, opacity),
    ).toBe("floor/parquet.png");
  });

  it("records nothing under an opaque brush", () => {
    expect(
      inheritedBackground({ sprite: "walls/top.png" }, parquet, opacity),
    ).toBeUndefined();
    expect(
      inheritedBackground(
        { sprite: "walls/top.png" },
        { sprite: "floor/carpet.png", background_sprite: "a.png" },
        opacity,
      ),
    ).toBe("a.png");
  });

  it("reuses a see-through tile's own background instead of stacking it", () => {
    const rugEdge = {
      sprite: "rug/top.png",
      background_sprite: "floor/carpet.png",
    };
    expect(
      inheritedBackground(rugEdge, { sprite: "rug/corner.png" }, opacity),
    ).toBe("floor/carpet.png");
  });

  it("carries a see-through tile down when it has no background of its own", () => {
    expect(
      inheritedBackground({ sprite: "objects/pots.png" }, chair, opacity),
    ).toBe("objects/pots.png");
  });

  it("carries an opaque tile down even if it has a background", () => {
    expect(
      inheritedBackground(
        { sprite: "rug/centre.png", background_sprite: "floor/parquet.png" },
        chair,
        opacity,
      ),
    ).toBe("rug/centre.png");
  });

  it("treats a still-loading brush as see-through", () => {
    expect(
      inheritedBackground(
        { sprite: "floor/carpet.png" },
        { sprite: "loading/new.png" },
        opacity,
      ),
    ).toBe("floor/carpet.png");
  });
});
