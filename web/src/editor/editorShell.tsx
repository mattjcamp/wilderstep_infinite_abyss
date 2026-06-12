"use client";

/**
 * Shared editor-shell conventions — P4 of the usability audit
 * (docs/dev_guides/editor_usability_audit.md).
 *
 * Every browse surface used to phrase its own delete confirms,
 * discard-draft confirms, and draft indicators; the drift made the
 * editor feel like several tools. This module is the single source
 * for that copy:
 *
 *   - deleteRecordConfirmMessage — names the thing being deleted and
 *     states the draft-vs-published consequence, every time.
 *   - discardDraftConfirmMessage — same shape for every model file.
 *   - DraftBanner — the standard "unpublished draft" bar. One set of
 *     words, one placement (directly under the browse header), so
 *     "why isn't my edit in the game?" answers itself everywhere.
 *
 * Conventions (also applied at the call sites):
 *   - Record-creation buttons read "+ New <Thing>" (singular label
 *     from singularModelLabel); additions INSIDE a record (steps,
 *     levels, dialog lines, list entries) read "+ Add <thing>".
 *   - The user-facing noun for a catalog row is the model's singular
 *     label, not "record".
 */

export function deleteRecordConfirmMessage(args: {
  /** Lower-case kind ("character", "map", "effect"). */
  kind: string;
  /** Display name / id of the thing being deleted. */
  name: string;
  /** Module file it lives in ("characters.json"). */
  fileName: string;
  /** Optional extra consequence sentence (e.g. "Removes the whole
   *  record including its levels."). Rendered before the standard
   *  consequence line. */
  detail?: string;
}): string {
  const { kind, name, fileName, detail } = args;
  return (
    `Delete ${kind} "${name}"?\n\n` +
    (detail ? `${detail} ` : "") +
    `Removes it from this module's ${fileName}. The change saves to ` +
    `your draft — the game keeps the published version until you Publish.`
  );
}

export function discardDraftConfirmMessage(fileName: string): string {
  return (
    `Discard all pending changes to this module's ${fileName}?\n\n` +
    `This reverts to the published file and cannot be undone.`
  );
}

/** The standard unpublished-draft bar. Render directly under the
 *  browse header whenever the model has a draft. Visibility matters
 *  more since play went published-only: this banner is the answer to
 *  "I edited it, why hasn't the game changed?". */
export function DraftBanner() {
  return (
    <p className="mt-2 rounded border border-ember/40 bg-ember/15 px-3 py-1.5 text-[13px] text-parchment/90">
      <strong>Unpublished draft</strong> — these edits are saved in
      this browser only. The game plays published files; press{" "}
      <strong>Publish</strong> to make them playable.
    </p>
  );
}
