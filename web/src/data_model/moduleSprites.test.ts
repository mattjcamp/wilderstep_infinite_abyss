/**
 * Guard: every sprite a shipped module references must exist on disk.
 *
 * Maps copy each tile's sprite path into every cell, so archiving or
 * renaming a sprite silently breaks maps until someone walks onto them.
 * This scans every module JSON for sprite paths (and item icons) and
 * fails with the full list of missing files. Sprites live in each
 * module's own `sprites/` folder; the base art is in Default's.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(__dirname, "../../public");
const MODULES = join(PUBLIC, "modules");
const SPRITE_RE = /^(map|indoor|dungeon|objects|person|monster|item)\/[^"]+\.png$/;

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

function moduleChain(id: string): string[] {
  const chain: string[] = [];
  let cur: string | undefined = id;
  while (cur && !chain.includes(cur)) {
    chain.push(cur);
    const manifest = join(MODULES, cur, "module.json");
    const meta = existsSync(manifest)
      ? (JSON.parse(readFileSync(manifest, "utf-8")) as {
          extends?: string;
          theme?: string;
        })
      : {};
    // An art theme's sprites count too (order doesn't matter here).
    if (meta.theme && !chain.includes(meta.theme)) chain.push(meta.theme);
    cur = meta.extends ?? (cur === "default" ? undefined : "default");
  }
  return chain;
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
      // A reference resolves to the nearest module in the chain (the
      // module, its art theme, its parents, then Default) that ships it.
      const chain = moduleChain(mod);
      const missing = [...refs]
        .filter(
          (s) => !chain.some((m) => existsSync(join(MODULES, m, "sprites", s))),
        )
        .sort();
      expect(missing).toEqual([]);
    });
  }
});
