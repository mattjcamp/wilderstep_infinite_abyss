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

const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;
const FILENAME_RE = /^[a-z][a-z0-9_]*\.json$/;
const PROTECTED_MODULE_IDS = new Set(["default"]);

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
  console.log(`writes go under ${MODULES_ROOT}`);
});
