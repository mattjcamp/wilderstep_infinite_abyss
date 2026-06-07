#!/usr/bin/env node
/**
 * publish-server — tiny local HTTP server that lets the editor write
 * directly to web/public/modules/ during authoring.
 *
 * Run alongside `next dev`:
 *   node scripts/publish-server.mjs
 *   # or via npm: npm run publish-server
 *
 * The editor probes GET /status at mount; when reachable, Publish
 * buttons appear in the UI. POST /publish takes a typed batch of
 * write/delete operations and applies them to disk.
 *
 * Safety:
 *   - All operations are constrained to PUBLISH_MODULES_ROOT (defaults
 *     to web/public/modules/ relative to this script).
 *   - moduleId and fileName values are validated by regex (no path
 *     separators, no leading dots).
 *   - Every resolved path is checked to be inside the modules root
 *     before any write/delete.
 *   - The "default" module is refused for delete-module operations.
 *
 * This server only runs locally during authoring. It is not deployed
 * — the static export build under output:'export' has no /api routes
 * and no Node process, so the deployed editor's Publish buttons
 * silently stay hidden.
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PUBLISH_PORT || 4001);
const MODULES_ROOT = path.resolve(
  process.env.PUBLISH_MODULES_ROOT ||
    path.join(__dirname, "..", "public", "modules"),
);
// Sprite assets live alongside module data but in a dedicated tree
// — the static export serves both at runtime. The publish-server's
// sprite item kind writes here; path-traversal protection mirrors
// the modules-root checks below.
const SPRITES_ROOT = path.resolve(
  process.env.PUBLISH_SPRITES_ROOT ||
    path.join(__dirname, "..", "public", "sprites"),
);
// Audio catalog lives under public/audio/ with a flat index.json. The
// `audio-index` item kind rewrites that index when an author tweaks
// per-track volume in the editor; same path-traversal protection.
const AUDIO_ROOT = path.resolve(
  process.env.PUBLISH_AUDIO_ROOT ||
    path.join(__dirname, "..", "public", "audio"),
);

const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;
const FILENAME_RE = /^[a-z][a-z0-9_]*\.json$/;
// Sprite categories use the existing folder naming style: lowercase
// alphanumerics + underscores ("item", "map", "monster", "person",
// future "vfx", etc.). New categories materialise the first time a
// sprite is published into them.
const SPRITE_CATEGORY_RE = /^[a-z][a-z0-9_]*$/;
// Sprite filenames are more permissive than the JSON files — the
// shipped catalog uses both digits (`cleric3.png`) and underscores
// (`armor_heavy.png`). Leading-character constraint protects against
// hidden / dotfile names; trailing `.png` is required.
const SPRITE_FILENAME_RE = /^[a-z0-9_][a-z0-9_-]*\.png$/i;
const PROTECTED_MODULE_IDS = new Set(["default"]);
const SPRITE_INDEX_COMMENT =
  "Sprite catalog (generated). Each top-level key is a category folder under web/public/sprites/; each value is the list of PNG filenames in that folder. Resolve a sprite path as `/sprites/<category>/<filename>` (apply basePath at runtime).";
// Audio track paths the editor sends back must look like
// `/audio/<filename>.<ext>` — a single segment under /audio/ with a
// known audio extension. The filename may contain spaces and
// punctuation (real tracks are named "Money, Money, Money.mp3",
// "Sweet Child O' Mine.mp3", etc. — reindex-audio derives the path
// straight from the on-disk name), so we allow any character EXCEPT a
// path separator or control char, and forbid a leading "." (no
// directory traversal, no dotfiles). The on-disk write target is
// derived from the basename only, then re-checked against AUDIO_ROOT.
const AUDIO_PATH_RE =
  /^\/audio\/[^/.\x00-\x1f][^/\x00-\x1f]*\.(mp3|ogg|wav|m4a)$/i;
const AUDIO_INDEX_COMMENT =
  "Listing of every audio file under /public/audio/. Hand-maintained for now — Next.js static export can't directory-list at runtime, so the editor's SoundtrackPicker reads this file to know what tracks are available. Run `npm run reindex-audio` after dropping a file in this folder to regenerate it. Each `path` is what gets stored on a module / map / dungeon's soundtrack list and is what the SoundtrackPlayer hands to <audio>.src; `name` is the display label in the picker; optional `gain` (0-1) attenuates a track that's too loud relative to the rest of the soundtrack.";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(body));
}

/** Resolve an absolute path and assert it lives inside MODULES_ROOT.
 *  Path-traversal protection in depth — even if a regex check upstream
 *  somehow lets a bad value through, this catches it. */
function resolveInsideRoot(absPath) {
  const resolved = path.resolve(absPath);
  const root = path.resolve(MODULES_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(
      `Refusing path outside modules root: ${resolved}`,
    );
  }
  return resolved;
}

/** Same guard as resolveInsideRoot but for SPRITES_ROOT. Sprite
 *  publishing has its own tree (`public/sprites/`) so neither root
 *  can leak into the other. */
function resolveInsideSpritesRoot(absPath) {
  const resolved = path.resolve(absPath);
  const root = path.resolve(SPRITES_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing path outside sprites root: ${resolved}`);
  }
  return resolved;
}

/** Same guard as resolveInsideRoot but for AUDIO_ROOT. */
function resolveInsideAudioRoot(absPath) {
  const resolved = path.resolve(absPath);
  const root = path.resolve(AUDIO_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing path outside audio root: ${resolved}`);
  }
  return resolved;
}

/** Validate + normalise the editor's audio track list into the
 *  on-disk index shape. Rejects malformed paths (path-traversal in
 *  depth — only basenames under /audio/ with a known extension pass),
 *  clamps `gain` to [0,1], and drops it when it's the default 1 so
 *  the file stays clean. De-dupes by path, last write wins. */
function sanitizeAudioTracks(tracks) {
  if (!Array.isArray(tracks)) {
    throw new Error("audio-index requires a `tracks` array");
  }
  const byPath = new Map();
  for (const t of tracks) {
    if (!t || typeof t.path !== "string" || !AUDIO_PATH_RE.test(t.path)) {
      throw new Error(`Invalid audio track path: ${JSON.stringify(t && t.path)}`);
    }
    // Re-assert the basename resolves inside the audio root.
    resolveInsideAudioRoot(path.join(AUDIO_ROOT, path.basename(t.path)));
    const entry = { path: t.path };
    if (typeof t.name === "string" && t.name.length > 0) entry.name = t.name;
    if (t.gain != null) {
      const g = Number(t.gain);
      if (!Number.isFinite(g)) {
        throw new Error(`Invalid gain for ${t.path}: ${JSON.stringify(t.gain)}`);
      }
      const clamped = Math.max(0, Math.min(1, g));
      // Omit the default so untouched tracks don't carry noise.
      if (clamped !== 1) entry.gain = clamped;
    }
    byPath.set(entry.path, entry);
  }
  return Array.from(byPath.values());
}

/** Decode the editor's "data:image/png;base64,…" payload into a
 *  Buffer ready for fs.writeFile. Rejects non-PNG MIME types so a
 *  bug in the client can't accidentally publish a JPEG into the
 *  PNG-only sprite tree. */
function pngBufferFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") {
    throw new Error("dataUrl must be a string");
  }
  const m = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);
  if (!m) {
    throw new Error(
      "dataUrl must be a base64-encoded image/png payload",
    );
  }
  return Buffer.from(m[1], "base64");
}

/** Walk `public/sprites/` and rebuild index.json from whatever PNGs
 *  are on disk. Used by the `sprite-index` item kind AND auto-fired
 *  after every successful `sprite` / `delete-sprite` write so the
 *  catalog the editor reads stays in sync without a separate round
 *  trip. */
async function regenerateSpriteIndex() {
  const indexPath = resolveInsideSpritesRoot(
    path.join(SPRITES_ROOT, "index.json"),
  );
  let categories;
  try {
    categories = (await fs.readdir(SPRITES_ROOT, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch (e) {
    // Sprites root not yet on disk → nothing to index. The next
    // publish will create the directory and rerun this.
    if (e && e.code === "ENOENT") return { path: indexPath, totalFiles: 0 };
    throw e;
  }
  const out = {
    _comment: SPRITE_INDEX_COMMENT,
    categories: {},
  };
  let totalFiles = 0;
  for (const cat of categories) {
    const dir = path.join(SPRITES_ROOT, cat);
    const files = (await fs.readdir(dir, { withFileTypes: true }))
      .filter(
        (e) =>
          e.isFile() &&
          !e.name.startsWith(".") &&
          e.name.toLowerCase().endsWith(".png"),
      )
      .map((e) => e.name)
      .sort();
    out.categories[cat] = files;
    totalFiles += files.length;
  }
  await fs.writeFile(indexPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  return { path: indexPath, totalFiles };
}

async function writeJson(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(content, null, 2) + "\n",
    "utf8",
  );
}

async function handleItem(item) {
  if (!item || typeof item !== "object") {
    throw new Error("Item must be an object");
  }

  if (item.kind === "manifest") {
    if (typeof item.moduleId !== "string" || !MODULE_ID_RE.test(item.moduleId)) {
      throw new Error(`Invalid moduleId: ${JSON.stringify(item.moduleId)}`);
    }
    const filePath = resolveInsideRoot(
      path.join(MODULES_ROOT, item.moduleId, "module.json"),
    );
    await writeJson(filePath, item.content);
    return { path: filePath };
  }

  if (item.kind === "model") {
    if (typeof item.moduleId !== "string" || !MODULE_ID_RE.test(item.moduleId)) {
      throw new Error(`Invalid moduleId: ${JSON.stringify(item.moduleId)}`);
    }
    if (typeof item.fileName !== "string" || !FILENAME_RE.test(item.fileName)) {
      throw new Error(`Invalid fileName: ${JSON.stringify(item.fileName)}`);
    }
    const filePath = resolveInsideRoot(
      path.join(MODULES_ROOT, item.moduleId, item.fileName),
    );
    await writeJson(filePath, item.content);
    return { path: filePath };
  }

  if (item.kind === "index") {
    const filePath = resolveInsideRoot(
      path.join(MODULES_ROOT, "index.json"),
    );
    await writeJson(filePath, item.content);
    return { path: filePath };
  }

  if (item.kind === "delete-module") {
    if (typeof item.moduleId !== "string" || !MODULE_ID_RE.test(item.moduleId)) {
      throw new Error(`Invalid moduleId: ${JSON.stringify(item.moduleId)}`);
    }
    if (PROTECTED_MODULE_IDS.has(item.moduleId)) {
      throw new Error(
        `Refusing to delete protected module: ${item.moduleId}`,
      );
    }
    const dir = resolveInsideRoot(path.join(MODULES_ROOT, item.moduleId));
    await fs.rm(dir, { recursive: true, force: true });
    return { path: dir };
  }

  if (item.kind === "sprite") {
    // Write a PNG into public/sprites/<category>/<filename>. The
    // payload is a base64 data URL the PixelEditor produces via
    // canvas.toDataURL("image/png"). After the write the sprite
    // index is regenerated so a category gaining its first sprite
    // gets the index entry without a follow-on call.
    if (
      typeof item.category !== "string" ||
      !SPRITE_CATEGORY_RE.test(item.category)
    ) {
      throw new Error(
        `Invalid sprite category: ${JSON.stringify(item.category)}`,
      );
    }
    if (
      typeof item.fileName !== "string" ||
      !SPRITE_FILENAME_RE.test(item.fileName)
    ) {
      throw new Error(
        `Invalid sprite fileName: ${JSON.stringify(item.fileName)}`,
      );
    }
    const buf = pngBufferFromDataUrl(item.dataUrl);
    const filePath = resolveInsideSpritesRoot(
      path.join(SPRITES_ROOT, item.category, item.fileName),
    );
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buf);
    const indexResult = await regenerateSpriteIndex();
    return { path: filePath, indexPath: indexResult.path };
  }

  if (item.kind === "sprite-index") {
    // Explicit "regenerate the catalog" call — useful for hand-edited
    // sprite copies, or as a sanity-check button in the UI.
    const result = await regenerateSpriteIndex();
    return { path: result.path, totalFiles: result.totalFiles };
  }

  if (item.kind === "delete-sprite") {
    if (
      typeof item.category !== "string" ||
      !SPRITE_CATEGORY_RE.test(item.category)
    ) {
      throw new Error(
        `Invalid sprite category: ${JSON.stringify(item.category)}`,
      );
    }
    if (
      typeof item.fileName !== "string" ||
      !SPRITE_FILENAME_RE.test(item.fileName)
    ) {
      throw new Error(
        `Invalid sprite fileName: ${JSON.stringify(item.fileName)}`,
      );
    }
    const filePath = resolveInsideSpritesRoot(
      path.join(SPRITES_ROOT, item.category, item.fileName),
    );
    await fs.rm(filePath, { force: true });
    const indexResult = await regenerateSpriteIndex();
    return { path: filePath, indexPath: indexResult.path };
  }

  if (item.kind === "audio-index") {
    // Rewrite public/audio/index.json from the editor's track list.
    // The editor sends the whole catalog back (paths + names + the
    // per-track gain the author just set); we validate, normalise,
    // and write it with the canonical comment.
    const tracks = sanitizeAudioTracks(item.tracks);
    const filePath = resolveInsideAudioRoot(
      path.join(AUDIO_ROOT, "index.json"),
    );
    await writeJson(filePath, { _comment: AUDIO_INDEX_COMMENT, tracks });
    return { path: filePath, totalTracks: tracks.length };
  }

  throw new Error(`Unknown item kind: ${JSON.stringify(item.kind)}`);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function handlePublish(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch (e) {
    sendJson(res, 400, { error: `Invalid JSON: ${e.message}` });
    return;
  }
  if (!body || !Array.isArray(body.items)) {
    sendJson(res, 400, { error: "Body must be { items: [...] }" });
    return;
  }
  const results = [];
  for (const item of body.items) {
    try {
      const out = await handleItem(item);
      results.push({ ok: true, item, ...out });
    } catch (e) {
      results.push({ ok: false, item, error: e.message });
    }
  }
  sendJson(res, 200, { results });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/status") {
      sendJson(res, 200, {
        ok: true,
        modulesRoot: MODULES_ROOT,
        port: PORT,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/publish") {
      await handlePublish(req, res);
      return;
    }
    sendJson(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("publish-server error:", e);
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`publish-server listening on http://127.0.0.1:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`module writes go under ${MODULES_ROOT}`);
  // eslint-disable-next-line no-console
  console.log(`sprite writes go under ${SPRITES_ROOT}`);
});
