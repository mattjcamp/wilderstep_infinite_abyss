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
 *
 * Afterwards the hosted catalog (modules/index.json) is refreshed:
 * its built-in entries are replaced by the repo's index (so pushed
 * modules appear and removed ones drop off) while player-published
 * "@handle/…" entries are kept — see catalogMerge.mjs.
 * `--no-catalog` skips that step.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { mergeCatalog } from "./catalogMerge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "public");
const BUCKET = process.env.SEED_BUCKET || "wilderstep-ugc";

const includeSprites = process.argv.includes("--sprites");
const dryRun = process.argv.includes("--dry-run");
const updateCatalog = !process.argv.includes("--no-catalog");

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

// ── Refresh the hosted catalog's built-in entries ─────────────────
function wrangler(args, opts = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

if (updateCatalog && process.exitCode !== 1) {
  const shipped = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_DIR, "modules", "index.json"), "utf8"),
  );
  let hosted = null;
  if (!dryRun) {
    try {
      const raw = wrangler([
        "r2", "object", "get", `${BUCKET}/modules/index.json`, "--remote", "--pipe",
      ]).toString("utf8");
      hosted = JSON.parse(raw);
    } catch (e) {
      // Missing or unreadable: start from the shipped list alone
      // (player entries would be restored by a later /reindex).
      console.warn(
        "Couldn't read the hosted catalog; writing built-in entries only.\n" +
          String(e.stderr || e.message).slice(0, 300),
      );
    }
  }
  const merged = mergeCatalog(hosted, shipped);
  const ids = merged.modules.map((m) => m.id).join(", ");
  if (dryRun) {
    console.log(`[dry-run] catalog would list: ${ids}`);
  } else {
    const tmp = path.join(os.tmpdir(), `catalog-${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
    try {
      wrangler([
        "r2", "object", "put", `${BUCKET}/modules/index.json`,
        "--file", tmp, "--content-type", "application/json", "--remote",
      ]);
      console.log(`Catalog updated: ${ids}`);
    } catch (e) {
      console.error("ERR updating the hosted catalog");
      console.error(String(e.stderr || e.message).slice(0, 500));
      process.exitCode = 1;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
}
