"use client";

/**
 * FX editor — /editor/model?k=fx. Lists every built-in visual effect
 * from the FX catalog (src/vfx/fxCatalog.ts), plays the selected one
 * on a live preview stage, and lets the author tune whatever that
 * effect exposes (colours, size, timing, particle counts). The preview
 * reflects every change immediately.
 *
 * Saved as `fx.json` — overrides only, by FX id:
 *   { "fx": [ { "id": "hellfire", "params": { "core": "#ffffff" } } ] }
 * A param equal to its default isn't stored, and an FX with nothing
 * tuned drops out of the file. Same draft / export / publish flow as
 * the other editors. Battles load the module's fx.json, so a published
 * tweak changes the effect in game.
 */

import { useEffect, useMemo, useState } from "react";
import {
  DraftBanner,
  discardDraftConfirmMessage,
} from "./editorShell";
import {
  discardDraft,
  downloadJson,
  hasDraft,
  loadDraft,
  saveDraft,
} from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import { publishItems } from "@/data_model/publishClient";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import { usePublishServer } from "./usePublishServer";
import { FxPreview } from "./FxPreview";
import {
  FX_DEFS,
  cleanFxParams,
  fxDefaults,
  type FxDef,
  type FxParamDef,
  type FxParams,
} from "@/vfx/fxCatalog";

const MODEL_KEY = "fx";
const FILE_NAME = "fx.json";

interface FxRecord {
  id: string;
  params?: Record<string, unknown>;
}

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      /** Inherited (parent modules) overrides by id. */
      inherited: Map<string, FxParams>;
      /** This module's own records (draft or published). */
      own: FxRecord[];
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
      /** Animations that use each visual, for the "Used by" line. */
      usedBy: Map<string, string[]>;
    }
  | { kind: "error"; message: string };

function recordsOf(file: unknown): FxRecord[] {
  const list = (file as { fx?: unknown } | null)?.fx;
  return Array.isArray(list)
    ? list.filter((r): r is FxRecord => !!r && typeof (r as FxRecord).id === "string")
    : [];
}

/** Built-in uses that don't go through animations.json. */
const BUILT_IN_USES: Record<string, string[]> = {
  hellfire: ["Demon — Hellfire", "Lich — Fireball"],
  breath_of_fire: ["Dragon — Fire Breath"],
  projectile_line: ["Any projectile spell without its own visual"],
};

export function FxBrowse({ moduleId }: { moduleId: string }) {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string>(FX_DEFS[0].id);
  const [playKey, setPlayKey] = useState(0);
  const [loop, setLoop] = useState(true);
  const [publishing, setPublishing] = useState(false);

  const refresh = async () => {
    try {
      const src = getEditorModuleSource();
      const [layers, animLayers] = await Promise.all([
        src.loadModelLayers(moduleId, MODEL_KEY),
        src.loadModelLayers(moduleId, "animations").catch(() => null),
      ]);
      const draft = await loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
      const ownFile = draft ?? (layers.ownFile as Record<string, unknown> | null);
      const inherited = new Map<string, FxParams>();
      for (const r of recordsOf(mergeModel("fx", null, layers.inherited))) {
        const def = FX_DEFS.find((d) => d.id === r.id);
        if (def) inherited.set(r.id, cleanFxParams(def, r.params));
      }
      const usedBy = new Map<string, string[]>();
      const anims = animLayers
        ? ((mergeModel("animations", animLayers.inherited, animLayers.ownFile) as {
            animations?: Array<{ name?: string; id?: string; visual?: string }>;
          } | null)?.animations ?? [])
        : [];
      for (const a of anims) {
        if (!a?.visual) continue;
        const list = usedBy.get(a.visual) ?? [];
        list.push(`Animation: ${a.name ?? a.id}`);
        usedBy.set(a.visual, list);
      }
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

  const def = FX_DEFS.find((d) => d.id === selectedId) ?? FX_DEFS[0];

  /** Effective params for an FX: defaults ⊕ inherited ⊕ own. */
  const effective = (d: FxDef): FxParams => {
    if (state.kind !== "ok") return fxDefaults(d);
    const own = state.own.find((r) => r.id === d.id);
    return {
      ...fxDefaults(d),
      ...(state.inherited.get(d.id) ?? {}),
      ...cleanFxParams(d, own?.params),
    };
  };
  const params = useMemo(
    () => effective(def),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def, state],
  );

  const isTuned = (d: FxDef): boolean => {
    const eff = effective(d);
    const defs = fxDefaults(d);
    return d.params.some((p) => eff[p.key] !== defs[p.key]);
  };

  /** Write one FX's full effective params back, storing only the
   *  values that differ from the defaults. */
  const writeParams = (d: FxDef, next: FxParams) => {
    if (state.kind !== "ok") return;
    const defs = fxDefaults(d);
    const diff: Record<string, unknown> = {};
    for (const p of d.params) {
      if (next[p.key] !== undefined && next[p.key] !== defs[p.key]) diff[p.key] = next[p.key];
    }
    const others = state.own.filter((r) => r.id !== d.id);
    const own = Object.keys(diff).length > 0 ? [...others, { id: d.id, params: diff }] : others;
    // Keep the file in catalog order so diffs stay tidy.
    own.sort(
      (a, b) =>
        FX_DEFS.findIndex((x) => x.id === a.id) - FX_DEFS.findIndex((x) => x.id === b.id),
    );
    const ownFile: Record<string, unknown> = {
      ...(state.ownFile ?? {
        _comment:
          "FX tuning — overrides for the built-in visual effects, by FX id. Only changed params are stored. Edited in the editor's FX page. See docs/data_dictionary/fx.md.",
      }),
      fx: own,
    };
    void saveDraft(moduleId, MODEL_KEY, ownFile);
    setState({ ...state, own, ownFile, isDraft: true });
  };

  const setParam = (key: string, value: string | number) =>
    writeParams(def, { ...params, [key]: value });
  const resetParam = (p: FxParamDef) => {
    const inheritedVal = state.kind === "ok" ? state.inherited.get(def.id)?.[p.key] : undefined;
    writeParams(def, { ...params, [p.key]: inheritedVal ?? p.default });
  };
  const resetAll = () => writeParams(def, { ...fxDefaults(def), ...(state.kind === "ok" ? state.inherited.get(def.id) ?? {} : {}) });

  const onDiscardDraft = () => {
    if (!hasDraft(moduleId, MODEL_KEY)) return;
    if (!window.confirm(discardDraftConfirmMessage(FILE_NAME))) return;
    discardDraft(moduleId, MODEL_KEY);
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

  const uses = [...(BUILT_IN_USES[def.id] ?? []), ...(state.usedBy.get(def.id) ?? [])];

  return (
    <div className="p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-parchment">FX</h1>
          <p className="mt-1 max-w-2xl text-sm text-parchment/70">
            The built-in visual effects. Pick one to watch it play, then tune whatever it
            exposes — the preview updates as you change it. Animations pick which FX a spell
            uses; this page changes how the FX itself looks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.isDraft ? (
            <button
              type="button"
              onClick={onDiscardDraft}
              className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
            >
              Discard
            </button>
          ) : null}
          <button
            type="button"
            onClick={onExport}
            disabled={!state.ownFile}
            className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/90 hover:bg-ink/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* FX list */}
        <ul className="space-y-1">
          {FX_DEFS.map((d) => {
            const active = d.id === def.id;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(d.id);
                    setPlayKey((k) => k + 1);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-sm ${
                    active
                      ? "border-ember/60 bg-ember/15 text-parchment"
                      : "border-parchment/15 bg-ink/30 text-parchment/85 hover:bg-ink/50"
                  }`}
                >
                  <span className="truncate">{d.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {isTuned(d) ? (
                      <span className="h-2 w-2 rounded-full bg-amber-300" title="Tuned in this module" />
                    ) : null}
                    <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                      {d.kind === "projectile" ? "proj" : "burst"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Preview + params */}
        <section className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl text-parchment">
              {def.name} <span className="font-mono text-sm text-parchment/50">{def.id}</span>
            </h2>
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5 text-parchment/80">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                Loop
              </label>
              <button
                type="button"
                onClick={() => setPlayKey((k) => k + 1)}
                className="rounded border border-parchment/30 px-3 py-1 text-parchment/90 hover:bg-ink/40"
              >
                ▶ Replay
              </button>
            </div>
          </div>
          <p className="mt-1 text-sm text-parchment/70">{def.description}</p>
          {uses.length > 0 ? (
            <p className="mt-1 text-xs text-parchment/55">Used by: {uses.join(" · ")}</p>
          ) : null}

          <div className="mt-3">
            <FxPreview def={def} params={params} playKey={playKey} loop={loop} />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-[13px] uppercase tracking-wide text-parchment/75">Settings</h3>
            <button
              type="button"
              onClick={resetAll}
              disabled={!isTuned(def)}
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
                onChange={(v) => setParam(p.key, v)}
                onReset={() => resetParam(p)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
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
