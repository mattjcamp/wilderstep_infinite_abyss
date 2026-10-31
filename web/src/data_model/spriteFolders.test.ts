/**
 * Sprite folders mirror the Tile Palette tag hierarchy: a Default
 * palette tile tagged "town:house:chapel" keeps its art in
 * sprites/town/house/chapel/. These tests pin that layout, the legacy
 * path aliases from the reorg, and the nested sprite index.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import aliasData from "./spriteAliases.json";
import {
  canonicalSpritePath,
  clearSpriteRouting,
  spriteUrl,
  __setSpriteLayersForTests,
  __setSpriteRoutingForTests,
} from "./spriteUrl";
// @ts-expect-error — plain .mjs build script, no type declarations
import { listPngsRecursive, reindexModuleSprites } from "../../scripts/reindex-sprites.mjs";

const MODULES = join(__dirname, "../../public/modules");
const aliases = (aliasData as { aliases: Record<string, string> }).aliases;

/** Tag segment → folder name ("doors & stairs" → "doors_and_stairs"). */
const slug = (s: string) =>
  s.trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

afterEach(() => clearSpriteRouting());

describe("Default sprite folders", () => {
  const tiles = JSON.parse(
    readFileSync(join(MODULES, "default/map_tiles.json"), "utf-8"),
  ).map_tiles as Array<{ id: string; tag?: string; sprite: string }>;
  const index = JSON.parse(
    readFileSync(join(MODULES, "default/sprites/index.json"), "utf-8"),
  ).categories as Record<string, string[]>;
  const indexed = new Set(
    Object.entries(index).flatMap(([c, fs]) => fs.map((f) => `${c}/${f}`)),
  );

  it("every palette tile's sprite sits in the folder its tag names", () => {
    const wrong = tiles
      .filter((t) => t.tag)
      .filter((t) => {
        const want = t.tag!.split(":").filter((s) => s.trim()).map(slug).join("/");
        return t.sprite.slice(0, t.sprite.lastIndexOf("/")) !== want;
      })
      .map((t) => `${t.id}: ${t.sprite} (tag ${t.tag})`);
    expect(wrong).toEqual([]);
  });

  it("every palette tile's sprite exists and is indexed", () => {
    const missing = tiles
      .filter((t) => !indexed.has(t.sprite) || !existsSync(join(MODULES, "default/sprites", t.sprite)))
      .map((t) => t.sprite);
    expect(missing).toEqual([]);
  });

  it("every legacy alias points at an indexed sprite, and no legacy path is still on disk", () => {
    for (const [from, to] of Object.entries(aliases)) {
      expect(indexed.has(to), `${from} → ${to}`).toBe(true);
      expect(existsSync(join(MODULES, "default/sprites", from)), from).toBe(false);
    }
  });
});

describe("legacy sprite paths", () => {
  it("canonicalise to the new folder", () => {
    expect(canonicalSpritePath("overworld/forest.png")).toBe(aliases["overworld/forest.png"]);
    expect(canonicalSpritePath("/sprites/map/water.png")).toBe("water/water.png");
    expect(canonicalSpritePath("person/hero.png")).toBe("person/hero.png");
  });

  it("resolve to the new location in Default", () => {
    expect(spriteUrl("map/water.png")).toBe("/modules/default/sprites/water/water.png");
  });

  it("still prefer an override a module ships at the legacy path", () => {
    __setSpriteLayersForTests([
      ["mymod", { map: ["water.png"] }],
      ["default", { water: ["water.png"] }],
    ]);
    expect(spriteUrl("map/water.png")).toBe("/modules/mymod/sprites/map/water.png");
  });

  it("follow an override a module ships at the new path", () => {
    __setSpriteLayersForTests([
      ["mymod", { water: ["water.png"] }],
      ["default", { water: ["water.png"] }],
    ]);
    expect(spriteUrl("map/water.png")).toBe("/modules/mymod/sprites/water/water.png");
  });

  it("route a nested custom upload to the owner prefix", () => {
    __setSpriteRoutingForTests("matt", "https://api.example.dev", {
      town: ["house/chapel/door.png"],
    });
    expect(spriteUrl("town/house/chapel/door.png")).toBe(
      "https://api.example.dev/sprites/@matt/town/house/chapel/door.png",
    );
  });
});

describe("reindex-sprites", () => {
  it("lists PNGs in subfolders as category-relative paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "sprites-"));
    const sp = join(root, "m", "sprites");
    mkdirSync(join(sp, "town", "house", "chapel"), { recursive: true });
    mkdirSync(join(sp, "town", ".hidden"), { recursive: true });
    writeFileSync(join(sp, "town", "well.png"), "");
    writeFileSync(join(sp, "town", "house", "chapel", "door.png"), "");
    writeFileSync(join(sp, "town", ".hidden", "x.png"), "");
    writeFileSync(join(sp, "town", "notes.txt"), "");
    expect(await listPngsRecursive(join(sp, "town"))).toEqual(["house/chapel/door.png", "well.png"]);
    await reindexModuleSprites("m", root);
    const idx = JSON.parse(readFileSync(join(sp, "index.json"), "utf-8"));
    expect(idx.categories).toEqual({ town: ["house/chapel/door.png", "well.png"] });
  });
});
