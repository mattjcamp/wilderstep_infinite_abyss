/**
 * publish-api — Cloudflare Worker port of scripts/publish-server.mjs
 * for player-published modules (UGC). See
 * docs/dev_guides/ugc_api_contract.md for the wire contract and
 * docs/dev_guides/ugc_publishing_plan.md for the architecture.
 *
 * Differences from the local server, by design:
 *   - AUTH + OWNERSHIP. Callers must authenticate; every write is
 *     constrained to ids/prefixes the caller's handle owns
 *     (`@handle/slug` modules, `sprites/@handle/...` sprites).
 *     System content (bare ids, the global sprite tree, the audio
 *     catalog, the catalog index) is read-only through this API.
 *   - STORAGE. Writes go to an R2 bucket (env.BUCKET) using the same
 *     key layout the static export uses on disk.
 *   - QUOTAS. Size caps enforced per item; per-user counts derived
 *     from R2 listings (cheap at v1 scale; move to D1 accounting
 *     when the users table lands).
 *
 * The id grammars MIRROR web/src/data_model/moduleIds.ts — that file
 * is the source of truth; keep them in lockstep.
 *
 * Bindings (wrangler.toml):
 *   BUCKET           R2 bucket for modules/ + sprites/ keys
 *   DEV_ALLOW_ANON   "true" to skip auth locally (NEVER in prod)
 *   DEV_HANDLE       handle assigned to anonymous dev requests
 *
 * Auth: v1 expects Cloudflare Access in front of the route. The
 * worker reads the identity from the Cf-Access-Jwt-Assertion header;
 * validating the JWT signature against the team's public keys is
 * marked TODO below and MUST be completed before production.
 */

// ── Grammars (mirror moduleIds.ts + publish-server.mjs) ────────────
const BARE_MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILENAME_RE = /^[a-z][a-z0-9_]*\.json$/;
const SPRITE_CATEGORY_RE = /^[a-z][a-z0-9_]*$/;
const SPRITE_FILENAME_RE = /^[a-z0-9_][a-z0-9_-]*\.png$/i;

// ── Quotas (contract doc "Quotas") ─────────────────────────────────
const MAX_JSON_BYTES = 1024 * 1024; // 1 MiB per JSON file
const MAX_SPRITE_BYTES = 256 * 1024; // 256 KiB per PNG
const MAX_FILES_PER_MODULE = 64;
const MAX_MODULES_PER_USER = 16;
const MAX_SPRITES_PER_USER = 512;

/** Parse a module id in either form. Mirrors moduleIds.parseModuleId. */
export function parseModuleId(id) {
  if (typeof id !== "string" || id.length === 0) return null;
  if (id.startsWith("@")) {
    const slash = id.indexOf("/");
    if (slash < 0) return null;
    const handle = id.slice(1, slash);
    const slug = id.slice(slash + 1);
    if (!HANDLE_RE.test(handle) || !SLUG_RE.test(slug)) return null;
    return { qualified: true, handle, slug };
  }
  if (!BARE_MODULE_ID_RE.test(id)) return null;
  return { qualified: false, handle: null, slug: id };
}

/** Ownership gate: the caller may only write modules under their own
 *  handle. System ids (bare / @core) are never writable here. */
export function assertOwnedModuleId(id, handle) {
  const parsed = parseModuleId(id);
  if (!parsed) throw new Error(`Invalid moduleId: ${JSON.stringify(id)}`);
  if (!parsed.qualified || parsed.handle === "core") {
    throw new Error(
      `System module ids are read-only through this API: ${id}`,
    );
  }
  if (parsed.handle !== handle) {
    throw new Error(
      `Module ${id} is not owned by @${handle}`,
    );
  }
  return parsed;
}

/** v1 cross-author extends policy (mirrors moduleIds.canExtendModule). */
export function canExtendModule(targetId, handle) {
  const parsed = parseModuleId(targetId);
  if (!parsed) return false;
  if (!parsed.qualified || parsed.handle === "core") return true;
  return parsed.handle === handle;
}

/** Decode + verify a "data:image/png;base64,…" payload. Returns a
 *  Uint8Array. Same checks as the local server, plus the size cap
 *  and a magic-bytes sniff so a renamed JPEG can't slip through. */
export function pngBytesFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") throw new Error("dataUrl must be a string");
  const m = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("dataUrl must be a base64-encoded image/png payload");
  const bin = atob(m[1]);
  if (bin.length > MAX_SPRITE_BYTES) {
    throw new Error(`Sprite exceeds ${MAX_SPRITE_BYTES} bytes`);
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) {
    throw new Error("Payload is not a PNG (bad signature)");
  }
  return bytes;
}

function jsonBytes(content) {
  const text = JSON.stringify(content, null, 2) + "\n";
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_JSON_BYTES) {
    throw new Error(`JSON exceeds ${MAX_JSON_BYTES} bytes`);
  }
  return bytes;
}

// ── Auth ───────────────────────────────────────────────────────────

import {
  cookieValue,
  handleForIdentity,
  verifyAccessJwt,
} from "./accessAuth.mjs";

/** Resolve the caller's verified handle, or null.
 *
 *  Production path: the Access JWT arrives either as the
 *  Cf-Access-Jwt-Assertion header (requests that passed through an
 *  Access-protected path) or as the CF_Authorization cookie (set by
 *  the interactive /login flow; sent cross-origin by the editor's
 *  credentialed fetches). The signature is VERIFIED against the
 *  team's JWKS, with aud + expiry checks — see accessAuth.mjs.
 *
 *  Fails closed: if ACCESS_TEAM_DOMAIN / ACCESS_AUD aren't
 *  configured, nobody authenticates (except local dev below).
 *
 *  DEV_ALLOW_ANON short-circuits for local `wrangler dev` ONLY —
 *  never set it on a deployed environment. */
export async function authenticate(request, env) {
  if (env.DEV_ALLOW_ANON === "true") {
    return { handle: env.DEV_HANDLE || "dev" };
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const jwt =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    cookieValue(request.headers.get("Cookie"), "CF_Authorization");
  if (!jwt) return null;
  const payload = await verifyAccessJwt(jwt, {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    aud: env.ACCESS_AUD,
  });
  if (!payload) return null;
  const handle = handleForIdentity(payload.email, env);
  return handle ? { handle, email: payload.email } : null;
}

// ── Catalog index maintenance ──────────────────────────────────────

/** Upsert / remove a module's entry in modules/index.json. The
 *  hosted index is server-derived — clients can't write it. */
async function updateIndex(env, moduleId, entry /* null = remove */) {
  const key = "modules/index.json";
  const existing = await env.BUCKET.get(key);
  const index = existing ? await existing.json() : { modules: [] };
  const modules = Array.isArray(index.modules) ? index.modules : [];
  const without = modules.filter((m) => m && m.id !== moduleId);
  if (entry) without.push({ id: moduleId, ...entry });
  await env.BUCKET.put(
    key,
    JSON.stringify({ modules: without }, null, 2) + "\n",
    { httpMetadata: { contentType: "application/json" } },
  );
}

/** Rebuild modules/index.json from every module.json actually in
 *  the bucket. The index is derived data — this is the reconciler
 *  for anything that bypasses updateIndex (initial seeding, manual
 *  bucket surgery, or the historical seed-script clobber). */
export async function reindexModules(env) {
  const entries = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: "modules/", cursor });
    for (const obj of page.objects) {
      if (!obj.key.endsWith("/module.json")) continue;
      const id = obj.key.slice("modules/".length, -"/module.json".length);
      if (!parseModuleId(id)) continue; // foreign keys never become entries
      const stored = await env.BUCKET.get(obj.key);
      if (!stored) continue;
      let manifest;
      try {
        manifest = await stored.json();
      } catch {
        continue; // unreadable manifest — skip rather than poison the index
      }
      entries.push({
        id,
        title:
          typeof manifest?.title === "string" && manifest.title
            ? manifest.title
            : id,
        ...(typeof manifest?.role === "string" && manifest.role
          ? { role: manifest.role }
          : {}),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await env.BUCKET.put(
    "modules/index.json",
    JSON.stringify({ modules: entries }, null, 2) + "\n",
    { httpMetadata: { contentType: "application/json" } },
  );
  return entries;
}

async function countPrefix(env, prefix, cap) {
  let count = 0;
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor });
    count += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
    if (count > cap) return count; // early out — over budget already
  } while (cursor);
  return count;
}

/** Rebuild sprites/@<handle>/index.json from the owner's R2 prefix. */
async function regenerateOwnerSpriteIndex(env, handle) {
  const prefix = `sprites/@${handle}/`;
  const categories = {};
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor });
    for (const obj of page.objects) {
      const rest = obj.key.slice(prefix.length);
      const [cat, file] = rest.split("/");
      if (!cat || !file || !file.toLowerCase().endsWith(".png")) continue;
      (categories[cat] ??= []).push(file);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (const cat of Object.keys(categories)) categories[cat].sort();
  const key = `${prefix}index.json`;
  await env.BUCKET.put(
    key,
    JSON.stringify({ categories }, null, 2) + "\n",
    { httpMetadata: { contentType: "application/json" } },
  );
  return { path: key };
}

// ── Item handlers ──────────────────────────────────────────────────

export async function handleItem(item, handle, env) {
  if (!item || typeof item !== "object") {
    throw new Error("Item must be an object");
  }

  if (item.kind === "manifest") {
    assertOwnedModuleId(item.moduleId, handle);
    const content = item.content ?? {};
    const ext = content && typeof content === "object" ? content.extends : undefined;
    if (typeof ext === "string" && !canExtendModule(ext, handle)) {
      throw new Error(
        `extends target not allowed by the cross-author policy: ${ext}`,
      );
    }
    const moduleCount = await countPrefix(
      env, `modules/@${handle}/`, MAX_MODULES_PER_USER * MAX_FILES_PER_MODULE,
    );
    if (moduleCount > MAX_MODULES_PER_USER * MAX_FILES_PER_MODULE) {
      throw new Error("Per-user module storage quota exceeded");
    }
    const key = `modules/${item.moduleId}/module.json`;
    await env.BUCKET.put(key, jsonBytes(content), {
      httpMetadata: { contentType: "application/json" },
    });
    await updateIndex(env, item.moduleId, {
      title: typeof content.title === "string" ? content.title : item.moduleId,
      role: typeof content.role === "string" ? content.role : undefined,
    });
    return { path: key };
  }

  if (item.kind === "model") {
    assertOwnedModuleId(item.moduleId, handle);
    if (typeof item.fileName !== "string" || !FILENAME_RE.test(item.fileName)) {
      throw new Error(`Invalid fileName: ${JSON.stringify(item.fileName)}`);
    }
    const fileCount = await countPrefix(
      env, `modules/${item.moduleId}/`, MAX_FILES_PER_MODULE,
    );
    if (fileCount > MAX_FILES_PER_MODULE) {
      throw new Error(`Module exceeds ${MAX_FILES_PER_MODULE} files`);
    }
    const key = `modules/${item.moduleId}/${item.fileName}`;
    await env.BUCKET.put(key, jsonBytes(item.content), {
      httpMetadata: { contentType: "application/json" },
    });
    return { path: key };
  }

  if (item.kind === "index") {
    // The hosted catalog index is server-derived (manifest writes
    // upsert it; deletes remove it). The editor's publish-all flow
    // still sends its local index draft, so we ACCEPT the item as a
    // no-op rather than erroring — the client clears the index draft
    // on ok, which is correct: the server's index already reflects
    // the manifests in the same batch.
    return { path: "(ignored — the hosted catalog index is server-derived)" };
  }

  if (item.kind === "delete-module") {
    assertOwnedModuleId(item.moduleId, handle);
    const prefix = `modules/${item.moduleId}/`;
    let cursor;
    do {
      const page = await env.BUCKET.list({ prefix, cursor });
      await Promise.all(page.objects.map((o) => env.BUCKET.delete(o.key)));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    await updateIndex(env, item.moduleId, null);
    return { path: prefix };
  }

  if (item.kind === "sprite") {
    if (
      typeof item.category !== "string" ||
      !SPRITE_CATEGORY_RE.test(item.category)
    ) {
      throw new Error(`Invalid sprite category: ${JSON.stringify(item.category)}`);
    }
    if (
      typeof item.fileName !== "string" ||
      !SPRITE_FILENAME_RE.test(item.fileName)
    ) {
      throw new Error(`Invalid sprite fileName: ${JSON.stringify(item.fileName)}`);
    }
    const spriteCount = await countPrefix(
      env, `sprites/@${handle}/`, MAX_SPRITES_PER_USER,
    );
    if (spriteCount > MAX_SPRITES_PER_USER) {
      throw new Error(`Per-user sprite quota (${MAX_SPRITES_PER_USER}) exceeded`);
    }
    const bytes = pngBytesFromDataUrl(item.dataUrl);
    const key = `sprites/@${handle}/${item.category}/${item.fileName}`;
    await env.BUCKET.put(key, bytes, {
      httpMetadata: { contentType: "image/png" },
    });
    const idx = await regenerateOwnerSpriteIndex(env, handle);
    return { path: key, indexPath: idx.path };
  }

  if (item.kind === "delete-sprite") {
    if (
      typeof item.category !== "string" ||
      !SPRITE_CATEGORY_RE.test(item.category)
    ) {
      throw new Error(`Invalid sprite category: ${JSON.stringify(item.category)}`);
    }
    if (
      typeof item.fileName !== "string" ||
      !SPRITE_FILENAME_RE.test(item.fileName)
    ) {
      throw new Error(`Invalid sprite fileName: ${JSON.stringify(item.fileName)}`);
    }
    const key = `sprites/@${handle}/${item.category}/${item.fileName}`;
    await env.BUCKET.delete(key);
    const idx = await regenerateOwnerSpriteIndex(env, handle);
    return { path: key, indexPath: idx.path };
  }

  if (item.kind === "sprite-index") {
    const idx = await regenerateOwnerSpriteIndex(env, handle);
    return { path: idx.path };
  }

  if (item.kind === "audio-index") {
    throw new Error("The audio catalog is system content; not writable via the hosted API");
  }

  throw new Error(`Unknown item kind: ${JSON.stringify(item.kind)}`);
}

// ── HTTP plumbing ──────────────────────────────────────────────────

/** CORS headers. Credentialed requests (the editor's /publish and
 *  /status calls carry the CF_Authorization cookie) require a
 *  REFLECTED origin + Allow-Credentials — the `*` wildcard is
 *  rejected by browsers when credentials ride along. Origins are
 *  allow-listed via the ALLOWED_ORIGINS env (comma-separated). An
 *  origin not on the list (or no Origin header — curl, same-origin)
 *  gets the anonymous `*` headers, which is all the public read
 *  path needs. */
function corsHeaders(request, env) {
  const base = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cf-Access-Jwt-Assertion",
    "Access-Control-Max-Age": "3600",
  };
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    return {
      ...base,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    };
  }
  return { ...base, "Access-Control-Allow-Origin": "*" };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const CORS = corsHeaders(request, env);
    const json = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Interactive sign-in. THIS path (and only this path) sits
    // behind the Cloudflare Access application — Access intercepts
    // the navigation, runs its login flow, sets the CF_Authorization
    // cookie for this domain, and only then lets the request reach
    // us. We bounce the user back to the editor (LOGIN_REDIRECT_URL,
    // or a ?return= param matching an allowed origin).
    if (request.method === "GET" && url.pathname === "/login") {
      const ret = url.searchParams.get("return");
      const allowed = (env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const dest =
        (ret && allowed.some((o) => ret.startsWith(o)) && ret) ||
        env.LOGIN_REDIRECT_URL ||
        "/status";
      return new Response(null, {
        status: 302,
        headers: { ...CORS, Location: dest },
      });
    }

    // Interactive sign-out. Bounce to the Cloudflare Access team-domain
    // logout endpoint, which clears the session / CF_Authorization
    // cookie.
    //
    // We deliberately do NOT forward a ?returnTo=: Access only accepts
    // logout redirects to URLs configured in the Access app, and an
    // un-listed one fails with "Invalid redirect URL" *and aborts the
    // logout* (the user stays signed in). With no returnTo, Access
    // shows its own "logged out" page — reliable. To bounce back into
    // the app instead, add the Pages origin to the Access app's allowed
    // logout/redirect URLs and re-introduce returnTo here.
    if (request.method === "GET" && url.pathname === "/logout") {
      const team = env.ACCESS_TEAM_DOMAIN;
      const dest = team
        ? `https://${team}/cdn-cgi/access/logout`
        : "/status";
      return new Response(null, {
        status: 302,
        headers: { ...CORS, Location: dest },
      });
    }

    // Read path (v1: the same worker serves the storage tree so
    // RemoteModuleSource needs no second service).
    if (
      request.method === "GET" &&
      (url.pathname.startsWith("/modules/") ||
        url.pathname.startsWith("/sprites/"))
    ) {
      const key = url.pathname.slice(1);
      const obj = await env.BUCKET.get(key);
      if (!obj) return json(404, { error: `Not found: ${url.pathname}` });
      const headers = new Headers(CORS);
      obj.writeHttpMetadata(headers);
      // The catalog index must never be served stale — a cached copy
      // hides freshly published modules. Everything else can take a
      // short browser cache.
      headers.set(
        "Cache-Control",
        key === "modules/index.json" ? "no-store" : "public, max-age=60",
      );
      return new Response(obj.body, { headers });
    }

    // Rebuild the catalog index from bucket manifests. Idempotent,
    // derived-data-only, but gated on auth so strangers can't use it
    // as a free compute endpoint.
    if (request.method === "GET" && url.pathname === "/reindex") {
      const identity = await authenticate(request, env);
      if (!identity) return json(401, { error: "Not signed in" });
      const entries = await reindexModules(env);
      return json(200, {
        ok: true,
        modules: entries.length,
        ids: entries.map((e) => e.id),
      });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const identity = await authenticate(request, env);
      return json(200, {
        ok: true,
        authenticated: identity !== null,
        handle: identity?.handle ?? null,
      });
    }

    if (request.method === "POST" && url.pathname === "/publish") {
      const identity = await authenticate(request, env);
      if (!identity) return json(401, { error: "Not signed in" });
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json(400, { error: `Invalid JSON: ${e.message}` });
      }
      if (!body || !Array.isArray(body.items)) {
        return json(400, { error: "Body must be { items: [...] }" });
      }
      const results = [];
      for (const item of body.items) {
        try {
          const out = await handleItem(item, identity.handle, env);
          results.push({ ok: true, item, ...out });
        } catch (e) {
          results.push({ ok: false, item, error: e.message });
        }
      }
      return json(200, { results });
    }

    return json(404, { error: `Not found: ${request.method} ${url.pathname}` });
  },
};
