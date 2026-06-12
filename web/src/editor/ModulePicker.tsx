"use client";

/**
 * Module picker — fetches the list of known modules at runtime via
 * StaticModuleSource and renders a card per module. Clicking a card
 * routes to /editor/[moduleId].
 *
 * Also hosts the "+ New module / library" scaffolding form and the
 * "Export index.json" button when there are pending changes to the
 * modules index (e.g., a newly-created module that hasn't been
 * committed to disk yet).
 */

import { encodeModuleId } from "./moduleRoutes";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  discardAllDraftsFor,
  discardDraft,
  discardIndexDraft,
  downloadJson,
  hasDraft,
  hasIndexDraft,
  listDraftKeys,
  loadDraft,
  loadIndexDraft,
  MANIFEST_KEY,
  saveDraft,
  saveIndexDraft,
} from "@/data_model/draft";
import { ALL_MODEL_KEYS, MODELS, type ModelKey } from "@/data_model/models";
import type { ModuleSummary } from "@/data_model/ModuleSource";
import { publishItems, type PublishItem } from "@/data_model/publishClient";
import { withBasePath } from "@/util/basePath";
import {
  ModulePropertiesDialog,
  type ModulePropertiesPatch,
} from "./ModulePropertiesDialog";
import { NewModuleForm } from "./NewModuleForm";
import { usePublishServer } from "./usePublishServer";

interface IndexEntry {
  id: string;
  title?: string;
  role?: string;
}

interface IndexFile {
  _comment?: string;
  modules?: IndexEntry[];
}

type State =
  | { kind: "loading" }
  | {
      kind: "ok";
      modules: ModuleSummary[];
      indexDraftActive: boolean;
      anyDraftActive: boolean;
      draftCount: number;
    }
  | { kind: "error"; message: string };

export function ModulePicker() {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  /** The module whose Properties dialog is open, or null when no
   *  dialog is mounted. Holds the full summary so the dialog can
   *  seed itself without a second fetch. */
  const [editingModule, setEditingModule] = useState<ModuleSummary | null>(
    null,
  );

  const refresh = useCallback(() => {
    const src = new StaticModuleSource();
    src
      .list()
      .then((modules) => {
        const drafts = listDraftKeys();
        const indexDraftActive = hasIndexDraft();
        setState({
          kind: "ok",
          modules,
          indexDraftActive,
          anyDraftActive: drafts.length > 0 || indexDraftActive,
          draftCount: drafts.length + (indexDraftActive ? 1 : 0),
        });
      })
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onExportIndex = async () => {
    const draft = await loadIndexDraft<unknown>();
    if (!draft) return;
    downloadJson("index.json", draft);
  };

  const onDiscardIndex = () => {
    if (!hasIndexDraft()) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Discard pending changes to the modules index? Newly-created modules will disappear from the picker (their drafted manifests remain).",
      )
    ) {
      return;
    }
    discardIndexDraft();
    refresh();
  };

  /** Gather every pending draft + the index draft + any folder
   *  deletions implied by the draft index → publish payload. */
  const buildPublishPayload = async (): Promise<{
    items: PublishItem[];
    summary: { writes: number; deletes: number; deletedIds: string[] };
  }> => {
    const items: PublishItem[] = [];
    const knownModelKeys = new Set<string>(ALL_MODEL_KEYS);

    for (const { moduleId, modelKey } of listDraftKeys()) {
      const content = await loadDraft<unknown>(moduleId, modelKey);
      if (content === null || content === undefined) continue;
      if (modelKey === MANIFEST_KEY) {
        items.push({ kind: "manifest", moduleId, content });
      } else if (knownModelKeys.has(modelKey)) {
        const def = MODELS[modelKey as ModelKey];
        items.push({
          kind: "model",
          moduleId,
          modelKey,
          fileName: def.fileName,
          content,
        });
      }
    }

    const indexDraft = await loadIndexDraft<{ modules?: { id: string }[] }>();
    if (indexDraft !== null) {
      items.push({ kind: "index", content: indexDraft });
    }

    // Deletions: modules on disk but not in the draft index (when
    // there is a draft index). Skip "default" — server refuses anyway.
    const deletedIds: string[] = [];
    if (indexDraft !== null) {
      try {
        const r = await fetch(withBasePath("/modules/index.json"), {
          cache: "no-store",
        });
        if (r.ok) {
          const onDisk = (await r.json()) as {
            modules?: { id: string }[];
          };
          const draftIds = new Set(
            (indexDraft.modules ?? []).map((e) => e.id),
          );
          for (const entry of onDisk.modules ?? []) {
            if (
              entry.id &&
              entry.id !== "default" &&
              !draftIds.has(entry.id)
            ) {
              deletedIds.push(entry.id);
              items.push({ kind: "delete-module", moduleId: entry.id });
            }
          }
        }
      } catch {
        // No on-disk index — nothing to delete.
      }
    }

    return {
      items,
      summary: {
        writes: items.filter((i) => i.kind !== "delete-module").length,
        deletes: deletedIds.length,
        deletedIds,
      },
    };
  };

  const onPublishAll = async () => {
    if (typeof window === "undefined") return;
    const { items, summary } = await buildPublishPayload();
    if (items.length === 0) {
      window.alert("No drafts to publish.");
      return;
    }
    const lines = [
      `Publish ${summary.writes} file write${summary.writes === 1 ? "" : "s"}` +
        (summary.deletes
          ? ` and ${summary.deletes} folder deletion${summary.deletes === 1 ? "" : "s"}`
          : "") +
        "?",
      "",
      "This will write directly to web/public/modules/.",
    ];
    if (summary.deletes > 0) {
      lines.push("");
      lines.push(`Folders to delete: ${summary.deletedIds.join(", ")}`);
    }
    if (!window.confirm(lines.join("\n"))) return;

    setPublishing(true);
    try {
      const res = await publishItems(items);
      // Clear drafts for items that succeeded.
      for (const r of res.results) {
        if (!r.ok) continue;
        const it = r.item;
        if (it.kind === "manifest") discardDraft(it.moduleId, MANIFEST_KEY);
        else if (it.kind === "model") discardDraft(it.moduleId, it.modelKey);
        else if (it.kind === "index") discardIndexDraft();
        else if (it.kind === "delete-module")
          discardAllDraftsFor(it.moduleId);
      }
      const failures = res.results.filter((r) => !r.ok);
      if (failures.length > 0) {
        const detail = failures
          .map((f) => {
            const it = f.item;
            const idPart =
              "moduleId" in it && it.moduleId
                ? `${it.moduleId} `
                : "";
            return `• ${idPart}(${it.kind}): ${f.error}`;
          })
          .join("\n");
        window.alert(`Some items failed:\n${detail}`);
      }
      refresh();
    } catch (e) {
      window.alert(
        `Publish error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPublishing(false);
    }
  };

  const onDiscardAll = () => {
    if (typeof window === "undefined") return;
    const drafts = listDraftKeys();
    const indexActive = hasIndexDraft();
    const total = drafts.length + (indexActive ? 1 : 0);
    if (total === 0) {
      window.alert("No drafts to discard.");
      return;
    }
    const ok = window.confirm(
      `Discard ${total} pending draft${total === 1 ? "" : "s"}? ` +
        `This wipes every uncommitted change in your browser and cannot be undone.`,
    );
    if (!ok) return;
    for (const { moduleId, modelKey } of drafts) {
      discardDraft(moduleId, modelKey);
    }
    if (indexActive) discardIndexDraft();
    refresh();
  };

  const onDeleteModule = async (m: ModuleSummary) => {
    if (typeof window === "undefined") return;
    const ok = window.confirm(
      `Delete module "${m.id}"?\n\n` +
        `• Removes it from the modules index in your browser.\n` +
        `• Discards every in-browser draft for this module (manifest + every model).\n` +
        `• Does NOT delete the on-disk folder web/public/modules/${m.id}/ — remove that manually if you want the files gone too.\n` +
        `• Export the updated index.json to commit the removal to disk.`,
    );
    if (!ok) return;

    // Build the next index from whatever's current (draft if present,
    // else the on-disk index reconstructed from the current summary list).
    const currentIndex =
      (await loadIndexDraft<IndexFile>()) ?? {
        modules: state.kind === "ok"
          ? state.modules.map((s) => ({
              id: s.id,
              title: s.title,
              role: s.role,
            }))
          : [],
      };
    const nextEntries = (currentIndex.modules ?? []).filter(
      (e) => e.id !== m.id,
    );
    await saveIndexDraft({
      _comment:
        currentIndex._comment ??
        "Modules index — managed by the editor in draft form; export and drop into web/public/modules/index.json to commit.",
      modules: nextEntries,
    });
    discardAllDraftsFor(m.id);
    refresh();
  };

  /** Save the Module Properties dialog's edits into a manifest draft.
   *  Starts from the existing on-disk manifest (or its current draft if
   *  one is already pending) so untouched fields — `extends`, `uses`,
   *  any future additions — survive the round-trip. */
  const onSaveModuleAttrs = async (
    m: ModuleSummary,
    patch: ModulePropertiesPatch,
  ) => {
    // Existing draft takes priority over the on-disk manifest; the
    // draft IS the source of truth once one exists. Falls back to the
    // deployed file so untouched fields aren't lost on first edit.
    let current: Record<string, unknown> | null = await loadDraft<
      Record<string, unknown>
    >(m.id, MANIFEST_KEY);
    if (!current) {
      try {
        const r = await fetch(
          withBasePath(`/modules/${m.id}/module.json`),
          { cache: "no-store" },
        );
        if (r.ok) current = (await r.json()) as Record<string, unknown>;
      } catch {
        // If the on-disk fetch fails we still have the summary in hand;
        // build a manifest from that so the save isn't blocked.
        current = null;
      }
    }
    const next: Record<string, unknown> = current ? { ...current } : {};
    // id is non-editable from the dialog — keep whatever was there,
    // but fall back to the summary's id to be safe.
    next.id = next.id ?? m.id;
    next.title = patch.title;
    if (patch.description) next.description = patch.description;
    else delete next.description;
    if (patch.author) next.author = patch.author;
    else delete next.author;
    if (patch.version) next.version = patch.version;
    else delete next.version;
    if (patch.role) next.role = patch.role;
    else delete next.role;
    // Soundtrack list — persist when non-empty, drop the key when
    // the textarea was cleared. Keeps quiet modules shape-clean
    // rather than committing a noisy `"soundtrack": []`.
    if (patch.soundtrack && patch.soundtrack.length > 0) {
      next.soundtrack = patch.soundtrack;
    } else {
      delete next.soundtrack;
    }
    // Fog-of-war sight radius — nested under `settings.sight_radius`,
    // one key per lighting mode. Only the modes the author actually
    // set a number for are written; blank modes are dropped so they
    // fall back to the engine default. When no mode is set the whole
    // sight_radius block (and an emptied settings object) is removed,
    // keeping default modules shape-clean. Other settings.* keys
    // (e.g. start_time) are preserved.
    {
      const sr = patch.sightRadius;
      const settings: Record<string, unknown> =
        next.settings && typeof next.settings === "object"
          ? { ...(next.settings as Record<string, unknown>) }
          : {};
      const sightOut: Record<string, number> = {};
      if (typeof sr.day === "number") sightOut.day = sr.day;
      if (typeof sr.twilight === "number") sightOut.twilight = sr.twilight;
      if (typeof sr.night === "number") sightOut.night = sr.night;
      if (Object.keys(sightOut).length > 0) {
        settings.sight_radius = sightOut;
      } else {
        delete settings.sight_radius;
      }
      if (Object.keys(settings).length > 0) {
        next.settings = settings;
      } else {
        delete next.settings;
      }
    }
    await saveDraft(m.id, MANIFEST_KEY, next);
    setEditingModule(null);
    refresh();
  };

  if (state.kind === "loading") {
    return <p className="text-parchment/80">Loading modules…</p>;
  }
  if (state.kind === "error") {
    return (
      <div>
        <p className="text-ember">Failed to list modules.</p>
        <p className="mt-2 font-mono text-sm text-parchment/80">
          {state.message}
        </p>
      </div>
    );
  }

  const modules = state.modules;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-parchment/80">
          {modules.length} module{modules.length === 1 ? "" : "s"} known.
          {state.draftCount > 0 ? (
            <span className="ml-2 text-parchment/65">
              · {state.draftCount} pending draft
              {state.draftCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          {state.indexDraftActive ? (
            <>
              <span className="rounded bg-ember/30 px-2 py-0.5 text-[13px] text-parchment/90">
                index draft
              </span>
              <button
                type="button"
                onClick={onDiscardIndex}
                className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/85 hover:bg-ink/40"
              >
                Discard index
              </button>
              <button
                type="button"
                onClick={onExportIndex}
                className="rounded border border-parchment/30 px-2 py-0.5 text-[13px] text-parchment/90 hover:bg-ink/40"
                title="Download the updated modules index — drop into web/public/modules/index.json to commit."
              >
                ⬇ Export index.json
              </button>
            </>
          ) : null}
          {state.anyDraftActive && publishAvailable === true ? (
            <button
              type="button"
              onClick={onPublishAll}
              disabled={publishing}
              className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
              title="Write every pending draft directly to disk via the local publish-server."
            >
              {publishing ? "Publishing…" : "Publish all drafts"}
            </button>
          ) : null}
          {state.anyDraftActive ? (
            <button
              type="button"
              onClick={onDiscardAll}
              className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
              title="Wipe every pending draft in your browser. Cannot be undone."
            >
              Discard all drafts
            </button>
          ) : null}
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded border border-ember/50 bg-ember/25 px-3 py-1 text-sm text-parchment hover:bg-ember/40"
            >
              + New module
            </button>
          ) : null}
        </div>
      </div>

      {creating ? (
        <NewModuleForm
          existingModules={modules}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {modules.length === 0 ? (
        <p className="text-parchment/80">No modules found.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {modules.map((m) => {
            const manifestDraft = hasDraft(m.id, MANIFEST_KEY);
            // The Default / any core module is protected — never
            // deletable from the UI. This keeps the inheritance root
            // intact across modules that extend it.
            const isProtected = m.id === "default" || m.role === "core";
            return (
              <li key={m.id} className="relative">
                <Link
                  href={`/editor/${encodeModuleId(m.id)}`}
                  className="block rounded-md border border-parchment/20 bg-ink/40 p-4 pr-20 transition hover:border-parchment/40 hover:bg-ink/60"
                >
                  <h2 className="font-display text-xl text-parchment">
                    {m.title}
                  </h2>
                  <p className="mt-1 text-sm text-parchment/85">
                    {m.description}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-parchment/70">
                    <span>id: {m.id}</span>
                    {m.author ? <span>by {m.author}</span> : null}
                    {m.role ? (
                      <span className="rounded bg-ember/30 px-2 py-0.5 text-parchment/90">
                        {m.role}
                      </span>
                    ) : null}
                    {manifestDraft ? (
                      <span className="rounded bg-parchment/20 px-2 py-0.5 text-parchment/90">
                        manifest draft
                      </span>
                    ) : null}
                    <span className="ml-auto uppercase tracking-wide text-parchment/60">
                      v{m.version}
                    </span>
                  </div>
                </Link>
                <div className="absolute right-2 top-2 flex gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingModule(m);
                    }}
                    className="rounded border border-parchment/20 bg-ink/60 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-parchment/50 hover:bg-ink/80 hover:text-parchment"
                    title="Edit this module's metadata (title, description, author, version, role)."
                  >
                    Properties
                  </button>
                  {!isProtected ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDeleteModule(m);
                      }}
                      className="rounded border border-parchment/20 bg-ink/60 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                      title="Remove this module from the index and discard its in-browser drafts. The on-disk folder must be deleted manually."
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editingModule ? (
        <ModulePropertiesDialog
          initial={editingModule}
          onSave={(patch) => onSaveModuleAttrs(editingModule, patch)}
          onClose={() => setEditingModule(null)}
        />
      ) : null}
    </div>
  );
}
