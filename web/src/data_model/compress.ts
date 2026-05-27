/**
 * Gzip-backed JSON ↔ string codec for localStorage payloads.
 *
 * Why: a single dungeon module's `maps.json` draft can hit ~6.5 MB
 * serialized, and most browsers cap localStorage at ~5–10 MB per
 * origin. Gzip on this kind of repetitive JSON compresses to <1% of
 * the original (the Dragon's Lair maps draft drops from 6.5 MB → 53
 * KB), which buys us ~100× headroom inside the same storage backend
 * — no IndexedDB migration required for the next few authoring
 * milestones.
 *
 * Format:
 *
 *   - Compressed payloads start with the literal prefix `"gz1:"`
 *     followed by base64-encoded gzip bytes. The version digit lets
 *     us bump the format if we ever swap codecs (Brotli, etc.)
 *     without losing the old-data fast path.
 *   - Legacy uncompressed payloads (drafts written before this
 *     codec landed) are bare JSON strings — they start with `{` /
 *     `[` / `"` / a digit / `t`/`f`/`n`. `decompressJson` detects
 *     them by the absence of the prefix and parses them directly.
 *
 * The mixed-format read path means there's no flag day: existing
 * drafts hydrate on first load, get re-saved in the compressed form
 * on the next mutation, and the legacy branch quietly retires
 * itself over time.
 *
 * SSR / older runtimes: `CompressionStream` lives on the browser
 * globals and isn't shimmed in Node's older test runners. When the
 * API is missing, both helpers degrade to plain JSON — the saved
 * value is uncompressed (still parseable by `decompressJson`), and
 * the localStorage quota argument doesn't apply server-side anyway.
 */

/** Prefix identifying a compressed payload. Bump the digit when
 *  changing the codec or framing — the reader inspects the literal
 *  string so the constants here are the one-and-only contract. */
const GZIP_PREFIX = "gz1:";

/** True when the runtime exposes the WHATWG Compression Streams
 *  API. False on SSR, older Safari, and most Node test runners. */
function compressionStreamAvailable(): boolean {
  return (
    typeof CompressionStream !== "undefined" &&
    typeof DecompressionStream !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof Response !== "undefined"
  );
}

/**
 * Encode a binary blob as a base64 string suitable for localStorage.
 * Uses the chunked btoa path so large gzipped payloads don't blow
 * the per-call argument limit on `String.fromCharCode(...)`. The
 * 32-KiB chunk size is well under every browser's apply-arity
 * threshold while keeping the call count manageable for multi-MB
 * inputs.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

/** Reverse of {@link bytesToBase64}. Decodes the base64 portion of a
 *  `gz1:` payload back into the raw gzip bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Serialise `value` to JSON, gzip it, and return the `gz1:`-prefixed
 * base64 string ready to drop into `localStorage.setItem`. Falls back
 * to bare JSON when CompressionStream isn't available — readers
 * handle both shapes.
 */
export async function compressJson(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  if (!compressionStreamAvailable()) return json;
  const input = new Blob([json]).stream();
  const stream = input.pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return GZIP_PREFIX + bytesToBase64(new Uint8Array(buf));
}

/**
 * Parse a localStorage value back into a JS value. Auto-detects
 * `gz1:` payloads and decompresses them; everything else is treated
 * as a bare JSON string and parsed directly.
 *
 * Throws if the input isn't valid (bad base64, corrupt gzip, malformed
 * JSON). Callers should `try/catch` and treat a throw the same way
 * they treat a missing entry — the helper deliberately doesn't return
 * `null` for malformed input because that's indistinguishable from
 * "valid JSON `null`" otherwise.
 */
export async function decompressJson<T = unknown>(stored: string): Promise<T> {
  if (!stored.startsWith(GZIP_PREFIX)) {
    return JSON.parse(stored) as T;
  }
  const b64 = stored.slice(GZIP_PREFIX.length);
  if (!compressionStreamAvailable()) {
    throw new Error(
      "Cannot decompress a gz1: payload — CompressionStream API is unavailable in this runtime.",
    );
  }
  const bytes = base64ToBytes(b64);
  const input = new Blob([bytes]).stream();
  const stream = input.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text) as T;
}

/** True when the input looks like a `gz1:` payload (just a string
 *  shape check, no actual decoding). Exposed so callers can short-
 *  circuit a "drafts size in storage" estimate without paying the
 *  decompression cost — handy for the future Pending Exports UI. */
export function isCompressedPayload(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(GZIP_PREFIX);
}
