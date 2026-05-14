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

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  discardIndexDraft,
  downloadJson,
  hasDraft,
  hasIndexDraft,
  loadIndexDraft,
  MANIFEST_KEY,
} from "@/data_model/draft";
import type { ModuleSummary } from "@/data_model/ModuleSource";
import { NewModuleForm } from "./NewModuleForm";

type State =
  | { kind: "loading" }
  | {
      kind: "ok";
      modules: ModuleSummary[];
      indexDraftActive: boolean;
    }
  | { kind: "error"; message: string };

export function ModulePicker() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    const src = new StaticModuleSource();
    src
      .list()
      .then((modules) =>
        setState({
          kind: "ok",
          modules,
          indexDraftActive: hasIndexDraft(),
        }),
      )
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

  const onExportIndex = () => {
    const draft = loadIndexDraft<unknown>();
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

  if (state.kind === "loading") {
    return <p className="text-parchment/60">Loading modules…</p>;
  }
  if (state.kind === "error") {
    return (
      <div>
        <p className="text-ember">Failed to list modules.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }

  const modules = state.modules;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-parchment/60">
          {modules.length} module{modules.length === 1 ? "" : "s"} known.
        </p>
        <div className="flex items-center gap-2">
          {state.indexDraftActive ? (
            <>
              <span className="rounded bg-ember/30 px-2 py-0.5 text-xs text-parchment/90">
                index draft
              </span>
              <button
                type="button"
                onClick={onDiscardIndex}
                className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={onExportIndex}
                className="rounded border border-parchment/30 px-2 py-0.5 text-xs text-parchment/90 hover:bg-ink/40"
                title="Download the updated modules index — drop into web/public/modules/index.json to commit."
              >
                ⬇ Export index.json
              </button>
            </>
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
        <p className="text-parchment/60">No modules found.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {modules.map((m) => {
            const manifestDraft = hasDraft(m.id, MANIFEST_KEY);
            return (
              <li key={m.id}>
                <Link
                  href={`/editor/${m.id}`}
                  className="block rounded-md border border-parchment/20 bg-ink/40 p-4 transition hover:border-parchment/40 hover:bg-ink/60"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-xl text-parchment">
                      {m.title}
                    </h2>
                    <span className="text-xs uppercase tracking-wide text-parchment/40">
                      v{m.version}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-parchment/70">
                    {m.description}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-parchment/50">
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
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
