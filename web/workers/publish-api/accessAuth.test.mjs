/**
 * accessAuth — real-crypto tests: generate an RSA keypair, sign a
 * JWT the way Access does (RS256, kid in header), serve the public
 * JWK through a mocked fetch, and assert verifyAccessJwt's accept /
 * reject behaviour. Fail-closed paths matter most here — a bug that
 * accepts a bad token is an account-takeover, so every rejection
 * case is pinned.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetJwksCacheForTests,
  cookieValue,
  handleForIdentity,
  verifyAccessJwt,
} from "./accessAuth.mjs";

const TEAM = "testteam.cloudflareaccess.com";
const AUD = "aud-tag-123";
const KID = "test-key-1";

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

let keyPair;
let publicJwk;

async function ensureKeys() {
  if (keyPair) return;
  keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: KID };
}

async function signJwt(payload, { kid = KID, alg = "RS256" } = {}) {
  await ensureKeys();
  const header = b64urlJson({ alg, kid });
  const body = b64urlJson(payload);
  const data = new TextEncoder().encode(`${header}.${body}`);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    data,
  );
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

function jwksFetch(keys) {
  return async (url) => {
    expect(String(url)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return { ok: true, json: async () => ({ keys }) };
  };
}

const NOW = 1_750_000_000_000; // fixed clock for determinism
const validPayload = () => ({
  email: "mjcampbell74@gmail.com",
  aud: [AUD],
  exp: Math.floor(NOW / 1000) + 3600,
  iat: Math.floor(NOW / 1000) - 10,
});

describe("verifyAccessJwt", () => {
  beforeEach(() => __resetJwksCacheForTests());

  it("accepts a properly signed, unexpired, aud-matching token", async () => {
    const jwt = await signJwt(validPayload());
    const payload = await verifyAccessJwt(jwt, {
      teamDomain: TEAM,
      aud: AUD,
      fetchImpl: jwksFetch([publicJwk]),
      now: NOW,
    });
    expect(payload?.email).toBe("mjcampbell74@gmail.com");
  });

  it("rejects a tampered payload (signature mismatch)", async () => {
    const jwt = await signJwt(validPayload());
    const [h, , s] = jwt.split(".");
    const forged = `${h}.${b64urlJson({ ...validPayload(), email: "attacker@evil.com" })}.${s}`;
    expect(
      await verifyAccessJwt(forged, {
        teamDomain: TEAM,
        aud: AUD,
        fetchImpl: jwksFetch([publicJwk]),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("rejects expired tokens and wrong audiences", async () => {
    const expired = await signJwt({
      ...validPayload(),
      exp: Math.floor(NOW / 1000) - 3600,
    });
    const wrongAud = await signJwt({ ...validPayload(), aud: ["other"] });
    const opts = {
      teamDomain: TEAM,
      aud: AUD,
      fetchImpl: jwksFetch([publicJwk]),
      now: NOW,
    };
    expect(await verifyAccessJwt(expired, opts)).toBeNull();
    expect(await verifyAccessJwt(wrongAud, opts)).toBeNull();
  });

  it("rejects unknown kid, non-RS256, and garbage", async () => {
    const wrongKid = await signJwt(validPayload(), { kid: "other-key" });
    const noneAlg = `${b64urlJson({ alg: "none", kid: KID })}.${b64urlJson(validPayload())}.`;
    const opts = {
      teamDomain: TEAM,
      aud: AUD,
      fetchImpl: jwksFetch([publicJwk]),
      now: NOW,
    };
    expect(await verifyAccessJwt(wrongKid, opts)).toBeNull();
    expect(await verifyAccessJwt(noneAlg, opts)).toBeNull();
    expect(await verifyAccessJwt("not-a-jwt", opts)).toBeNull();
    expect(await verifyAccessJwt(undefined, opts)).toBeNull();
  });

  it("fails closed when team domain / aud are missing", async () => {
    const jwt = await signJwt(validPayload());
    expect(
      await verifyAccessJwt(jwt, {
        teamDomain: "",
        aud: AUD,
        fetchImpl: jwksFetch([publicJwk]),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      await verifyAccessJwt(jwt, {
        teamDomain: TEAM,
        aud: "",
        fetchImpl: jwksFetch([publicJwk]),
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("handleForIdentity", () => {
  it("prefers the explicit HANDLE_MAP", () => {
    const env = {
      HANDLE_MAP: JSON.stringify({ "mjcampbell74@gmail.com": "matt" }),
    };
    expect(handleForIdentity("MJCampbell74@gmail.com", env)).toBe("matt");
  });

  it("derives a sanitised local-part otherwise", () => {
    expect(handleForIdentity("sara.smith+rpg@example.com", {})).toBe(
      "sara-smith-rpg",
    );
  });

  it("returns null for junk identities", () => {
    expect(handleForIdentity("not-an-email", {})).toBeNull();
    expect(handleForIdentity(undefined, {})).toBeNull();
    expect(handleForIdentity("@nodomain", {})).toBeNull();
  });
});

describe("cookieValue", () => {
  it("extracts the named cookie", () => {
    expect(
      cookieValue("a=1; CF_Authorization=tok.en.sig; b=2", "CF_Authorization"),
    ).toBe("tok.en.sig");
    expect(cookieValue("a=1", "CF_Authorization")).toBeNull();
    expect(cookieValue(null, "CF_Authorization")).toBeNull();
  });
});
