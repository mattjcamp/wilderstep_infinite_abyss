/**
 * Guard: every sprite URL is built by `spriteUrl()` / `spriteIndexUrl()`
 * in src/data_model/spriteUrl.ts. That one function is where custom
 * uploads, module art themes and the per-module sprite layout are
 * decided, so a hand-built `/sprites/...` link would silently bypass
 * all of them.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = join(__dirname, "../..");
const ALLOWED = new Set(["src/data_model/spriteUrl.ts"]);
// withBasePath("/sprites/…") / withBase(`/sprites/${…}`) and friends.
const HAND_BUILT = /\bwithBase(?:Path)?\(\s*[`"']\/sprites\//;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
}

describe("sprite URLs", () => {
  it("are only built in spriteUrl.ts", () => {
    const files: string[] = [];
    walk(join(WEB, "src"), files);
    walk(join(WEB, "app"), files);
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(WEB, f);
      if (ALLOWED.has(rel)) continue;
      readFileSync(f, "utf-8")
        .split("\n")
        .forEach((line, i) => {
          if (HAND_BUILT.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
