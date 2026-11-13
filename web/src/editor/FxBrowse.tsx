"use client";

/**
 * FX editor — /editor/model?k=fx. One page for every named effect the
 * game plays: pick an FX to watch it (with its sounds), then edit its
 * name, the built-in visual it draws, that visual's tuning (colours,
 * sizes, timing, particle counts) and its cast / hit sounds.
 *
 * Saved as `fx.json` — module-inheritable, a child module's record
 * replaces its parent's by id:
 *   { "fx": [ { "id": "lightning_strike", "name": "Lightning Strike",
 *               "visual": "lightning_bolt", "params": { "width": 5 },
 *               "cast_sfx": "fireball", "hit_sfx": "explosion" } ] }
 * `params` stores only values that differ from the visual's defaults.
 * Spells / items / effects / abilities / monster abilities point at a
 * record by `fx_id`. Same draft / export / publish flow as the other
 * editors.
 */

import { useEffect, useMemo, useState } from "react";
import { DraftBanner, discardDraftConfirmMessage } from "./editorShell";
import { discardDraft, downloadJson, hasDraft, loadDraft, saveDraft } from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import type { ModelKey } from "@/data_model/models";
import { publishItems } from "@/data_model/publishClient";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import { usePublishServer } from "./usePublishServer";
import { FxPreview } from "./FxPreview";
import { clearFxPickerCache } from "./FxPicker";
import { SFX_NAMES } from "@/battle/audio/Sfx";
import {
  FX_DEFS,
  cleanFxParams,
  fxDefaults,
  fxRecordParams,
  fxVisualDef,
  type FxParamDef,
  type FxParams,
  type FxRecord,
} from "@/vfx/fxCatalog";

const MODEL_KEY = "fx";
const FILE_NAME = "fx.json";
const FILE_COMMENT =
  "FX catalog — every named effect the game can play. Each record picks one built-in visual (`visual`, or 'none' for sound-only), tunes it (`params`, only values that differ from the visual's defaults), and names the sounds played at the start (`cast_sfx`) and on impact (`hit_sfx`). Spells, items, effects, abilities and monster abilities point at a record by `fx_id`. Edited in the editor's FX page. See docs/data_dictionary/fx.md.";

/** Models whose records reference FX, for the "Used by" line. */
const USER_MODELS: Array<{ key: ModelKey; label: string }> = [
  { key: "spells", label: "Spell" },
  { key: "items", label: "Item" },
  { key: "effects", label: "Effect" },
  { key: "abilities", label: "Ability" },
  { key: "monster_abilities", label: "Monster ability" },
];

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      /** Parent modules' merged records, by id. */
      inherited: Map<string, FxRecord>;
      /** This module's own records (draft or published). */
      own: FxRecord[];
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
      /** FX id → "Spell: Lightning Bolt", "Monster ability: Fire Breath", … */
      usedBy: Map<string, string[]>;
    }
  | { kind: "error"; message: string };

function recordsOf(file: unknown): FxRecord[] {
  const list = (file as { fx?: unknown } | null)?.fx;
  return Array.isArray(list)
    ? list.filter((r): r is FxRecord => !!r && typeof (r as FxRecord).id === "string")
    : [];
}

function listOf(file: unknown, key: string): Array<Record<string, unknown>> {
  const list = (file as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "fx";
}

export function FxBrowse({ moduleId }: { moduleId: string }) {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string>("");
  const [playKey, setPlayKey] = useState(0);
  const [loop, setLoop] = useState(false);
  const [sound, setSound] = useState(true);
  const [filter, setFilter] = useState("");
  const [publishing, setPublishing] = useState(false);

  const refresh = async () => {
    try {
      const src = getEditorModuleSource();
      const layers = await src.loadModelLayers(moduleId, MODEL_KEY);
      const draft = await loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
      const ownFile = draft ?? (layers.ownFile as Record<string, unknown> | null);
      const inherited = new Map<string, FxRecord>();
      for (const r of recordsOf(mergeModel(MODEL_KEY, null, layers.inherited))) {
        inherited.set(r.id, r);
      }
      const usedBy = new Map<string, string[]>();
      const add = (id: unknown, label: string) => {
        if (typeof id !== "string" || !id) return;
        const list = usedBy.get(id) ?? [];
        list.push(label);
        usedBy.set(id, list);
      };
      await Promise.all(
        USER_MODELS.map(async ({ key, label }) => {
          try {
            const l = await src.loadModelLayers(moduleId, key);
            const merged = mergeModel(key, l.inherited, l.ownFile);
            for (const rec of listOf(merged, key)) {
              const name = String(rec.name ?? rec.id ?? "?");
              add(rec.fx_id, `${label}: ${name}`);
            }
          } catch {
            /* a model without a file just contributes nothing */
          }
        }),
      );
      setState({
        kind: "ok",
        inherited,
        own: recordsOf(ownFile),
        ownFile,
        isDraft: draft !== null,
        usedBy,
      });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  /** Effective records: inherited, with own records replacing by id. */
  const records = useMemo<FxRecord[]>(() => {
    if (state.kind !== "ok") return [];
    const map = new Map(state.inherited);
    for (const r of state.own) map.set(r.id, r);
    return Array.from(map.values()).sort((a, b) =>
      (a.name ?? a.id).localeCompare(b.name ?? b.id),
    );
  }, [state]);

  const current = records.find((r) => r.id === selectedId) ?? records[0] ?? null;
  const def = fxVisualDef(current);
  const params = useMemo<FxParams>(
    () => (current ? fxRecordParams(current) : {}),
    [current],
  );

  const ownIds = new Set(state.kind === "ok" ? state.own.map((r) => r.id) : []);
  const isOwn = (id: string) => ownIds.has(id);
  const isInherited = (id: string) => state.kind === "ok" && state.inherited.has(id);

  // ── Writing ──────────────────────────────────────────────────────
  const writeOwn = (own: FxRecord[]) => {
    if (state.kind !== "ok") return;
    const ownFile: Record<string, unknown> = {
      ...(state.ownFile ?? { _comment: FILE_COMMENT }),
      fx: own,
    };
    void saveDraft(moduleId, MODEL_KEY, ownFile);
    clearFxPickerCache();
    setState({ ...state, own, ownFile, isDraft: true });
  };

  /** Replace (or add) one record in this module's own file. */
  const putRecord = (rec: FxRecord, replaceId = rec.id) => {
    if (state.kind !== "ok") return;
    const i = state.own.findIndex((r) => r.id === replaceId);
    const own = [...state.own];
    if (i >= 0) own[i] = rec;
    else own.push(rec);
    writeOwn(own);
  };

  const update = (patch: Partial<FxRecord>) => {
    if (!current) return;
    putRecord({ ...current, ...patch });
    setPlayKey((k) => k + 1);
  };

  /** Store only the params that differ from the visual's defaults. */
  const writeParams = (next: FxParams) => {
    if (!current || !def) return;
    const defs = fxDefaults(def);
    const diff: Record<string, unknown> = {};
    for (const p of def.params) {
      if (next[p.key] !== undefined && next[p.key] !== defs[p.key]) diff[p.key] = next[p.key];
    }
    putRecord({ ...current, params: diff });
  };

  const uniqueId = (base: string) => {
    let id = slug(base);
    const taken = new Set(records.map((r) => r.id));
    for (let n = 2; taken.has(id); n++) id = `${slug(base)}_${n}`;
    return id;
  };

  const onNew = () => {
    const name = window.prompt("Name for the new FX:", "New FX");
    if (!name) return;
    const rec: FxRecord = {
      id: uniqueId(name),
      name,
      description: "",
      visual: "projectile_line",
      params: {},
      cast_sfx: "",
      hit_sfx: "",
    };
    putRecord(rec);
    setSelectedId(rec.id);
    setPlayKey((k) => k + 1);
  };

  const onDuplicate = () => {
    if (!current) return;
    const name = window.prompt("Name for the copy:", `${current.name ?? current.id} copy`);
    if (!name) return;
    const rec: FxRecord = { ...current, id: uniqueId(name), name, params: { ...(current.params ?? {}) } };
    putRecord(rec);
    setSelectedId(rec.id);
  };

  const onDelete = () => {
    if (!current || state.kind !== "ok" || !isOwn(current.id)) return;
    const reverts = isInherited(current.id);
    const uses = state.usedBy.get(current.id)?.length ?? 0;
    const msg = reverts
      ? `Revert "${current.name ?? current.id}" to the parent module's version?`
      : `Delete "${current.name ?? current.id}"?${uses ? ` ${uses} record(s) still use it and will play nothing.` : ""}`;
    if (!window.confirm(msg)) return;
    writeOwn(state.own.filter((r) => r.id !== current.id));
  };

  const onDiscardDraft = () => {
    if (!hasDraft(moduleId, MODEL_KEY)) return;
    if (!window.confirm(discardDraftConfirmMessage(FILE_NAME))) return;
    discardDraft(moduleId, MODEL_KEY);
    clearFxPickerCache();
    void refresh();
  };
  const onExport = () => {
    if (state.kind !== "ok" || !state.ownFile) return;
    downloadJson(FILE_NAME, state.ownFile);
  };
  const onPublish = async () => {
    if (state.kind !== "ok" || !state.ownFile) return;
    setPublishing(true);
    try {
      const res = await publishItems([
        { kind: "model", moduleId, modelKey: MODEL_KEY, fileName: FILE_NAME, content: state.ownFile },
      ]);
      const r = res.results[0];
      if (!r.ok) {
        window.alert(`Publish failed: ${r.error}`);
        return;
      }
      discardDraft(moduleId, MODEL_KEY);
      clearFxPickerCache();
      await refresh();
    } catch (e) {
      window.alert(`Publish error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPublishing(false);
    }
  };

  if (state.kind === "loading") return <p className="p-4 text-parchment/80">Loading FX…</p>;
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load FX.</p>
        <p className="mt-2 font-mono text-sm text-parchment/80">{state.message}</p>
      </div>
    );
  }

  const shown = records.filter((r) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return `${r.name ?? ""} ${r.id} ${r.visual ?? ""}`.toLowerCase().includes(q);
  });
  const uses = current ? state.usedBy.get(current.id) ?? [] : [];
  const btn =
    "rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/90 hover:bg-ink/40 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-parchment">FX</h1>
          <p className="mt-1 max-w-2xl text-sm text-parchment/70">
            Every named effect: the visual it draws, how that visual is tuned, and the sounds
            that go with it. Spells, items, effects, abilities and monster abilities pick an FX
            from a dropdown — change it here and it changes everywhere it&apos;s used.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.isDraft ? (
            <button type="button" onClick={onDiscardDraft} className={btn}>
              Discard
            </button>
          ) : null}
          <button type="button" onClick={onExport} disabled={!state.ownFile} className={btn}>
            ⬇ Export
          </button>
          {state.isDraft && publishAvailable === true ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={publishing}
              className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50 disabled:opacity-40"
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          ) : null}
        </div>
      </header>
      {state.isDraft ? <DraftBanner /> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* FX list */}
        <div>
          <div className="mb-2 flex gap-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment"
            />
            <button type="button" onClick={onNew} className={btn} title="Create a new FX">
              + New
            </button>
          </div>
          <ul className="max-h-[70vh] space-y-1 overflow-auto pr-1">
            {shown.map((r) => {
              const active = current?.id === r.id;
              const vis = fxVisualDef(r);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(r.id);
                      setPlayKey((k) => k + 1);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-sm ${
                      active
                        ? "border-ember/60 bg-ember/15 text-parchment"
                        : "border-parchment/15 bg-ink/30 text-parchment/85 hover:bg-ink/50"
                    }`}
                  >
                    <span className="truncate">{r.name ?? r.id}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {isOwn(r.id) && isInherited(r.id) ? (
                        <span className="h-2 w-2 rounded-full bg-amber-300" title="Changed in this module" />
                      ) : null}
                      <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                        {vis ? (vis.kind === "projectile" ? "proj" : "burst") : "sound"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Selected FX */}
        {current ? (
          <section className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl text-parchment">
                {current.name ?? current.id}{" "}
                <span className="font-mono text-sm text-parchment/50">{current.id}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5 text-parchment/80">
                  <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
                  Sound
                </label>
                <label className="flex items-center gap-1.5 text-parchment/80">
                  <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                  Loop
                </label>
                <button type="button" onClick={() => setPlayKey((k) => k + 1)} className={btn}>
                  ▶ Play
                </button>
                <button type="button" onClick={onDuplicate} className={btn}>
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={!isOwn(current.id)}
                  className={btn}
                  title={isOwn(current.id) ? "" : "Inherited from a parent module"}
                >
                  {isInherited(current.id) ? "Revert" : "Delete"}
                </button>
              </div>
            </div>
            {uses.length > 0 ? (
              <p className="mt-1 text-xs text-parchment/55">Used by: {uses.join(" · ")}</p>
            ) : (
              <p className="mt-1 text-xs text-parchment/45">Not used by any record yet.</p>
            )}

            <div className="mt-3">
              <FxPreview
                def={def}
                params={params}
                playKey={playKey}
                loop={loop}
                sound={sound}
                castSfx={current.cast_sfx ?? ""}
                hitSfx={current.hit_sfx ?? ""}
              />
            </div>

            {/* Identity + sounds */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <TextRow label="Name" value={current.name ?? ""} onChange={(v) => update({ name: v })} />
              <SelectRow
                label="Visual"
                value={(current.visual ?? current.id) || "none"}
                options={[
                  { value: "none", label: "None (sound only)" },
                  ...FX_DEFS.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` })),
                ]}
                help={def?.description}
                onChange={(v) => update({ visual: v, params: {} })}
              />
              <SelectRow
                label="Cast sound"
                value={current.cast_sfx ?? ""}
                options={[{ value: "", label: "(silent)" }, ...SFX_NAMES.map((n) => ({ value: n, label: n }))]}
                onChange={(v) => update({ cast_sfx: v })}
              />
              <SelectRow
                label="Hit sound"
                value={current.hit_sfx ?? ""}
                options={[{ value: "", label: "(silent)" }, ...SFX_NAMES.map((n) => ({ value: n, label: n }))]}
                onChange={(v) => update({ hit_sfx: v })}
              />
              <div className="sm:col-span-2">
                <TextRow
                  label="Description"
                  value={current.description ?? ""}
                  multiline
                  onChange={(v) => putRecord({ ...current, description: v })}
                />
              </div>
            </div>

            {def ? (
              <>
                <div className="mt-4 flex items-center justify-between">
                  <h3 className="text-[13px] uppercase tracking-wide text-parchment/75">
                    Visual settings
                  </h3>
                  <button
                    type="button"
                    onClick={() => writeParams(fxDefaults(def))}
                    disabled={Object.keys(cleanFxParams(def, current.params)).length === 0}
                    className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/80 hover:bg-ink/40 disabled:opacity-40"
                  >
                    Reset all to default
                  </button>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {def.params.map((p) => (
                    <ParamRow
                      key={p.key}
                      p={p}
                      value={params[p.key]}
                      changed={params[p.key] !== p.default}
                      onChange={(v) => writeParams({ ...params, [p.key]: v })}
                      onReset={() => writeParams({ ...params, [p.key]: p.default })}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ) : (
          <p className="text-parchment/70">No FX yet — click + New.</p>
        )}
      </div>
    </div>
  );
}

function TextRow({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  const cls =
    "mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90";
  return (
    <label className="block rounded border border-parchment/15 bg-ink/30 px-3 py-2">
      <span className="text-sm text-parchment/85">{label}</span>
      {multiline ? (
        <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
  help,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  help?: string;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <label className="block rounded border border-parchment/15 bg-ink/30 px-3 py-2">
      <span className="text-sm text-parchment/85">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
      >
        {known ? null : <option value={value}>{value} ⚠ unknown</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help ? <p className="mt-1 text-xs text-parchment/55">{help}</p> : null}
    </label>
  );
}

function ParamRow({
  p,
  value,
  changed,
  onChange,
  onReset,
}: {
  p: FxParamDef;
  value: string | number | undefined;
  changed: boolean;
  onChange: (v: string | number) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded border border-parchment/15 bg-ink/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-parchment/85">
          {p.label}
          {changed ? <span className="ml-1.5 text-xs text-amber-300">• changed</span> : null}
        </span>
        {changed ? (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-parchment/60 hover:text-parchment"
            title={`Back to ${String(p.default)}`}
          >
            reset
          </button>
        ) : null}
      </div>
      {p.type === "color" ? (
        <div className="mt-1 flex items-center gap-2">
          <input
            type="color"
            value={typeof value === "string" ? value : p.default}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-12 cursor-pointer rounded border border-parchment/20 bg-transparent"
          />
          <span className="font-mono text-xs text-parchment/60">
            {typeof value === "string" ? value : p.default}
          </span>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={typeof value === "number" ? value : p.default}
            onChange={(e) => onChange(Number(e.target.value))}
            className="min-w-0 flex-1 accent-ember"
          />
          <input
            type="number"
            min={p.min}
            max={p.max}
            step={p.step}
            value={typeof value === "number" ? value : p.default}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.min(p.max, Math.max(p.min, n)));
            }}
            className="w-20 rounded border border-parchment/20 bg-ink/50 px-1.5 py-0.5 text-right text-sm text-parchment/90"
          />
          {p.unit ? <span className="w-5 text-xs text-parchment/55">{p.unit}</span> : null}
        </div>
      )}
      {p.help ? <p className="mt-1 text-xs text-parchment/55">{p.help}</p> : null}
    </div>
  );
}
