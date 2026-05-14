"use client";

/**
 * Client component that fetches one model's JSON at runtime, merges in
 * any localStorage draft, and renders an editable browse view.
 *
 * Editing flow:
 *   - Click a row to expand it (read-only JSON preview).
 *   - Click "Edit" in the expanded panel to open the auto-generated
 *     form (RecordForm).
 *   - Click "Save" in the form: the edit is applied to the in-memory
 *     collection and persisted to localStorage as a draft.
 *   - Top-level "Add new" creates a blank record using the first
 *     record as a template.
 *   - Top-level "Discard draft" removes the localStorage entry,
 *     reverting display to the source file on next load.
 *   - Top-level "Export JSON" downloads the current state (draft if
 *     present, source otherwise) so the author can drop it into the
 *     repo and commit.
 *
 * Deletion isn't wired in this pass — kept minimal on purpose.
 */

import { useEffect, useMemo, useState } from "react";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  discardDraft,
  downloadJson,
  hasDraft,
  loadDraft,
  saveDraft,
} from "@/data_model/draft";
import { MODELS, type ModelKey } from "@/data_model/models";
import { RecordForm } from "./RecordForm";

type Record_ = Record<string, unknown>;

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      data: Record_ | null;
      records: Record_[];
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

export function ModelView({
  moduleId,
  modelKey,
}: {
  moduleId: string;
  modelKey: ModelKey;
}) {
  const def = MODELS[modelKey];
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Source data (without drafts), kept so we can flag draft-modified
  // rows and so Discard Draft can revert cleanly.
  const [sourceRecords, setSourceRecords] = useState<Record_[]>([]);
  const [sourceSingleton, setSourceSingleton] = useState<Record_ | null>(null);

  useEffect(() => {
    let cancelled = false;
    const src = new StaticModuleSource();
    setState({ kind: "loading" });
    src
      .loadModel(moduleId, modelKey)
      .then((sourceData) => {
        if (cancelled) return;
        const draft = loadDraft<unknown>(moduleId, modelKey);
        const effective = draft ?? sourceData;
        if (def.collectionKey === null) {
          // Singleton.
          const single = (effective as Record_) ?? null;
          setSourceSingleton((sourceData as Record_) ?? null);
          setState({
            kind: "ok",
            data: single,
            records: [],
            isDraft: !!draft,
          });
        } else {
          const raw = effective as Record_ | null;
          const list =
            raw && Array.isArray(raw[def.collectionKey])
              ? (raw[def.collectionKey] as Record_[])
              : [];
          const sourceRaw = sourceData as Record_ | null;
          const sourceList =
            sourceRaw && Array.isArray(sourceRaw[def.collectionKey])
              ? (sourceRaw[def.collectionKey] as Record_[])
              : [];
          setSourceRecords(sourceList);
          setState({ kind: "ok", data: raw, records: list, isDraft: !!draft });
        }
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
  }, [moduleId, modelKey, def.collectionKey]);

  // Helper: build a "modified vs source" map by id for the badge.
  const rowStatus = useMemo(() => {
    const map = new Map<string, "modified" | "new">();
    if (state.kind !== "ok" || def.collectionKey === null) return map;
    const bySourceId = new Map<string, Record_>();
    for (const r of sourceRecords) {
      const id = String(r.id ?? "");
      if (id) bySourceId.set(id, r);
    }
    for (const r of state.records) {
      const id = String(r.id ?? "");
      if (!id) continue;
      const src = bySourceId.get(id);
      if (!src) {
        map.set(id, "new");
      } else if (JSON.stringify(src) !== JSON.stringify(r)) {
        map.set(id, "modified");
      }
    }
    return map;
  }, [state, sourceRecords, def.collectionKey]);

  const persist = (next: Record_ | null) => {
    saveDraft(moduleId, modelKey, next);
    if (def.collectionKey === null) {
      setState({ kind: "ok", data: next, records: [], isDraft: true });
    } else {
      const list =
        next && Array.isArray(next[def.collectionKey])
          ? (next[def.collectionKey] as Record_[])
          : [];
      setState({ kind: "ok", data: next, records: list, isDraft: true });
    }
  };

  const updateRecord = (id: string, updated: Record_) => {
    if (state.kind !== "ok" || def.collectionKey === null) return;
    const records = state.records.map((r) =>
      String(r.id ?? "") === id ? updated : r,
    );
    const next: Record_ = { ...(state.data ?? {}), [def.collectionKey]: records };
    persist(next);
  };

  const addRecord = (record: Record_) => {
    if (state.kind !== "ok" || def.collectionKey === null) return;
    const records = [...state.records, record];
    const next: Record_ = { ...(state.data ?? {}), [def.collectionKey]: records };
    persist(next);
  };

  const updateSingleton = (updated: Record_) => {
    persist(updated);
  };

  const onDiscardDraft = () => {
    if (!hasDraft(moduleId, modelKey)) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Discard all draft edits for this model?")
    ) {
      return;
    }
    discardDraft(moduleId, modelKey);
    // Reload from source.
    if (def.collectionKey === null) {
      setState({
        kind: "ok",
        data: sourceSingleton,
        records: [],
        isDraft: false,
      });
    } else {
      const sourceRaw = sourceSingleton; // unused for collections, just keep symmetry
      void sourceRaw;
      const records = sourceRecords;
      const data: Record_ = { [def.collectionKey]: records };
      setState({ kind: "ok", data, records, isDraft: false });
    }
    setEditingId(null);
    setCreating(false);
  };

  const onExport = () => {
    if (state.kind !== "ok") return;
    downloadJson(def.fileName, state.data);
  };

  // ── render ────────────────────────────────────────────────────────
  if (state.kind === "loading")
    return <p className="p-4 text-parchment/60">Loading {def.label}…</p>;

  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load {def.label}.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <Header
        def={def}
        count={state.records.length}
        isDraft={state.isDraft}
        isSingleton={def.collectionKey === null}
        onAdd={
          def.collectionKey === null
            ? undefined
            : () => {
                setCreating(true);
                setEditingId(null);
                setOpenId(null);
              }
        }
        onDiscardDraft={state.isDraft ? onDiscardDraft : undefined}
        onExport={onExport}
      />

      {/* Singleton — full record form / view */}
      {def.collectionKey === null ? (
        <div className="mt-4">
          {editingId === "__singleton__" ? (
            <RecordForm
              record={state.data ?? {}}
              onSave={(updated) => {
                updateSingleton(updated);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <pre className="overflow-auto rounded bg-ink/60 p-4 text-xs text-parchment/90">
                {JSON.stringify(state.data, null, 2)}
              </pre>
              <button
                type="button"
                onClick={() => setEditingId("__singleton__")}
                className="mt-3 rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50"
              >
                Edit
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Add-new form sits above the table when active */}
          {creating ? (
            <div className="mt-4">
              <p className="mb-2 text-sm text-parchment/70">New record</p>
              <RecordForm
                record={blankFromTemplate(state.records[0] ?? sourceRecords[0])}
                template={state.records[0] ?? sourceRecords[0]}
                submitLabel="Add"
                onSave={(rec) => {
                  addRecord(rec);
                  setCreating(false);
                  setOpenId(String(rec.id ?? ""));
                }}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : null}

          <div className="mt-4 overflow-auto rounded border border-parchment/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink/60 text-parchment/70">
                <tr>
                  <th className="w-6 px-2 py-1"></th>
                  {def.columns.map((c) => (
                    <th key={c.field} className="px-2 py-1 font-semibold">
                      {c.label}
                    </th>
                  ))}
                  <th className="w-20 px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {state.records.map((r, i) => {
                  const id = String(r.id ?? i);
                  const isOpen = openId === id;
                  const isEditing = editingId === id;
                  return (
                    <RowGroup
                      key={id}
                      record={r}
                      rowKey={id}
                      isOpen={isOpen}
                      isEditing={isEditing}
                      status={rowStatus.get(id)}
                      onToggle={() => {
                        if (isEditing) return;
                        setOpenId(isOpen ? null : id);
                      }}
                      onStartEdit={() => {
                        setEditingId(id);
                        setOpenId(id);
                      }}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={(updated) => {
                        updateRecord(id, updated);
                        setEditingId(null);
                      }}
                      def={def}
                      template={state.records[0] ?? sourceRecords[0] ?? r}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function blankFromTemplate(template?: Record_): Record_ {
  if (!template) return { id: "", name: "" };
  const out: Record_ = {};
  for (const [k, v] of Object.entries(template)) {
    if (k === "_comment") continue;
    if (typeof v === "string") out[k] = "";
    else if (typeof v === "number") out[k] = 0;
    else if (typeof v === "boolean") out[k] = false;
    else if (Array.isArray(v)) out[k] = [];
    else if (v !== null && typeof v === "object") out[k] = {};
    else out[k] = null;
  }
  return out;
}

function Header({
  def,
  count,
  isDraft,
  isSingleton,
  onAdd,
  onDiscardDraft,
  onExport,
}: {
  def: (typeof MODELS)[ModelKey];
  count: number;
  isDraft: boolean;
  isSingleton: boolean;
  onAdd?: () => void;
  onDiscardDraft?: () => void;
  onExport: () => void;
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl text-parchment">{def.label}</h1>
        <div className="mt-1 flex items-center gap-3 text-sm text-parchment/60">
          {!isSingleton ? <span>{count} records</span> : null}
          <span className="text-parchment/40">·</span>
          <span>{def.scope === "shared" ? "shared" : "module-scoped"}</span>
          {isDraft ? (
            <span className="rounded bg-ember/30 px-2 py-0.5 text-xs text-parchment/90">
              draft active
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/90 hover:bg-ink/40"
          >
            + Add
          </button>
        ) : null}
        {onDiscardDraft ? (
          <button
            type="button"
            onClick={onDiscardDraft}
            className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/70 hover:bg-ink/40"
          >
            Discard draft
          </button>
        ) : null}
        <button
          type="button"
          onClick={onExport}
          className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/90 hover:bg-ink/40"
        >
          ⬇ Export
        </button>
      </div>
    </header>
  );
}

function RowGroup({
  record,
  rowKey,
  isOpen,
  isEditing,
  status,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  def,
  template,
}: {
  record: Record_;
  rowKey: string;
  isOpen: boolean;
  isEditing: boolean;
  status?: "modified" | "new";
  onToggle: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (updated: Record_) => void;
  def: (typeof MODELS)[ModelKey];
  template: Record_;
}) {
  void rowKey;
  return (
    <>
      <tr
        className={`cursor-pointer border-t border-parchment/5 ${
          isOpen ? "bg-ember/10" : "hover:bg-ink/30"
        }`}
        onClick={onToggle}
      >
        <td className="px-2 py-1 text-parchment/50">{isOpen ? "▾" : "▸"}</td>
        {def.columns.map((c) => {
          const v = record[c.field];
          const display = c.format ? c.format(v) : v == null ? "" : String(v);
          return (
            <td
              key={c.field}
              className="max-w-md truncate px-2 py-1 text-parchment/90"
            >
              {display}
            </td>
          );
        })}
        <td className="px-2 py-1 text-right">
          {status === "new" ? (
            <span className="rounded bg-ember/30 px-1.5 py-0.5 text-[10px] text-parchment/90">
              new
            </span>
          ) : status === "modified" ? (
            <span className="rounded bg-parchment/20 px-1.5 py-0.5 text-[10px] text-parchment/90">
              modified
            </span>
          ) : null}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-parchment/5">
          <td></td>
          <td colSpan={def.columns.length + 1} className="px-2 pb-3">
            {isEditing ? (
              <RecordForm
                record={record}
                template={template}
                onSave={onSaveEdit}
                onCancel={onCancelEdit}
              />
            ) : (
              <div>
                <pre className="overflow-auto rounded bg-ink/60 p-3 text-xs text-parchment/85">
                  {JSON.stringify(record, null, 2)}
                </pre>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartEdit();
                  }}
                  className="mt-2 rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50"
                >
                  Edit
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
