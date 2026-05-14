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
 * This module is intentionally tiny — it doesn't know about model
 * shapes, only about persistence. All shape-aware logic lives in the
 * editor components and the source/loader.
 */

const DRAFT_PREFIX = "drafts";

/** Special "model key" used for the per-module manifest (module.json). */
export const MANIFEST_KEY = "module.json";

/** Single global key for the modules index. Not scoped to any module. */
const INDEX_KEY = `${DRAFT_PREFIX}/_index`;

function key(moduleId: string, modelKey: string): string {
  return `${DRAFT_PREFIX}/${moduleId}/${modelKey}`;
}

/** Read the draft for a model, or null if none / unavailable. */
export function loadDraft<T = unknown>(
  moduleId: string,
  modelKey: string,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(moduleId, modelKey));
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write the draft for a model. Overwrites any existing draft. */
export function saveDraft(
  moduleId: string,
  modelKey: string,
  data: unknown,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(moduleId, modelKey), JSON.stringify(data));
}

/** Remove the draft for a model — next read falls back to the source. */
export function discardDraft(moduleId: string, modelKey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(moduleId, modelKey));
}

/** True if a draft is currently stored. */
export function hasDraft(moduleId: string, modelKey: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key(moduleId, modelKey)) !== null;
}

// ── Module index draft (single global file) ─────────────────────────

/** Read the modules-index draft, or null if none. */
export function loadIndexDraft<T = unknown>(): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(INDEX_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write the modules-index draft. Overwrites any existing draft. */
export function saveIndexDraft(data: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INDEX_KEY, JSON.stringify(data));
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
