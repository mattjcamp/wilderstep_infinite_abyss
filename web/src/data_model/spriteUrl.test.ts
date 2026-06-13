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
  __setSpriteRoutingForTests,
} from "./spriteUrl";

const HOST = "https://api.example.dev";

afterEach(() => {
  clearSpriteRouting();
});

describe("spriteUrl", () => {
  it("routes to stock origin when no routing is seeded (local/static)", () => {
    expect(spriteUrl("person/hero.png")).toBe("/sprites/person/hero.png");
    expect(spriteUrl("monster/goblin.png")).toBe("/sprites/monster/goblin.png");
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
      "/sprites/person/fighter6.png",
    );
    // a different category entirely
    expect(spriteUrl("monster/goblin.png")).toBe("/sprites/monster/goblin.png");
  });

  it("is a no-op when there is a host but no owner handle (bare/@core module)", () => {
    __setSpriteRoutingForTests(null, HOST, { person: ["hero.png"] });
    expect(spriteUrl("person/hero.png")).toBe("/sprites/person/hero.png");
  });

  it("matches the worker index shape: bare filename per category, not category/file", () => {
    __setSpriteRoutingForTests("matt", HOST, { person: ["hero.png"] });
    // index stores "hero.png" under "person"; the ref "person/hero.png"
    // must split correctly and match.
    expect(spriteUrl("person/hero.png")).toBe(
      `${HOST}/sprites/@matt/person/hero.png`,
    );
    // a top-level-only ref (no category) can never match
    expect(spriteUrl("hero.png")).toBe("/sprites/hero.png");
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
