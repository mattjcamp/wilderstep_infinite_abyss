"use client";

/**
 * Inline form for scaffolding a new module or library.
 *
 * Submit creates two drafts in localStorage:
 *   - drafts/<new-id>/module.json — the new manifest
 *   - drafts/_index               — the modules index with the new
 *                                   entry appended
 *
 * The new module appears in the picker immediately (because list()
 * prefers the index draft). Authoring records works normally — the
 * editor treats fetch 404s as "this model has no own file yet" and
 * accumulates drafts. When the author's done, they Export every
 * draft and drop the files into web/public/modules/<new-id>/ and
 * web/public/modules/index.json, then rebuild.
 */

import { useMemo, useState } from "react";
import {
  loadIndexDraft,
  MANIFEST_KEY,
  saveDraft,
  saveIndexDraft,
} from "@/data_model/draft";
import { SLUG_RE } from "@/data_model/moduleIds";
import { usePublishServer } from "./usePublishServer";
import type { ModuleSummary } from "@/data_model/ModuleSource";

interface IndexEntry {
  id: string;
  title?: string;
  role?: string;
}

interface IndexFile {
  _comment?: string;
  modules?: IndexEntry[];
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** When the hosted publish API knows who we are, new modules are
 *  created under the author's namespace: the form takes a SLUG and
 *  the real id becomes `@<handle>/<slug>` (the only id shape the
 *  hosted API will accept for writes). Without a handle (local
 *  publish-server, or not signed in) the historical bare-id flow is
 *  unchanged. */

type Role = "playable" | "library";

export function NewModuleForm({
  existingModules,
  onCreated,
  onCancel,
}: {
  existingModules: ModuleSummary[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { handle } = usePublishServer();
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [role, setRole] = useState<Role>("playable");
  const [extendsId, setExtendsId] = useState<string>("default");

  const existingIds = useMemo(
    () => new Set(existingModules.map((m) => m.id)),
    [existingModules],
  );
  const extendsCandidates = useMemo(
    () => existingModules.filter((m) => m.id !== id),
    [existingModules, id],
  );

  const trimmedInput = id.trim();
  // Namespaced mode: input is the slug; the actual id is qualified.
  const trimmedId = handle ? `@${handle}/${trimmedInput}` : trimmedInput;
  const idValid = handle
    ? SLUG_RE.test(trimmedInput)
    : ID_PATTERN.test(trimmedInput);
  const idCollision = existingIds.has(trimmedId);
  const idError =
    trimmedInput.length === 0
      ? null
      : !idValid
        ? handle
          ? "Name must be lowercase letters/digits/hyphens/underscores, starting with a letter or digit (e.g. 'shadow-vale')."
          : "ID must be lowercase letters/digits/hyphens, starting with a letter (e.g. 'shadow-vale')."
        : idCollision
          ? `A module with id "${trimmedId}" already exists.`
          : null;

  const canSubmit =
    trimmedInput.length > 0 &&
    !idError &&
    title.trim().length > 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const newManifest: Record<string, unknown> = {
      _comment: `Draft module created in the editor. Export this file and drop it into web/public/modules/${trimmedId}/module.json.`,
      id: trimmedId,
      title: title.trim(),
      description: description.trim(),
      author: author.trim(),
      version: "0.1.0",
      role,
    };
    if (extendsId && extendsId !== "(none)") {
      newManifest.extends = extendsId;
    }
    await saveDraft(trimmedId, MANIFEST_KEY, newManifest);

    // Update the index draft: read current index (draft if present,
    // else fall back to a minimal shell — the picker will populate it
    // on next load if not).
    const currentIndex =
      (await loadIndexDraft<IndexFile>()) ??
      buildIndexFromSummaries(existingModules);
    const nextEntries: IndexEntry[] = [
      ...(currentIndex.modules ?? []),
      { id: trimmedId, title: title.trim(), role },
    ];
    await saveIndexDraft({
      _comment:
        currentIndex._comment ??
        "Modules index — managed by the editor in draft form; export and drop into web/public/modules/index.json to commit.",
      modules: nextEntries,
    });

    onCreated();
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-parchment/15 bg-ink/30 p-4"
    >
      <h2 className="font-display text-lg text-parchment">
        New module
      </h2>
      <p className="mt-1 text-sm text-parchment/75">
        Scaffolds a new module. The new module appears in the picker
        immediately; export the manifest + updated index to commit to
        disk.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            {handle ? "Name" : "ID"}
          </span>
          <div className="mt-1 flex items-center gap-1">
            {handle ? (
              <span className="shrink-0 font-mono text-sm text-parchment/55">
                @{handle}/
              </span>
            ) : null}
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="shadow-vale"
              className="w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-sm text-parchment/90"
            />
          </div>
          {idError ? (
            <p className="mt-1 text-[13px] text-ember/80">{idError}</p>
          ) : handle ? (
            <p className="mt-1 text-[13px] text-parchment/65">
              Published as{" "}
              <code>{trimmedInput ? trimmedId : `@${handle}/…`}</code> —
              your modules live under your handle.
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-parchment/65">
              Folder name under <code>web/public/modules/</code>.
            </p>
          )}
        </label>

        <label className="block">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            Title
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="The Shadow Vale"
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            Description
          </span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short campaign in the haunted vale."
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          />
        </label>

        <label className="block">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            Author
          </span>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          />
        </label>

        <label className="block">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            Extends
          </span>
          <select
            value={extendsId}
            onChange={(e) => setExtendsId(e.target.value)}
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          >
            <option value="(none)">(none — root module)</option>
            {extendsCandidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.id})
              </option>
            ))}
          </select>
        </label>

        <fieldset className="sm:col-span-2">
          <legend className="text-[13px] uppercase tracking-wide text-parchment/65">
            Role
          </legend>
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-2 text-sm text-parchment/85">
              <input
                type="radio"
                name="role"
                value="playable"
                checked={role === "playable"}
                onChange={() => setRole("playable")}
              />
              Playable
              <span className="text-[13px] text-parchment/65">
                — a runnable adventure, shown in the play picker
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-parchment/85">
              <input
                type="radio"
                name="role"
                value="library"
                checked={role === "library"}
                onChange={() => setRole("library")}
              />
              Library
              <span className="text-[13px] text-parchment/65">
                — content available for import in other modules
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Build an index shell from already-loaded summaries. Used as a
 *  starting point when there's no existing draft and we want to
 *  add a new entry. */
function buildIndexFromSummaries(summaries: ModuleSummary[]): IndexFile {
  return {
    modules: summaries.map((m) => ({
      id: m.id,
      title: m.title,
      role: m.role,
    })),
  };
}
