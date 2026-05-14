"use client";

/**
 * Client component that fetches one model's layered data (inherited
 * from ancestors + this module's own file) and renders an editable
 * browse view with inheritance badges.
 *
 * Mental model: this module's "own file" is an overlay on top of the
 * inherited records. Each row's badge tells you where it came from:
 *
 *   - inherited  → the id exists only in an ancestor; this module
 *                  hasn't touched it. Edits become overrides.
 *   - overridden → the id exists in an ancestor AND in this module's
 *                  own file. The module's version wins. Revert puts
 *                  it back to the inherited record.
 *   - new        → the id exists only in this module's own file.
 *                  Remove deletes it.
 *
 * Editing flow:
 *   - "Add new" creates a blank record (templated from the first
 *     row) in this module's overlay.
 *   - "Edit" on any row opens the auto-generated form (RecordForm)
 *     pre-filled with the displayed values; saving writes the record
 *     into the overlay (copy-on-write).
 *   - "Revert" on an overridden row removes that id from the overlay
 *     so the row falls back to the inherited record.
 *   - "Remove" on a new row drops it from the overlay entirely.
 *   - "Discard draft" clears the in-memory overlay back to whatever
 *     is on disk for this module's own file.
 *   - "Export" downloads the overlay (this module's own file shape)
 *     so the author can drop it into the repo and commit.
 *
 * Deletion of inherited records (subtractive override) isn't wired
 * in this pass — would need a `removed: [...ids]` mechanism in the
 * merge layer.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  discardDraft,
  downloadJson,
  hasDraft,
  loadDraft,
  saveDraft,
} from "@/data_model/draft";
import { extractRecords, mergeModel } from "@/data_model/merge";
import { MODELS, type ModelKey } from "@/data_model/models";
import type { LibraryCatalogEntry } from "@/data_model/ModuleSource";
import { publishItems } from "@/data_model/publishClient";
import { RecordForm } from "./RecordForm";
import {
  getSpriteFieldConfig,
  resolveSpritePath,
} from "./spriteFields";
import { usePublishServer } from "./usePublishServer";

type Record_ = Record<string, unknown>;

type Layers = {
  inherited: Record_ | null;
  ownFile: Record_ | null;
  parentId?: string;
  usedLibraryIds: string[];
};

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      layers: Layers;
      ownDraft: Record_ | null;
      catalog: LibraryCatalogEntry[];
    }
  | { kind: "error"; message: string };

type RowProvenance = "inherited" | "overridden" | "new";

export function ModelView({
  moduleId,
  modelKey,
}: {
  moduleId: string;
  modelKey: ModelKey;
}) {
  const def = MODELS[modelKey];
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Load layers + library catalog in parallel.
  useEffect(() => {
    let cancelled = false;
    const src = new StaticModuleSource();
    setState({ kind: "loading" });
    Promise.all([
      src.loadModelLayers(moduleId, modelKey),
      src.listLibraryRecords(moduleId, modelKey),
    ])
      .then(([rawLayers, catalog]) => {
        if (cancelled) return;
        const layers: Layers = {
          inherited: (rawLayers.inherited as Record_ | null) ?? null,
          ownFile: (rawLayers.ownFile as Record_ | null) ?? null,
          parentId: rawLayers.parentId,
          usedLibraryIds: rawLayers.usedLibraryIds ?? [],
        };
        const draft = loadDraft<Record_ | null>(moduleId, modelKey);
        setState({
          kind: "ok",
          layers,
          ownDraft: draft ?? null,
          catalog,
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
  }, [moduleId, modelKey]);

  // ── derived state ────────────────────────────────────────────────
  const derived = useMemo(() => {
    if (state.kind !== "ok") return null;
    const { layers, ownDraft } = state;
    const isDraft = ownDraft !== null;
    const ownEffective: Record_ | null = ownDraft ?? layers.ownFile;
    const displayedFull = mergeModel(
      def.collectionKey,
      layers.inherited,
      ownEffective,
    ) as Record_ | null;

    if (def.collectionKey === null) {
      // Singleton.
      const inheritedRec = layers.inherited as Record_ | null;
      const displayedRec = displayedFull;
      let singletonProvenance: RowProvenance | null;
      if (ownEffective != null && inheritedRec != null)
        singletonProvenance = "overridden";
      else if (ownEffective != null) singletonProvenance = "new";
      else if (inheritedRec != null) singletonProvenance = "inherited";
      else singletonProvenance = null;
      return {
        isDraft,
        ownEffective,
        displayedSingleton: displayedRec,
        inheritedSingleton: inheritedRec,
        singletonProvenance,
        records: [] as Record_[],
        rowProv: new Map<string, RowProvenance>(),
        counts: { total: 0, inherited: 0, overridden: 0, own: 0 },
      };
    }

    const collectionKey = def.collectionKey;
    const inheritedRecords = extractRecords(
      collectionKey,
      layers.inherited,
    );
    const ownRecords = extractRecords(collectionKey, ownEffective);
    const displayedRecords = extractRecords(collectionKey, displayedFull);

    const inheritedIds = new Set(
      inheritedRecords.map((r) => String(r.id ?? "")).filter(Boolean),
    );
    const ownIds = new Set(
      ownRecords.map((r) => String(r.id ?? "")).filter(Boolean),
    );

    const rowProv = new Map<string, RowProvenance>();
    let inheritedCount = 0;
    let overriddenCount = 0;
    let newCount = 0;
    for (const r of displayedRecords) {
      const id = String(r.id ?? "");
      if (!id) continue;
      const inIn = inheritedIds.has(id);
      const inOwn = ownIds.has(id);
      if (inOwn && inIn) {
        rowProv.set(id, "overridden");
        overriddenCount++;
      } else if (inOwn) {
        rowProv.set(id, "new");
        newCount++;
      } else if (inIn) {
        rowProv.set(id, "inherited");
        inheritedCount++;
      }
    }

    return {
      isDraft,
      ownEffective,
      displayedSingleton: null,
      inheritedSingleton: null,
      singletonProvenance: null,
      records: displayedRecords,
      rowProv,
      counts: {
        total: displayedRecords.length,
        inherited: inheritedCount,
        overridden: overriddenCount,
        own: newCount,
      },
    };
  }, [state, def.collectionKey]);

  // ── mutators (all go through saveOwn so localStorage stays in sync) ─
  const saveOwn = (next: Record_ | null) => {
    saveDraft(moduleId, modelKey, next);
    setState((s) =>
      s.kind === "ok" ? { ...s, ownDraft: next } : s,
    );
  };

  const upsertRecord = (id: string, updated: Record_) => {
    if (state.kind !== "ok" || def.collectionKey === null) return;
    const collectionKey = def.collectionKey;
    const current = (state.ownDraft ?? state.layers.ownFile) as Record_ | null;
    const currentRecords = extractRecords(collectionKey, current);
    const exists = currentRecords.some((r) => String(r.id ?? "") === id);
    const nextRecords = exists
      ? currentRecords.map((r) =>
          String(r.id ?? "") === id ? updated : r,
        )
      : [...currentRecords, updated];
    const next: Record_ = {
      ...(current ?? {}),
      [collectionKey]: nextRecords,
    };
    saveOwn(next);
  };

  const removeFromOwn = (id: string) => {
    if (state.kind !== "ok" || def.collectionKey === null) return;
    const collectionKey = def.collectionKey;
    const current = (state.ownDraft ?? state.layers.ownFile) as Record_ | null;
    if (current === null) return;
    const filtered = extractRecords(collectionKey, current).filter(
      (r) => String(r.id ?? "") !== id,
    );
    const next: Record_ = { ...current, [collectionKey]: filtered };
    saveOwn(next);
  };

  /** Copy a library record into this module's overlay. Deep-cloned so
   *  later edits don't accidentally mutate the library's in-memory
   *  data. Once imported, the record is just a regular own record —
   *  no link back to the library, no future tracking. */
  const importFromLibrary = (rec: Record_) => {
    const id = String(rec.id ?? "");
    if (!id) return;
    const cloned = JSON.parse(JSON.stringify(rec)) as Record_;
    upsertRecord(id, cloned);
  };

  const updateSingleton = (updated: Record_ | null) => {
    saveOwn(updated);
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
    setState((s) =>
      s.kind === "ok" ? { ...s, ownDraft: null } : s,
    );
    setEditingId(null);
    setCreating(false);
  };

  const onExport = () => {
    if (state.kind !== "ok" || !derived) return;
    const payload = derived.ownEffective;
    if (payload === null) return; // nothing to export
    downloadJson(def.fileName, payload);
  };

  const onPublish = async () => {
    if (state.kind !== "ok" || !derived) return;
    const payload = derived.ownEffective;
    if (payload === null) return;
    setPublishing(true);
    try {
      const res = await publishItems([
        {
          kind: "model",
          moduleId,
          modelKey,
          fileName: def.fileName,
          content: payload,
        },
      ]);
      const result = res.results[0];
      if (!result.ok) {
        window.alert(`Publish failed: ${result.error}`);
        return;
      }
      // Successful write — clear the draft so the editor reloads from
      // the on-disk file we just wrote. Re-fetch via the source so
      // the layered view reflects the new ownFile.
      discardDraft(moduleId, modelKey);
      const src = new StaticModuleSource();
      const fresh = await src.loadModelLayers(moduleId, modelKey);
      setState((s) =>
        s.kind === "ok"
          ? {
              ...s,
              layers: {
                inherited: (fresh.inherited as Record_ | null) ?? null,
                ownFile: (fresh.ownFile as Record_ | null) ?? null,
                parentId: fresh.parentId,
                usedLibraryIds: fresh.usedLibraryIds ?? [],
              },
              ownDraft: null,
            }
          : s,
      );
    } catch (e) {
      window.alert(
        `Publish error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPublishing(false);
    }
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

  if (!derived) return null;

  const inheritedRecordsForTemplate = extractRecords(
    def.collectionKey ?? "",
    state.layers.inherited,
  );
  const template =
    derived.records[0] ?? inheritedRecordsForTemplate[0] ?? undefined;
  const canExport = derived.ownEffective !== null;
  // Whether the table should grow a leading thumbnail column. Yes if
  // any displayed record or the template has a known sprite field.
  const hasSpriteColumn =
    derived.records.some((r) => recordHasSpriteField(r, modelKey)) ||
    (template ? recordHasSpriteField(template, modelKey) : false);
  // Suppress per-row provenance when there's no extends parent —
  // every record would be "new" and the badges would be noise. Used
  // libraries don't affect provenance because their records aren't
  // in the resolved view (they live in the import catalog).
  const showProvenance = state.layers.parentId !== undefined;

  // Compute the available-from-libraries catalog: each library's
  // records, filtered to exclude ids already present in the resolved
  // view (inherited or own). Once a record is imported into own,
  // it disappears from this list.
  const presentIds = new Set<string>();
  if (def.collectionKey !== null) {
    for (const r of derived.records) {
      const id = String(r.id ?? "");
      if (id) presentIds.add(id);
    }
  }
  const availableCatalog =
    def.collectionKey === null
      ? []
      : state.catalog
          .map((entry) => ({
            libraryId: entry.libraryId,
            records: entry.records.filter((r) => {
              const id = String(r.id ?? "");
              return id && !presentIds.has(id);
            }),
          }))
          .filter((entry) => entry.records.length > 0);

  return (
    <div className="p-4">
      <Header
        def={def}
        counts={derived.counts}
        isDraft={derived.isDraft}
        isSingleton={def.collectionKey === null}
        parentId={state.layers.parentId}
        usedLibraryIds={state.layers.usedLibraryIds}
        showProvenance={showProvenance}
        canExport={canExport}
        canPublish={canExport && publishAvailable === true && derived.isDraft}
        publishing={publishing}
        onAdd={
          def.collectionKey === null
            ? undefined
            : () => {
                setCreating(true);
                setEditingId(null);
                setOpenId(null);
              }
        }
        onDiscardDraft={derived.isDraft ? onDiscardDraft : undefined}
        onExport={onExport}
        onPublish={onPublish}
      />

      {/* Singleton */}
      {def.collectionKey === null ? (
        <SingletonView
          displayed={derived.displayedSingleton}
          inherited={derived.inheritedSingleton}
          ownEffective={derived.ownEffective as Record_ | null}
          provenance={showProvenance ? derived.singletonProvenance : null}
          editing={editingId === "__singleton__"}
          modelKey={modelKey}
          onStartEdit={() => setEditingId("__singleton__")}
          onCancelEdit={() => setEditingId(null)}
          onSave={(updated) => {
            updateSingleton(updated);
            setEditingId(null);
          }}
          onRevert={() => {
            updateSingleton(null);
          }}
        />
      ) : (
        <>
          {creating ? (
            <div className="mt-4">
              <p className="mb-2 text-sm text-parchment/70">New record</p>
              <RecordForm
                record={blankFromTemplate(template)}
                template={template}
                submitLabel="Add"
                modelKey={modelKey}
                onSave={(rec) => {
                  const newId = String(rec.id ?? "");
                  if (newId) upsertRecord(newId, rec);
                  setCreating(false);
                  setOpenId(newId);
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
                  {hasSpriteColumn ? (
                    <th className="w-12 px-2 py-1"></th>
                  ) : null}
                  {def.columns.map((c) => (
                    <th key={c.field} className="px-2 py-1 font-semibold">
                      {c.label}
                    </th>
                  ))}
                  <th className="w-24 px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {derived.records.map((r, i) => {
                  const id = String(r.id ?? i);
                  const isOpen = openId === id;
                  const isEditing = editingId === id;
                  return (
                    <RowGroup
                      key={id}
                      record={r}
                      isOpen={isOpen}
                      isEditing={isEditing}
                      provenance={derived.rowProv.get(id) ?? "inherited"}
                      showProvenance={showProvenance}
                      hasSpriteColumn={hasSpriteColumn}
                      modelKey={modelKey}
                      moduleId={moduleId}
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
                        upsertRecord(id, updated);
                        setEditingId(null);
                      }}
                      onRevert={() => {
                        removeFromOwn(id);
                        setEditingId(null);
                        if (openId === id) setOpenId(null);
                      }}
                      def={def}
                      template={template ?? r}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {availableCatalog.length > 0 ? (
            <LibraryCatalog
              entries={availableCatalog}
              def={def}
              modelKey={modelKey}
              onImport={importFromLibrary}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/** Does this record have any known sprite-typed field with a value?
 *  Used to decide whether the browse table grows a thumbnail column. */
function recordHasSpriteField(record: Record_, modelKey?: string): boolean {
  for (const key of Object.keys(record)) {
    if (getSpriteFieldConfig(key, modelKey) !== null) return true;
  }
  return false;
}

/** Renders a small sprite thumbnail for a row, resolved from the
 *  record's first known sprite field. Renders an empty slot when the
 *  record has no sprite field or the value doesn't resolve. Tracks
 *  broken-image state in React (not via direct DOM mutation) so the
 *  hidden flag clears when src changes to a working URL. */
function RecordSpriteThumb({
  record,
  modelKey,
}: {
  record: Record_;
  modelKey?: string;
}) {
  let src: string | null = null;
  let alt = "";
  for (const [key, value] of Object.entries(record)) {
    const config = getSpriteFieldConfig(key, modelKey);
    if (!config) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    src = resolveSpritePath(value, config);
    if (src) {
      alt = value;
      break;
    }
  }
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  return (
    <div className="relative h-8 w-8 shrink-0 rounded border border-parchment/10 bg-ink/80">
      {src && !broken ? (
        <img
          src={src}
          alt={alt}
          width={32}
          height={32}
          style={{ imageRendering: "pixelated" }}
          className="h-8 w-8 object-contain"
          onError={() => setBroken(true)}
        />
      ) : null}
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

function ProvenanceBadge({ kind }: { kind: RowProvenance }) {
  if (kind === "new") {
    return (
      <span
        title="This record exists only in this module — not in any ancestor."
        className="rounded bg-ember/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-parchment/95"
      >
        new
      </span>
    );
  }
  if (kind === "overridden") {
    return (
      <span
        title="This module overrides an inherited record with the same id."
        className="rounded bg-ember/25 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-parchment/90"
      >
        override
      </span>
    );
  }
  return (
    <span
      title="Inherited from an ancestor module — this module hasn't modified it."
      className="rounded bg-parchment/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-parchment/55"
    >
      inherited
    </span>
  );
}

function Header({
  def,
  counts,
  isDraft,
  isSingleton,
  parentId,
  usedLibraryIds,
  showProvenance,
  canExport,
  canPublish,
  publishing,
  onAdd,
  onDiscardDraft,
  onExport,
  onPublish,
}: {
  def: (typeof MODELS)[ModelKey];
  counts: { total: number; inherited: number; overridden: number; own: number };
  isDraft: boolean;
  isSingleton: boolean;
  parentId?: string;
  usedLibraryIds: string[];
  showProvenance: boolean;
  canExport: boolean;
  canPublish: boolean;
  publishing: boolean;
  onAdd?: () => void;
  onDiscardDraft?: () => void;
  onExport: () => void;
  onPublish: () => void;
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl text-parchment">{def.label}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-parchment/60">
          {!isSingleton ? (
            <span>
              {counts.total} records
              {showProvenance &&
              counts.inherited + counts.overridden + counts.own > 0 ? (
                <span className="ml-1 text-parchment/45">
                  ({counts.inherited} inherited
                  {counts.overridden ? `, ${counts.overridden} overridden` : ""}
                  {counts.own ? `, ${counts.own} new` : ""})
                </span>
              ) : null}
            </span>
          ) : null}
          {parentId ? (
            <>
              {!isSingleton ? (
                <span className="text-parchment/40">·</span>
              ) : null}
              <span>
                inherits from{" "}
                <span className="text-parchment/85">{parentId}</span>
              </span>
            </>
          ) : null}
          {usedLibraryIds.length > 0 ? (
            <>
              <span className="text-parchment/40">·</span>
              <span>
                library:{" "}
                {usedLibraryIds.map((id, i) => (
                  <span key={id}>
                    <span className="text-parchment/85">{id}</span>
                    {i < usedLibraryIds.length - 1 ? ", " : ""}
                  </span>
                ))}
              </span>
            </>
          ) : null}
          <span className="text-parchment/40">·</span>
          <span>{def.fileName}</span>
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
          disabled={!canExport}
          title={
            canExport
              ? "Download the overlay file for this module"
              : "Nothing to export — this module has no overrides for this model"
          }
          className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/90 hover:bg-ink/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ⬇ Export
        </button>
        {canPublish ? (
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing}
            title="Write this model's overlay directly to disk via the local publish-server."
            className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        ) : null}
      </div>
    </header>
  );
}

function SingletonView({
  displayed,
  inherited,
  ownEffective,
  provenance,
  editing,
  modelKey,
  onStartEdit,
  onCancelEdit,
  onSave,
  onRevert,
}: {
  displayed: Record_ | null;
  inherited: Record_ | null;
  ownEffective: Record_ | null;
  provenance: RowProvenance | null;
  editing: boolean;
  modelKey?: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (updated: Record_) => void;
  onRevert: () => void;
}) {
  return (
    <div className="mt-4">
      {provenance ? (
        <div className="mb-2 flex items-center gap-2">
          <ProvenanceBadge kind={provenance} />
          {provenance === "inherited" ? (
            <span className="text-xs text-parchment/55">
              Editing will create an override in this module.
            </span>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <RecordForm
          record={displayed ?? inherited ?? {}}
          modelKey={modelKey}
          onSave={onSave}
          onCancel={onCancelEdit}
        />
      ) : (
        <>
          <pre className="overflow-auto rounded bg-ink/60 p-4 text-xs text-parchment/90">
            {JSON.stringify(displayed, null, 2)}
          </pre>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onStartEdit}
              className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50"
            >
              Edit
            </button>
            {ownEffective !== null && inherited !== null ? (
              <button
                type="button"
                onClick={onRevert}
                className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/80 hover:bg-ink/40"
                title="Drop this module's override and use the inherited record."
              >
                Revert to inherited
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function RowGroup({
  record,
  isOpen,
  isEditing,
  provenance,
  showProvenance,
  hasSpriteColumn,
  modelKey,
  moduleId,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRevert,
  def,
  template,
}: {
  record: Record_;
  isOpen: boolean;
  isEditing: boolean;
  provenance: RowProvenance;
  showProvenance: boolean;
  hasSpriteColumn: boolean;
  modelKey?: string;
  /** Needed so map rows can link into the visual map editor. */
  moduleId?: string;
  onToggle: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (updated: Record_) => void;
  onRevert: () => void;
  def: (typeof MODELS)[ModelKey];
  template: Record_;
}) {
  const router = useRouter();
  // Map rows lead straight into the visual editor — that's the primary
  // workflow for maps. Other models still click-to-expand into JSON.
  const isMapRow = modelKey === "maps" && !!moduleId && !!record.id;
  const onRowClick = () => {
    if (isMapRow) {
      router.push(`/editor/${moduleId}/maps/${String(record.id)}`);
    } else {
      onToggle();
    }
  };
  return (
    <>
      <tr
        className={`cursor-pointer border-t border-parchment/5 ${
          isOpen ? "bg-ember/10" : "hover:bg-ink/30"
        }`}
        onClick={onRowClick}
      >
        <td className="px-2 py-1 text-parchment/50">{isOpen ? "▾" : "▸"}</td>
        {hasSpriteColumn ? (
          <td className="px-2 py-1">
            <RecordSpriteThumb record={record} modelKey={modelKey} />
          </td>
        ) : null}
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
          <div className="flex items-center justify-end gap-2">
            {showProvenance ? <ProvenanceBadge kind={provenance} /> : null}
            {modelKey === "maps" && record.id ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm(
                      `Delete map "${record.id}"?\n\nThis removes it from this module's maps file. The change saves to the draft until you Publish.`,
                    )
                  )
                    return;
                  onRevert();
                }}
                className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/60 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                title="Delete this map from the module's maps file."
              >
                Delete
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-parchment/5">
          <td></td>
          {hasSpriteColumn ? <td></td> : null}
          <td colSpan={def.columns.length + 1} className="px-2 pb-3">
            {isEditing ? (
              <RecordForm
                record={record}
                template={template}
                modelKey={modelKey}
                onSave={onSaveEdit}
                onCancel={onCancelEdit}
              />
            ) : (
              <div>
                <pre className="overflow-auto rounded bg-ink/60 p-3 text-xs text-parchment/85">
                  {JSON.stringify(record, null, 2)}
                </pre>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartEdit();
                    }}
                    className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50"
                  >
                    Edit
                  </button>
                  {modelKey === "maps" && record.id && moduleId ? (
                    <Link
                      href={`/editor/${moduleId}/maps/${String(record.id)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border border-ember/40 bg-ember/15 px-3 py-1 text-sm text-parchment hover:bg-ember/30"
                      title="Open in the visual map editor (canvas + paint)."
                    >
                      Open Map Editor →
                    </Link>
                  ) : null}
                  {showProvenance && provenance === "overridden" ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRevert();
                      }}
                      className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/80 hover:bg-ink/40"
                      title="Drop this module's override and use the inherited record."
                    >
                      Revert to inherited
                    </button>
                  ) : null}
                  {showProvenance && provenance === "new" ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRevert();
                      }}
                      className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/80 hover:bg-ink/40"
                      title="Remove this record from the module's overlay."
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Catalog of library records the author can import into this module.
 *  Grouped by library; ids already in the resolved view are filtered
 *  out by the caller. Click Import → record gets copied into the
 *  module's own file as a regular new record. From that point on the
 *  record is "native" to this module — no link back to the library,
 *  no future tracking. */
function LibraryCatalog({
  entries,
  def,
  modelKey,
  onImport,
}: {
  entries: Array<{
    libraryId: string;
    records: Record_[];
  }>;
  def: (typeof MODELS)[ModelKey];
  modelKey?: string;
  onImport: (record: Record_) => void;
}) {
  const total = entries.reduce((sum, e) => sum + e.records.length, 0);
  // Same column heuristic as the main table: show the thumb column
  // if any library record carries a known sprite field.
  const hasSpriteColumn = entries.some((e) =>
    e.records.some((r) => recordHasSpriteField(r, modelKey)),
  );
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs uppercase tracking-wide text-parchment/45">
        Available from libraries
        <span className="ml-2 text-parchment/35 normal-case tracking-normal">
          ({total} record{total === 1 ? "" : "s"} ready to import)
        </span>
      </h2>
      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.libraryId}
            className="overflow-auto rounded border border-parchment/10 bg-ink/20"
          >
            <div className="border-b border-parchment/10 bg-ink/40 px-3 py-1 text-xs text-parchment/70">
              <span className="text-parchment/85">{entry.libraryId}</span>
              <span className="ml-2 text-parchment/40">
                ({entry.records.length} available)
              </span>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-parchment/55">
                <tr>
                  {hasSpriteColumn ? (
                    <th className="w-12 px-2 py-1"></th>
                  ) : null}
                  {def.columns.map((c) => (
                    <th key={c.field} className="px-2 py-1 font-normal">
                      {c.label}
                    </th>
                  ))}
                  <th className="w-20 px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {entry.records.map((r, i) => {
                  const id = String(r.id ?? `lib-${entry.libraryId}-${i}`);
                  return (
                    <tr key={id} className="border-t border-parchment/5">
                      {hasSpriteColumn ? (
                        <td className="px-2 py-1">
                          <RecordSpriteThumb record={r} modelKey={modelKey} />
                        </td>
                      ) : null}
                      {def.columns.map((c) => {
                        const v = r[c.field];
                        const display = c.format
                          ? c.format(v)
                          : v == null
                            ? ""
                            : String(v);
                        return (
                          <td
                            key={c.field}
                            className="max-w-md truncate px-2 py-1 text-parchment/75"
                          >
                            {display}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => onImport(r)}
                          className="rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-xs text-parchment hover:bg-ember/40"
                          title={`Copy this record from ${entry.libraryId} into this module as a new record.`}
                        >
                          + Import
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
