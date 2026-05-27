"use client";

/**
 * Libraries panel on the module landing page.
 *
 * Manages the `uses` array on this module's manifest. Add a library
 * from the picker → it shows up in the per-model catalog across every
 * model view. Remove a library → it stops showing in catalogs (but
 * any records you already imported remain in your overlay — they're
 * yours now).
 *
 * Edits accumulate as a localStorage manifest draft. Export downloads
 * the new module.json so the author can drop it into the repo and
 * commit. Inherited uses from the extends chain aren't editable here
 * (manage them from the parent module's panel).
 */

import { useEffect, useMemo, useState } from "react";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  discardDraft,
  downloadJson,
  hasDraft,
  MANIFEST_KEY,
  saveDraft,
} from "@/data_model/draft";
import type { ModuleSummary } from "@/data_model/ModuleSource";
import { publishItems } from "@/data_model/publishClient";
import { usePublishServer } from "./usePublishServer";

type Manifest = Record<string, unknown> & { uses?: string[] };

type State =
  | { kind: "loading" }
  | {
      kind: "ok";
      manifest: Manifest;
      allModules: ModuleSummary[];
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

export function LibrariesPanel({ moduleId }: { moduleId: string }) {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [picking, setPicking] = useState<string>("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const src = new StaticModuleSource();
    setState({ kind: "loading" });
    Promise.all([
      src.loadRawManifest(moduleId),
      src.list(),
    ])
      .then(([manifest, all]) => {
        if (cancelled) return;
        if (manifest === null) {
          setState({
            kind: "error",
            message: `Module ${moduleId} has no manifest.`,
          });
          return;
        }
        setState({
          kind: "ok",
          manifest: manifest as Manifest,
          allModules: all,
          isDraft: hasDraft(moduleId, MANIFEST_KEY),
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  // Reset the picker selection when the available list changes.
  const ownUses = useMemo(() => {
    if (state.kind !== "ok") return [];
    const u = state.manifest.uses;
    return Array.isArray(u) ? u.filter((v) => typeof v === "string") : [];
  }, [state]);

  const availableLibraries = useMemo(() => {
    if (state.kind !== "ok") return [];
    const owned = new Set(ownUses);
    return state.allModules.filter(
      (m) => m.role === "library" && m.id !== moduleId && !owned.has(m.id),
    );
  }, [state, ownUses, moduleId]);

  useEffect(() => {
    if (
      picking &&
      !availableLibraries.some((m) => m.id === picking)
    ) {
      setPicking("");
    }
  }, [availableLibraries, picking]);

  if (state.kind === "loading") {
    return (
      <p className="text-sm text-parchment/55">Loading libraries…</p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="text-sm text-ember/80">
        Libraries unavailable: {state.message}
      </p>
    );
  }

  const persist = (nextUses: string[]) => {
    const nextManifest: Manifest = { ...state.manifest, uses: nextUses };
    // Drop the `uses` key if empty, to keep manifests tidy.
    if (nextUses.length === 0) delete (nextManifest as Manifest).uses;
    // saveDraft is async (gzip) — fire-and-forget; the React state
    // update below is what UI reads.
    void saveDraft(moduleId, MANIFEST_KEY, nextManifest);
    setState({ ...state, manifest: nextManifest, isDraft: true });
  };

  const onAdd = (libId: string) => {
    if (!libId) return;
    if (ownUses.includes(libId)) return;
    persist([...ownUses, libId]);
    setPicking("");
  };

  const onRemove = (libId: string) => {
    persist(ownUses.filter((id) => id !== libId));
  };

  const onExport = () => {
    downloadJson("module.json", state.manifest);
  };

  const onPublish = async () => {
    if (state.kind !== "ok") return;
    setPublishing(true);
    try {
      const res = await publishItems([
        { kind: "manifest", moduleId, content: state.manifest },
      ]);
      const r = res.results[0];
      if (!r.ok) {
        window.alert(`Publish failed: ${r.error}`);
        return;
      }
      discardDraft(moduleId, MANIFEST_KEY);
      setState({ ...state, isDraft: false });
    } catch (e) {
      window.alert(
        `Publish error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPublishing(false);
    }
  };

  const onDiscardDraft = () => {
    if (!hasDraft(moduleId, MANIFEST_KEY)) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Discard pending changes to this module's manifest (uses array)?",
      )
    ) {
      return;
    }
    discardDraft(moduleId, MANIFEST_KEY);
    // Reload manifest from disk.
    const src = new StaticModuleSource();
    src.loadRawManifest(moduleId).then((manifest) => {
      if (manifest === null) return;
      setState({
        ...state,
        manifest: manifest as Manifest,
        isDraft: false,
      });
    });
  };

  const usesById = new Map(state.allModules.map((m) => [m.id, m]));

  return (
    <section className="mb-8">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-parchment/45">
            Libraries
          </h2>
          <p className="mt-1 text-sm text-parchment/55">
            Make library content available for import in this module&apos;s
            per-model catalogs. Adding a library doesn&apos;t pull anything
            in automatically — open a model view and click Import on the
            records you want.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.isDraft ? (
            <span className="rounded bg-ember/30 px-2 py-0.5 text-xs text-parchment/90">
              manifest draft
            </span>
          ) : null}
          {state.isDraft ? (
            <button
              type="button"
              onClick={onDiscardDraft}
              className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
            >
              Discard
            </button>
          ) : null}
          <button
            type="button"
            onClick={onExport}
            className="rounded border border-parchment/30 px-2 py-0.5 text-xs text-parchment/90 hover:bg-ink/40"
            title="Download the current module.json — drop it into the repo to commit."
          >
            ⬇ Export module.json
          </button>
          {state.isDraft && publishAvailable === true ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={publishing}
              className="rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-xs text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
              title="Write the manifest directly to disk via the local publish-server."
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="rounded border border-parchment/10 bg-ink/20 p-3">
        {ownUses.length === 0 ? (
          <p className="text-sm text-parchment/55">
            No libraries in <code className="text-parchment/75">uses</code>{" "}
            yet. Pick one below to make its content browsable in the
            per-model catalogs.
          </p>
        ) : (
          <ul className="space-y-1">
            {ownUses.map((libId) => {
              const meta = usesById.get(libId);
              return (
                <li
                  key={libId}
                  className="flex items-center justify-between rounded px-2 py-1 hover:bg-ink/40"
                >
                  <span className="text-sm text-parchment/90">
                    <span className="font-display">
                      {meta?.title ?? libId}
                    </span>
                    <span className="ml-2 text-parchment/45">{libId}</span>
                    {meta?.role && meta.role !== "library" ? (
                      <span className="ml-2 rounded bg-ember/20 px-1.5 py-0.5 text-[10px] uppercase text-parchment/80">
                        {meta.role}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(libId)}
                    className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
                    title="Remove from uses. Records you already imported into this module stay — they're yours."
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {availableLibraries.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-parchment/10 pt-3">
            <label
              htmlFor="library-picker"
              className="text-xs uppercase tracking-wide text-parchment/45"
            >
              Add library
            </label>
            <select
              id="library-picker"
              value={picking}
              onChange={(e) => setPicking(e.target.value)}
              className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment/90"
            >
              <option value="">— pick one —</option>
              {availableLibraries.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.id})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onAdd(picking)}
              disabled={!picking}
              className="rounded border border-ember/50 bg-ember/25 px-3 py-1 text-sm text-parchment hover:bg-ember/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Add
            </button>
          </div>
        ) : ownUses.length > 0 ? (
          <p className="mt-3 border-t border-parchment/10 pt-3 text-xs text-parchment/45">
            No more libraries available — every role:library module is
            already in this module&apos;s <code>uses</code>.
          </p>
        ) : null}
      </div>
    </section>
  );
}
