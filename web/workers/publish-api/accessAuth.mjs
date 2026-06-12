/**
 * accessAuth — Cloudflare Access JWT verification for the publish
 * API, dependency-free (WebCrypto only, so it runs in Workers and in
 * vitest's node runtime for tests).
 *
 * Flow (see ugc_api_contract.md "Auth"):
 *   - The Access application protects ONLY the worker's /login path.
 *     Visiting it interactively authenticates the user and sets the
 *     CF_Authorization cookie for the worker's domain.
 *   - /publish and /status are NOT behind Access; the worker verifies
 *     the cookie's JWT here. That sidesteps Access-vs-CORS preflight
 *     pain while keeping the read path anonymous.
 *
 * Verification checks, all of which must pass:
 *   - compact JWS shape, RS256 only
 *   - signature against the team's JWKS
 *     (https://<team>.cloudflareaccess.com/cdn-cgi/access/certs),
 *     matched by `kid`, cached in-isolate for JWKS_TTL_MS
 *   - `exp` in the future (with small skew), `nbf`/`iat` sane
 *   - `aud` contains the Access application's AUD tag
 *
 * Identity → handle: explicit env map first (HANDLE_MAP, a JSON
 * object of email → handle), then a sanitised email local-part
 * fallback. The map is the pre-D1 stand-in for the users table.
 */

const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;

/** Handle grammar — mirror of moduleIds.ts HANDLE_RE. */
export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/;

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(seg) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

// In-isolate JWKS cache: teamDomain → { at, keysByKid }.
const _jwksCache = new Map();

/** Test-only: drop the cache between runs. */
export function __resetJwksCacheForTests() {
  _jwksCache.clear();
}

async function jwksFor(teamDomain, fetchImpl, now) {
  const cached = _jwksCache.get(teamDomain);
  if (cached && now - cached.at < JWKS_TTL_MS) return cached.keysByKid;
  const res = await fetchImpl(
    `https://${teamDomain}/cdn-cgi/access/certs`,
  );
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const body = await res.json();
  const keysByKid = new Map();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty === "RSA" && jwk.kid) keysByKid.set(jwk.kid, jwk);
  }
  _jwksCache.set(teamDomain, { at: now, keysByKid });
  return keysByKid;
}

/**
 * Verify an Access JWT. Returns the payload on success, null on ANY
 * failure (fail closed; callers treat null as "not signed in").
 *
 * opts: { teamDomain, aud, fetchImpl?, now? } — fetchImpl/now are
 * injectable for tests.
 */
export async function verifyAccessJwt(jwt, opts) {
  try {
    const { teamDomain, aud } = opts;
    if (!teamDomain || !aud || typeof jwt !== "string") return null;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const nowMs = opts.now ?? Date.now();
    const nowS = Math.floor(nowMs / 1000);

    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const header = decodeJsonSegment(parts[0]);
    if (header.alg !== "RS256" || !header.kid) return null;

    const keysByKid = await jwksFor(teamDomain, fetchImpl, nowMs);
    const jwk = keysByKid.get(header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      data,
    );
    if (!ok) return null;

    const payload = decodeJsonSegment(parts[1]);
    if (typeof payload.exp !== "number" || payload.exp <= nowS - CLOCK_SKEW_S) {
      return null;
    }
    if (typeof payload.nbf === "number" && payload.nbf > nowS + CLOCK_SKEW_S) {
      return null;
    }
    const audList = Array.isArray(payload.aud)
      ? payload.aud
      : [payload.aud];
    if (!audList.includes(aud)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Map a verified identity to a publish handle. Explicit HANDLE_MAP
 *  entry wins; otherwise derive from the email local-part (sanitised
 *  to the handle grammar). Returns null when no valid handle can be
 *  produced — the caller rejects the request. */
export function handleForIdentity(email, env) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  const normalized = email.toLowerCase();
  if (env.HANDLE_MAP) {
    try {
      const map = JSON.parse(env.HANDLE_MAP);
      const mapped = map[normalized];
      if (typeof mapped === "string" && HANDLE_RE.test(mapped)) {
        return mapped;
      }
    } catch {
      // Malformed map — fall through to derivation rather than
      // locking everyone out, but the derived handle still has to
      // pass the grammar.
    }
  }
  const local = normalized
    .split("@")[0]
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^[-_]+/, "")
    .slice(0, 30);
  return HANDLE_RE.test(local) ? local : null;
}

/** Pull a cookie value out of a Cookie header. */
export function cookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
