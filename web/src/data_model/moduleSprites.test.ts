/**
 * Guard: every sprite a shipped module references must exist on disk.
 *
 * Maps copy each tile's sprite path into every cell, so archiving or
 * renaming a sprite silently breaks maps until someone walks onto them.
 * This scans every module JSON for sprite paths (and item icons) and
 * fails with the full list of missing files.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(__dirname, "../../public");
const MODULES = join(PUBLIC, "modules");
const SPRITE_RE = /^(map|person|monster|item)\/[^"]+\.png$/;

function collect(node: unknown, out: Set<string>, key = ""): void {
  if (typeof node === "string") {
    if (SPRITE_RE.test(node)) out.add(node);
    else if (key === "icon" && node) out.add(`item/${node.replace(/\.png$/, "")}.png`);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collect(v, out, key);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) collect(v, out, k);
  }
}

const modules = readdirSync(MODULES).filter((d) =>
  statSync(join(MODULES, d)).isDirectory(),
);

describe("module sprite references", () => {
  for (const mod of modules) {
    it(`${mod}: every referenced sprite exists`, () => {
      const refs = new Set<string>();
      for (const f of readdirSync(join(MODULES, mod))) {
        if (!f.endsWith(".json")) continue;
        collect(JSON.parse(readFileSync(join(MODULES, mod, f), "utf-8")), refs);
      }
      const missing = [...refs]
        .filter((s) => !existsSync(join(PUBLIC, "sprites", s)))
        .sort();
      expect(missing).toEqual([]);
    });
  }
});
