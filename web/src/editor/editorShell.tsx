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

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { publishSignInUrl } from "@/data_model/publishClient";
import { decodeModuleIdParam } from "./moduleRoutes";
import { usePublishServer } from "./usePublishServer";
import { Sidebar } from "./Sidebar";

/** Read the editor's module id from the `?m=` query, decoded. Redirects
 *  to the picker (`/editor`) when absent. Returns null until an id is
 *  present (caller renders nothing). Must be called inside a Suspense
 *  boundary — it reads useSearchParams (required for static export). */
export function useEditorModuleId(): string | null {
  const router = useRouter();
  const raw = useSearchParams().get("m");
  const moduleId = raw ? decodeModuleIdParam(raw) : "";
  useEffect(() => {
    if (!moduleId) router.replace("/editor");
  }, [moduleId, router]);
  return moduleId || null;
}

/**
 * EditorShell — the editor chrome (Sidebar + scrollable content area).
 *
 * Was `app/editor/[moduleId]/layout.tsx`, but the editor routes moved
 * to flat query-param routes (`/editor/module?m=…` etc.) so hosted
 * `@handle/slug` modules can be edited on the static export (a
 * `[moduleId]` segment only generates pages for build-time-known ids).
 * A Next route layout can't read the `?m=` query, so each query-param
 * page composes this shell explicitly.
 */
export function EditorShell({
  moduleId,
  children,
}: {
  moduleId: string;
  children: React.ReactNode;
}) {
  return (
    // h-screen (not min-h-screen) bounds the editor shell to the
    // viewport so the content area scrolls INSIDE itself rather than
    // growing the page — that's what lets a tall map canvas produce its
    // own scrollbar instead of the whole body scrolling.
    <div className="flex h-screen overflow-hidden">
      <Sidebar moduleId={moduleId} />
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

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
 *  "I edited it, why hasn't the game changed?".
 *
 *  When the hosted publish API is reachable but the user isn't
 *  signed in (Cloudflare Access cookie absent/expired), the banner
 *  also carries the Sign-in link — Publish buttons are hidden in
 *  that state (usePublishServer folds auth into `available`), so
 *  this is where the author learns why and what to do about it. */
export function DraftBanner() {
  const { reachable, authenticated } = usePublishServer();
  const needsSignIn = reachable && !authenticated;
  return (
    <p className="mt-2 rounded border border-ember/40 bg-ember/15 px-3 py-1.5 text-[13px] text-parchment/90">
      <strong>Unpublished draft</strong> — these edits are saved in
      this browser only. The game plays published files; press{" "}
      <strong>Publish</strong> to make them playable.
      {needsSignIn ? (
        <>
          {" "}
          <a
            href={publishSignInUrl()}
            className="font-semibold underline hover:text-parchment"
          >
            Sign in to publish
          </a>
          {" "}— publishing requires an account.
        </>
      ) : null}
    </p>
  );
}
