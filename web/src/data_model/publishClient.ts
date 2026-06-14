/**
 * Client for the local publish-server.
 *
 * The server is a standalone Node process (web/scripts/publish-server.mjs)
 * the user runs alongside `next dev` during authoring. It accepts a
 * typed batch of write/delete operations and applies them to disk
 * under web/public/modules/.
 *
 * If the server isn't running (the common case for the GH Pages deploy
 * or anyone using the site casually), probePublishServer() returns
 * false and the editor hides the Publish buttons.
 */

const PUBLISH_HOST =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_PUBLISH_HOST) ||
  "http://127.0.0.1:4001";

/** Operations the server accepts. The client constructs these from
 *  draft state; the server validates and applies. */
export type PublishItem =
  | { kind: "manifest"; moduleId: string; content: unknown }
  | {
      kind: "model";
      moduleId: string;
      modelKey: string;
      /** Filename within the module folder, e.g. "races.json". The
       *  server only writes files whose name matches /^[a-z][a-z0-9_]*\.json$/. */
      fileName: string;
      content: unknown;
    }
  | { kind: "index"; content: unknown }
  | { kind: "delete-module"; moduleId: string }
  // ── Sprite assets ───────────────────────────────────────────────
  // Sprites live in their own tree (public/sprites/<category>/…) and
  // the server keeps `index.json` in sync after every write/delete so
  // the editor's catalog refresh costs one publish round-trip.
  | {
      kind: "sprite";
      /** Folder name under public/sprites/. Server enforces
       *  /^[a-z][a-z0-9_]*$/. New categories materialise on first use. */
      category: string;
      /** PNG filename. Server enforces /^[a-z0-9_][a-z0-9_-]*\.png$/i. */
      fileName: string;
      /** Base64 data URL — must start with `data:image/png;base64,`. */
      dataUrl: string;
    }
  | { kind: "sprite-index" }
  | { kind: "delete-sprite"; category: string; fileName: string }
  // ── Audio catalog ───────────────────────────────────────────────
  // The soundtrack catalog (public/audio/index.json) is a flat
  // `tracks: [{ path, name?, gain? }]` list. The editor sends the
  // whole list back when an author adjusts per-track volume; the
  // server validates each entry (path under /audio/, gain clamped to
  // [0,1]) and rewrites the file. `gain` is a playback multiplier —
  // 1 (or absent) means full volume, lower values attenuate a track
  // that's too loud relative to the rest of the soundtrack.
  | {
      kind: "audio-index";
      tracks: Array<{ path: string; name?: string; gain?: number }>;
    };

export interface PublishItemResult {
  ok: boolean;
  item: PublishItem;
  /** Absolute path the server wrote/deleted, when ok. */
  path?: string;
  /** Error message when ok === false. */
  error?: string;
}

export interface PublishResponse {
  results: PublishItemResult[];
}

/** Probe result. `authenticated` is meaningful for the HOSTED
 *  publish API (Cloudflare Access cookie present + valid); the local
 *  dev server doesn't do auth and always reports authenticated
 *  (its /status carries no `authenticated` field — absence is
 *  treated as true so the local workflow is unchanged). */
export interface PublishStatus {
  available: boolean;
  authenticated: boolean;
  /** Publish handle the hosted API resolved for this identity. */
  handle: string | null;
}

/** URL of the hosted sign-in flow — the worker's Access-protected
 *  /login path. The editor offers this link when the API is up but
 *  the user isn't signed in. `returnTo` bounces the browser back
 *  after Access sets its cookie. */
export function publishSignInUrl(returnTo?: string): string {
  const ret = returnTo ?? (typeof window !== "undefined" ? window.location.href : "");
  return `${PUBLISH_HOST}/login${ret ? `?return=${encodeURIComponent(ret)}` : ""}`;
}

/** URL of the hosted sign-out flow — the worker's `/logout`, which runs
 *  the per-application Access logout (clearing the `CF_Authorization`
 *  cookie this app set) and then redirects the now-signed-out user back
 *  to the app's public landing page (via the worker's same-origin
 *  `/signed-out` hop, so no cross-domain redirect allow-listing is
 *  needed). */
export function publishSignOutUrl(): string {
  return `${PUBLISH_HOST}/logout`;
}

/** Probe the publish API. Credentials ride along so the hosted
 *  worker can see the Access cookie; the local server ignores them.
 *  Returns all-false on any error (network, CORS, timeout). Safe to
 *  call from any environment — inert outside the browser. */
export async function probePublishServer(): Promise<PublishStatus> {
  if (typeof window === "undefined") {
    return { available: false, authenticated: false, handle: null };
  }
  try {
    const res = await fetch(`${PUBLISH_HOST}/status`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) {
      return { available: false, authenticated: false, handle: null };
    }
    const body = (await res.json()) as {
      ok?: boolean;
      authenticated?: boolean;
      handle?: string | null;
    };
    return {
      available: body.ok === true,
      // Local dev server predates auth and omits the field — treat
      // absence as authenticated so the local workflow is unchanged.
      authenticated: body.ok === true && body.authenticated !== false,
      handle: body.handle ?? null,
    };
  } catch {
    return { available: false, authenticated: false, handle: null };
  }
}

/** Send a batch of publish items. Resolves to per-item results so the
 *  caller can decide what to do (clear drafts for successful writes,
 *  surface errors for failed ones). Throws only on network failure or
 *  a non-200 status. Credentials ride along for the hosted API's
 *  Access cookie; the local server ignores them. */
export async function publishItems(
  items: PublishItem[],
): Promise<PublishResponse> {
  const res = await fetch(`${PUBLISH_HOST}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      // ignore
    }
    throw new Error(`Publish HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as PublishResponse;
}

/** Delete a published module (all its files + its catalog entry). The
 *  server enforces ownership — only the `@handle` that owns the id may
 *  delete it. Throws on a network error, a non-200, or a per-item
 *  failure (e.g. not owned). */
export async function deleteModule(moduleId: string): Promise<void> {
  const res = await publishItems([{ kind: "delete-module", moduleId }]);
  const r = res.results[0];
  if (!r || !r.ok) {
    throw new Error(r?.error ?? "Delete failed");
  }
}
