/**
 * Draft storage — per the architecture plan, edits made in the editor
 * land in localStorage as drafts until the author exports them as JSON
 * files and commits them to the repo. There is no server.
 *
 * Storage key shape:
 *   drafts/<moduleId>/<modelKey>     -> JSON-stringified collection or singleton
 *
 * When a draft exists for a model, it *replaces* the source file at
 * display time. "Discard Draft" deletes the entry and the next load
 * falls back to the source.
 *
 * This module is intentionally tiny — it doesn't know about model
 * shapes, only about persistence. All shape-aware logic lives in the
 * editor components.
 */

const DRAFT_PREFIX = "drafts";

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
