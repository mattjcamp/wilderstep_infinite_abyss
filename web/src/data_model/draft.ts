/**
 * Draft storage — per the architecture plan, edits made in the editor
 * land in localStorage as drafts until the author exports them as JSON
 * files and commits them to the repo. There is no server.
 *
 * Storage key shapes:
 *   drafts/<moduleId>/<modelKey>     -> per-model overlay JSON
 *   drafts/<moduleId>/module.json    -> per-module manifest (special-cased
 *                                       modelKey value "module.json")
 *   drafts/_index                    -> global modules index draft
 *
 * When a draft exists, it *replaces* the source file at display time.
 * "Discard Draft" deletes the entry and the next load falls back to
 * the source.
 *
 * **Compression.** Stored payloads run through {@link compressJson} /
 * {@link decompressJson} — gzip wrapped in a `gz1:`-prefixed base64
 * string. Repetitive JSON (especially `maps.json` with thousands of
 * uniform cells) compresses to ~1% of its raw size, which buys
 * roughly two orders of magnitude of localStorage headroom and
 * keeps multi-MB module drafts fitting comfortably inside the
 * browser's per-origin quota. The read path auto-detects legacy
 * uncompressed payloads (drafts written before this codec landed)
 * and passes them through, so there's no flag day.
 *
 * **Async surface.** Because gzip is exposed via the WHATWG
 * Compression Streams API (Promise-based), `loadDraft` / `saveDraft`
 * / `loadIndexDraft` / `saveIndexDraft` return promises. The
 * existence-and-key-only helpers (`hasDraft`, `discardDraft`,
 * `listDraftKeys`, etc.) stay synchronous — they don't touch the
 * value payload.
 *
 * This module is intentionally tiny — it doesn't know about model
 * shapes, only about persistence. All shape-aware logic lives in the
 * editor components and the source/loader.
 */

import { compressJson, decompressJson } from "./compress";

const DRAFT_PREFIX = "drafts";

/** Special "model key" used for the per-module manifest (module.json). */
export const MANIFEST_KEY = "module.json";

/** Single global key for the modules index. Not scoped to any module. */
const INDEX_KEY = `${DRAFT_PREFIX}/_index`;

function key(moduleId: string, modelKey: string): string {
  return `${DRAFT_PREFIX}/${moduleId}/${modelKey}`;
}

/** Read the draft for a model, or null if none / unavailable. Returns
 *  null on any storage / decode failure so callers can treat
 *  "no draft" and "draft is corrupt" identically (the caller's
 *  fallback to the on-disk source matches both shapes). */
export async function loadDraft<T = unknown>(
  moduleId: string,
  modelKey: string,
): Promise<T | null> {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(moduleId, modelKey));
    if (raw === null) return null;
    return await decompressJson<T>(raw);
  } catch {
    return null;
  }
}

/** Write the draft for a model. Overwrites any existing draft. The
 *  serialised payload is gzip-compressed before it lands in
 *  localStorage (see module docstring). A QuotaExceededError from
 *  localStorage propagates to the caller — the existing editor
 *  surfaces a banner on quota failure and the compression dramatically
 *  reduces how often we get there. */
export async function saveDraft(
  moduleId: string,
  modelKey: string,
  data: unknown,
): Promise<void> {
  if (typeof window === "undefined") return;
  const encoded = await compressJson(data);
  window.localStorage.setItem(key(moduleId, modelKey), encoded);
}

/** Remove the draft for a model — next read falls back to the source. */
export function discardDraft(moduleId: string, modelKey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(moduleId, modelKey));
}

/** True if a draft is currently stored. Cheap — checks key presence
 *  without decompressing the payload. */
export function hasDraft(moduleId: string, modelKey: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key(moduleId, modelKey)) !== null;
}

// ── Module index draft (single global file) ─────────────────────────

/** Read the modules-index draft, or null if none. */
export async function loadIndexDraft<T = unknown>(): Promise<T | null> {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(INDEX_KEY);
    if (raw === null) return null;
    return await decompressJson<T>(raw);
  } catch {
    return null;
  }
}

/** Write the modules-index draft. Overwrites any existing draft. */
export async function saveIndexDraft(data: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  const encoded = await compressJson(data);
  window.localStorage.setItem(INDEX_KEY, encoded);
}

/** Remove the modules-index draft. */
export function discardIndexDraft(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(INDEX_KEY);
}

/** True if a modules-index draft is currently stored. */
export function hasIndexDraft(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(INDEX_KEY) !== null;
}

/** List every (moduleId, modelKey) pair with a current draft. Used by
 *  the editor to surface "you have N pending exports" UI in the
 *  future; lightweight enough to call on render. */
export function listDraftKeys(): Array<{
  moduleId: string;
  modelKey: string;
}> {
  if (typeof window === "undefined") return [];
  const out: Array<{ moduleId: string; modelKey: string }> = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !k.startsWith(`${DRAFT_PREFIX}/`)) continue;
    if (k === INDEX_KEY) continue;
    const rest = k.slice(DRAFT_PREFIX.length + 1);
    const slash = rest.indexOf("/");
    if (slash < 0) continue;
    out.push({
      moduleId: rest.slice(0, slash),
      modelKey: rest.slice(slash + 1),
    });
  }
  return out;
}

/** Remove every draft for a given module — manifest + every per-model
 *  overlay. Used when deleting a module so its in-browser state is
 *  cleaned up. Does NOT touch the global modules-index draft.
 *  Returns the number of entries removed. */
export function discardAllDraftsFor(moduleId: string): number {
  if (typeof window === "undefined") return 0;
  const prefix = `${DRAFT_PREFIX}/${moduleId}/`;
  const toRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(prefix)) toRemove.push(k);
  }
  for (const k of toRemove) window.localStorage.removeItem(k);
  return toRemove.length;
}

/** Trigger a browser download of the given JSON data as `<fileName>`. */
export function downloadJson(fileName: string, data: unknown): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
