#!/usr/bin/env node
/**
 * seed-bucket — one-time upload of the shipped static content into
 * the UGC R2 bucket, so the publish-api worker's read path can serve
 * core modules (and optionally sprites) at the same keys the static
 * site uses. See docs/dev_guides/ugc_api_contract.md.
 *
 * Usage (from web/workers/publish-api/, logged in via wrangler):
 *   node seed-bucket.mjs               # modules only (~56 files)
 *   node seed-bucket.mjs --sprites     # modules + sprites (~890 files, slow)
 *   node seed-bucket.mjs --dry-run     # print what would upload
 *
 * Each file becomes one `wrangler r2 object put` call — sequential
 * on purpose (predictable, resumable by re-running; puts are
 * idempotent overwrites). Re-running is safe.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "public");
const BUCKET = process.env.SEED_BUCKET || "wilderstep-ugc";

const includeSprites = process.argv.includes("--sprites");
const dryRun = process.argv.includes("--dry-run");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function contentTypeFor(file) {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

const roots = ["modules"];
if (includeSprites) roots.push("sprites");

const files = roots
  .flatMap((root) =>
    walk(path.join(PUBLIC_DIR, root)).map((abs) => ({
      abs,
      // R2 key = path relative to public/, forward slashes.
      key: path.relative(PUBLIC_DIR, abs).split(path.sep).join("/"),
    })),
  )
  // The hosted catalog index is SERVER-DERIVED — uploading the local
  // file would clobber entries for player-published modules (it did,
  // once). After seeding, hit <worker>/reindex (signed in) to rebuild
  // the index from every manifest actually in the bucket.
  .filter(({ key }) => key !== "modules/index.json");

console.log(
  `${dryRun ? "[dry-run] " : ""}Seeding ${files.length} files into r2://${BUCKET} (${roots.join(", ")})`,
);

let done = 0;
for (const { abs, key } of files) {
  done += 1;
  const label = `[${done}/${files.length}] ${key}`;
  if (dryRun) {
    console.log(label);
    continue;
  }
  try {
    execFileSync(
      "npx",
      [
        "wrangler",
        "r2",
        "object",
        "put",
        `${BUCKET}/${key}`,
        "--file",
        abs,
        "--content-type",
        contentTypeFor(abs),
        "--remote",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    console.log(`ok  ${label}`);
  } catch (e) {
    console.error(`ERR ${label}`);
    console.error(String(e.stderr || e.message).slice(0, 500));
    process.exitCode = 1;
  }
}

if (!dryRun && process.exitCode !== 1) {
  console.log(
    "\nDone. Now rebuild the hosted catalog index: open <worker-url>/reindex" +
      "\nin a signed-in browser (the index is server-derived; seeding never writes it).",
  );
}
