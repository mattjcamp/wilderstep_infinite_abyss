#!/usr/bin/env node
/**
 * reindex-sprites — rebuild `web/public/sprites/index.json` from the
 * PNGs currently on disk.
 *
 * The sprite browser (and the rest of the editor) reads index.json,
 * not the directory itself, because the static build has no
 * filesystem API at runtime. When an author drops a new PNG into
 * `public/sprites/<category>/`, this script needs to run so the
 * catalog picks it up.
 *
 * Usage:
 *   node scripts/reindex-sprites.mjs
 *   # or via npm:
 *   npm run reindex-sprites
 *
 * Output:
 *   - Walks every immediate subdirectory of `public/sprites/`,
 *     collects `.png` filenames, and writes a sorted catalog grouped
 *     by category folder.
 *   - The `_comment` field is preserved (or re-injected if missing)
 *     so future readers know how the file is structured.
 *
 * Safety:
 *   - Only writes inside `public/sprites/`.
 *   - Skips hidden files (`.DS_Store`, etc.) and non-PNG entries.
 *   - Idempotent — running twice in a row is a no-op when nothing
 *     has changed.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPRITES_ROOT = path.resolve(__dirname, "..", "public", "sprites");
const INDEX_PATH = path.join(SPRITES_ROOT, "index.json");

const COMMENT =
  "Sprite catalog (generated). Each top-level key is a category folder under web/public/sprites/; each value is the list of PNG filenames in that folder. Resolve a sprite path as `/sprites/<category>/<filename>` (apply basePath at runtime).";

async function listCategoryDirs() {
  const entries = await fs.readdir(SPRITES_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

async function listPngsIn(category) {
  const dir = path.join(SPRITES_ROOT, category);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(
      (e) =>
        e.isFile() &&
        !e.name.startsWith(".") &&
        e.name.toLowerCase().endsWith(".png"),
    )
    .map((e) => e.name)
    .sort();
}

async function readCurrentIndex() {
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const categories = await listCategoryDirs();
  const out = {
    _comment: COMMENT,
    categories: {},
  };
  for (const cat of categories) {
    out.categories[cat] = await listPngsIn(cat);
  }
  const next = JSON.stringify(out, null, 2) + "\n";
  const current = await readCurrentIndex();
  const currentSerialized = current ? JSON.stringify(current, null, 2) + "\n" : "";
  if (current && currentSerialized === next) {
    console.log("reindex-sprites: index.json already up to date.");
    return;
  }
  await fs.writeFile(INDEX_PATH, next, "utf8");
  // Report a short summary so the author can sanity-check.
  const totalFiles = Object.values(out.categories).reduce(
    (n, arr) => n + arr.length,
    0,
  );
  console.log(
    `reindex-sprites: wrote ${totalFiles} files across ${categories.length} categories.`,
  );
  for (const cat of categories) {
    console.log(`  ${cat}: ${out.categories[cat].length}`);
  }
}

main().catch((err) => {
  console.error("reindex-sprites failed:", err);
  process.exit(1);
});
