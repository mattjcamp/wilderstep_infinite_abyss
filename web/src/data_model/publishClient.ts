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
  | { kind: "delete-sprite"; category: string; fileName: string };

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

/** Probe the server. Returns false on any error (network, CORS,
 *  timeout). Safe to call from any environment — returns false
 *  outside the browser. */
export async function probePublishServer(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await fetch(`${PUBLISH_HOST}/status`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** Send a batch of publish items. Resolves to per-item results so the
 *  caller can decide what to do (clear drafts for successful writes,
 *  surface errors for failed ones). Throws only on network failure or
 *  a non-200 status. */
export async function publishItems(
  items: PublishItem[],
): Promise<PublishResponse> {
  const res = await fetch(`${PUBLISH_HOST}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
