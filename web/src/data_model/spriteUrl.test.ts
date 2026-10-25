/**
 * spriteUrl routing matrix — custom published sprites must route to the
 * worker (owner-prefixed) while stock sprites stay on the static
 * origin, and the whole thing must be a strict no-op off the
 * remote/hosted path.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  spriteUrl,
  clearSpriteRouting,
  fetchSpriteCatalog,
  __setSpriteRoutingForTests,
  __setSpriteLayersForTests,
  spriteLayerOrder,
} from "./spriteUrl";

const HOST = "https://api.example.dev";

afterEach(() => {
  clearSpriteRouting();
});

describe("spriteUrl", () => {
  it("routes to stock origin when no routing is seeded (local/static)", () => {
    expect(spriteUrl("person/hero.png")).toBe("/modules/default/sprites/person/hero.png");
    expect(spriteUrl("monster/goblin.png")).toBe("/modules/default/sprites/monster/goblin.png");
  });

  it("routes a custom upload (in the owner index) to the worker, owner-prefixed", () => {
    __setSpriteRoutingForTests("matt", HOST, { person: ["hero.png"] });
    expect(spriteUrl("person/hero.png")).toBe(
      `${HOST}/sprites/@matt/person/hero.png`,
    );
  });

  it("leaves a sprite NOT in the owner index on the stock origin", () => {
    __setSpriteRoutingForTests("matt", HOST, { person: ["hero.png"] });
    // stock sprite the author didn't upload — stays on origin
    expect(spriteUrl("person/fighter6.png")).toBe(
      "/modules/default/sprites/person/fighter6.png",
    );
    // a different category entirely
    expect(spriteUrl("monster/goblin.png")).toBe("/modules/default/sprites/monster/goblin.png");
  });

  it("is a no-op when there is a host but no owner handle (bare/@core module)", () => {
    __setSpriteRoutingForTests(null, HOST, { person: ["hero.png"] });
    expect(spriteUrl("person/hero.png")).toBe("/modules/default/sprites/person/hero.png");
  });

  it("matches the worker index shape: bare filename per category, not category/file", () => {
    __setSpriteRoutingForTests("matt", HOST, { person: ["hero.png"] });
    // index stores "hero.png" under "person"; the ref "person/hero.png"
    // must split correctly and match.
    expect(spriteUrl("person/hero.png")).toBe(
      `${HOST}/sprites/@matt/person/hero.png`,
    );
    // a top-level-only ref (no category) can never match
    expect(spriteUrl("hero.png")).toBe("/modules/default/sprites/hero.png");
  });

  it("normalizes leading slash / sprites prefix before routing", () => {
    __setSpriteRoutingForTests("matt", HOST, { map: ["lava.png"] });
    for (const input of [
      "map/lava.png",
      "/sprites/map/lava.png",
      "sprites/map/lava.png",
    ]) {
      expect(spriteUrl(input)).toBe(`${HOST}/sprites/@matt/map/lava.png`);
    }
  });

  it("passes absolute http(s) URLs through untouched", () => {
    __setSpriteRoutingForTests("matt", HOST, { person: ["hero.png"] });
    const abs = "https://cdn.example.com/x.png";
    expect(spriteUrl(abs)).toBe(abs);
  });
});

describe("module sprite layers", () => {
  it("serves base art from the Default module when nothing is seeded", () => {
    expect(spriteUrl("map/grass.png")).toBe("/modules/default/sprites/map/grass.png");
  });

  it("uses the nearest module in the chain that has the file", () => {
    __setSpriteLayersForTests([
      ["dark-icons", { map: ["grass.png"] }],
      ["default", { map: ["grass.png", "water.png"] }],
    ]);
    expect(spriteUrl("map/grass.png")).toBe("/modules/dark-icons/sprites/map/grass.png");
    // Not drawn in the nearer module yet → falls back to the base art.
    expect(spriteUrl("map/water.png")).toBe("/modules/default/sprites/map/water.png");
  });

  it("an owner's custom upload still wins over every module layer", () => {
    __setSpriteLayersForTests([["dark-icons", { map: ["grass.png"] }]]);
    __setSpriteRoutingForTests("matt", HOST, { map: ["grass.png"] });
    expect(spriteUrl("map/grass.png")).toBe(`${HOST}/sprites/@matt/map/grass.png`);
  });

  it("merges the catalog across layers and records which module supplies each file", async () => {
    __setSpriteLayersForTests([
      ["dark-icons", { map: ["grass.png"] }],
      ["default", { map: ["grass.png", "water.png"], item: ["torch.png"] }],
    ]);
    const cat = await fetchSpriteCatalog();
    expect(cat.categories).toEqual({ map: ["grass.png", "water.png"], item: ["torch.png"] });
    expect(cat.origin["map/grass.png"]).toBe("dark-icons");
    expect(cat.origin["map/water.png"]).toBe("default");
  });
});

describe("spriteLayerOrder (art themes)", () => {
  it("module's own art, then its theme, then parents, then Default", () => {
    expect(
      spriteLayerOrder([
        { id: "hallowmere", extends: "base-adventure", theme: "dark-icons" },
        { id: "base-adventure", extends: "default" },
        { id: "default" },
      ]),
    ).toEqual(["hallowmere", "dark-icons", "base-adventure", "default"]);
  });

  it("inherits the nearest parent's theme when the module sets none", () => {
    expect(
      spriteLayerOrder([
        { id: "chapter-2", extends: "chapter-1" },
        { id: "chapter-1", extends: "default", theme: "colorful" },
        { id: "default" },
      ]),
    ).toEqual(["chapter-2", "colorful", "chapter-1", "default"]);
  });

  it("a theme module itself layers over Default", () => {
    expect(
      spriteLayerOrder([{ id: "dark-icons", extends: "default" }, { id: "default" }]),
    ).toEqual(["dark-icons", "default"]);
  });

  it("always ends with Default even when the chain is cut short", () => {
    expect(spriteLayerOrder([{ id: "test", theme: "dark-icons" }])).toEqual([
      "test",
      "dark-icons",
      "default",
    ]);
  });
});
