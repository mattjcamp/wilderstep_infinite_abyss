"use client";

/**
 * Params editor — structured editor for per-record knob bags
 * (`effects.params`, `abilities.params`, `traps.params`,
 * `spells.action_params`), replacing their raw JSON textareas. P2 of
 * the usability audit.
 *
 * Each key present in the value renders a typed row driven by the
 * model's vocabulary (paramsFields.ts): number inputs, enum selects,
 * catalog id pickers, id-list pickers, a map-cell block for teleport
 * destinations, and an inline JSON cell for declared-complex values.
 * Keys the vocabulary doesn't know render as JSON rows too — marked
 * "custom" — so data ahead of the vocabulary stays editable.
 *
 * "+ Add…" lists the vocabulary keys not yet present (with their
 * help text); "Custom key" is the escape hatch for brand-new knobs.
 *
 * Pure controlled component; parent owns the object value.
 */

import { useEffect, useMemo, useState } from "react";
import {
  IdListPicker,
  IdOptionPanel,
  useIdOptions,
} from "./IdListPicker";
import {
  defaultValueForSpec,
  type ParamSpec,
  type ParamsFieldConfig,
} from "./paramsFields";

const inputClasses =
  "rounded border border-parchment/20 bg-ink/50 px-2 py-0.5 text-sm text-parchment/90 focus:border-parchment/60 focus:outline-none";

export function ParamsEditor({
  value,
  onChange,
  config,
  moduleId = "default",
}: {
  value: Readonly<Record<string, unknown>>;
  onChange: (next: Record<string, unknown>) => void;
  config: ParamsFieldConfig;
  moduleId?: string;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [customKey, setCustomKey] = useState("");

  const setEntry = (key: string, v: unknown) => {
    onChange({ ...value, [key]: v });
  };
  const removeEntry = (key: string) => {
    const { [key]: _drop, ...rest } = value;
    onChange(rest);
  };

  const presentKeys = Object.keys(value);
  const addableKeys = Object.keys(config.specs).filter(
    (k) => !(k in value),
  );

  return (
    <div className="flex-1">
      <div className="space-y-1.5">
        {presentKeys.length === 0 ? (
          <p className="text-sm text-parchment/55">
            (no parameters — defaults apply)
          </p>
        ) : null}
        {presentKeys.map((key) => {
          const spec = config.specs[key];
          return (
            <div key={key} className="flex items-start gap-2">
              <span
                className="min-w-[10rem] shrink-0 pt-1 font-mono text-[13px] text-parchment/85"
                title={spec?.help ?? "Custom key — not in this model's vocabulary."}
              >
                {key}
                {!spec ? (
                  <span className="ml-1.5 rounded bg-parchment/10 px-1 py-0.5 text-[9px] uppercase tracking-wide text-parchment/65">
                    custom
                  </span>
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                <ParamValueCell
                  spec={spec ?? { kind: "json" }}
                  value={value[key]}
                  moduleId={moduleId}
                  onChange={(v) => setEntry(key, v)}
                />
                {spec?.help ? (
                  <p className="mt-0.5 text-xs text-parchment/55">
                    {spec.help}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => removeEntry(key)}
                title="Remove this parameter (the engine default applies)."
                className="mt-0.5 rounded border border-parchment/20 px-1.5 py-0.5 text-xs text-parchment/75 hover:bg-ink/60"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setAddOpen((o) => !o)}
        className="mt-1.5 rounded border border-parchment/30 px-2 py-0.5 text-xs text-parchment/85 hover:bg-ink/40"
      >
        {addOpen ? "Done" : "+ Add…"}
      </button>
      {addOpen ? (
        <div className="mt-1.5 rounded border border-parchment/15 bg-ink/40 p-1.5">
          <ul className="max-h-48 space-y-0.5 overflow-auto pr-1">
            {addableKeys.map((key) => {
              const spec = config.specs[key];
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setEntry(key, defaultValueForSpec(spec))}
                    className="flex w-full items-baseline gap-2 rounded border border-parchment/10 bg-ink/40 px-2 py-1 text-left transition hover:border-parchment/40 hover:bg-ink/60"
                  >
                    <span className="shrink-0 font-mono text-[13px] text-parchment/90">
                      {key}
                    </span>
                    {spec.help ? (
                      <span className="min-w-0 flex-1 truncate text-xs text-parchment/55">
                        {spec.help}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {addableKeys.length === 0 ? (
              <li className="px-1 py-1 text-xs text-parchment/55">
                Every known parameter is already set.
              </li>
            ) : null}
          </ul>
          <div className="mt-1.5 flex items-center gap-2 border-t border-parchment/10 pt-1.5">
            <input
              type="text"
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              placeholder="custom_key"
              className={`${inputClasses} flex-1 font-mono text-[13px]`}
            />
            <button
              type="button"
              disabled={!customKey.trim() || customKey.trim() in value}
              onClick={() => {
                const k = customKey.trim();
                if (!k || k in value) return;
                setEntry(k, null);
                setCustomKey("");
              }}
              className="rounded border border-parchment/30 px-2 py-0.5 text-xs text-parchment/85 enabled:hover:bg-ink/40 disabled:opacity-40"
            >
              Add custom key
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One typed value control. */
function ParamValueCell({
  spec,
  value,
  moduleId,
  onChange,
}: {
  spec: ParamSpec;
  value: unknown;
  moduleId: string;
  onChange: (v: unknown) => void;
}) {
  switch (spec.kind) {
    case "number": {
      const integer = spec.integer !== false;
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : 0}
          min={spec.min}
          step={integer ? 1 : "any"}
          onChange={(e) => {
            let n = Number(e.target.value);
            if (!Number.isFinite(n)) n = spec.min ?? 0;
            if (integer) n = Math.trunc(n);
            if (spec.min !== undefined && n < spec.min) n = spec.min;
            onChange(n);
          }}
          className={`${inputClasses} w-24`}
        />
      );
    }
    case "string":
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClasses} w-full`}
        />
      );
    case "enum":
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClasses} w-full font-mono text-[13px]`}
        >
          {typeof value === "string" &&
          value !== "" &&
          !spec.options.includes(value) ? (
            <option value={value}>(unknown) {value}</option>
          ) : null}
          {value === "" || value == null ? (
            <option value="">— choose —</option>
          ) : null}
          {spec.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "id":
      return (
        <IdValueCell
          current={typeof value === "string" ? value : ""}
          source={spec.source}
          moduleId={moduleId}
          onChange={onChange}
        />
      );
    case "id_list":
      return (
        <IdListPicker
          value={
            Array.isArray(value)
              ? value.filter((v): v is string => typeof v === "string")
              : []
          }
          source={spec.source}
          moduleId={moduleId}
          onChange={onChange}
        />
      );
    case "map_cell":
      return (
        <MapCellValue value={value} moduleId={moduleId} onChange={onChange} />
      );
    case "json":
      return <JsonValueCell value={value} onChange={onChange} />;
  }
}

/** Single catalog id: chip + Pick… panel (shared option machinery). */
function IdValueCell({
  current,
  source,
  moduleId,
  onChange,
}: {
  current: string;
  source: Extract<ParamSpec, { kind: "id" }>["source"];
  moduleId: string;
  onChange: (v: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useIdOptions(moduleId, source);
  const opt =
    options.kind === "ok"
      ? options.options.find((o) => o.id === current)
      : undefined;
  const unknown = current !== "" && options.kind === "ok" && !opt;
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {current === "" ? (
          <span className="text-sm text-parchment/50">(none)</span>
        ) : (
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[13px] ${
              unknown
                ? "border-ember/50 bg-ember/10 text-ember/90"
                : "border-parchment/25 bg-ink/40 text-parchment/90"
            }`}
            title={unknown ? `"${current}" isn't in the catalog.` : current}
          >
            {opt?.thumb ? (
              <img
                src={opt.thumb}
                alt=""
                width={18}
                height={18}
                style={{ imageRendering: "pixelated" }}
                className="h-[18px] w-[18px] shrink-0 object-contain"
              />
            ) : null}
            {opt?.label ?? current}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-parchment/30 px-2 py-0.5 text-xs text-parchment/85 hover:bg-ink/40"
        >
          {open ? "Done" : "Pick…"}
        </button>
      </div>
      {open ? (
        <IdOptionPanel
          state={options}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
          rowBadge={(o) => (o.id === current ? "current" : null)}
        />
      ) : null}
    </div>
  );
}

/** Teleport-style `{ map_id, col, row }` block. */
function MapCellValue({
  value,
  moduleId,
  onChange,
}: {
  value: unknown;
  moduleId: string;
  onChange: (v: unknown) => void;
}) {
  const cell =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { map_id?: unknown; col?: unknown; row?: unknown })
      : {};
  const mapId = typeof cell.map_id === "string" ? cell.map_id : "";
  const col = typeof cell.col === "number" ? cell.col : 0;
  const row = typeof cell.row === "number" ? cell.row : 0;
  const patch = (p: Partial<{ map_id: string; col: number; row: number }>) =>
    onChange({ map_id: mapId, col, row, ...p });
  return (
    <div className="space-y-1">
      <IdValueCell
        current={mapId}
        source={{ kind: "catalog", model: "maps" }}
        moduleId={moduleId}
        onChange={(v) => patch({ map_id: typeof v === "string" ? v : "" })}
      />
      <div className="flex gap-2">
        <label className="flex items-center gap-1 text-xs text-parchment/65">
          col
          <input
            type="number"
            value={col}
            onChange={(e) => patch({ col: Number(e.target.value) || 0 })}
            className={`${inputClasses} w-20`}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-parchment/65">
          row
          <input
            type="number"
            value={row}
            onChange={(e) => patch({ row: Number(e.target.value) || 0 })}
            className={`${inputClasses} w-20`}
          />
        </label>
      </div>
    </div>
  );
}

/** Inline JSON cell for custom / declared-complex values. Local
 *  draft commits on every parseable edit; unparseable text shows an
 *  inline error and leaves the committed value untouched. */
function JsonValueCell({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const committed = useMemo(() => JSON.stringify(value) ?? "null", [value]);
  const [draft, setDraft] = useState(committed);
  const [error, setError] = useState(false);
  // Re-sync when the committed value changes from OUTSIDE. While the
  // author is typing, every parseable keystroke commits — without
  // the equivalence guard the normalised stringify would overwrite
  // the draft mid-edit (cursor jumps, formatting fights).
  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(draft || "null")) === committed) return;
    } catch {
      // Draft currently unparseable — an external change wins.
    }
    setDraft(committed);
    setError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed]);
  return (
    <div>
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          try {
            onChange(raw.trim() === "" ? null : JSON.parse(raw));
            setError(false);
          } catch {
            setError(true);
          }
        }}
        className={`${inputClasses} w-full font-mono text-[13px] ${
          error ? "border-ember" : ""
        }`}
      />
      {error ? (
        <p className="mt-0.5 text-xs text-ember/85">
          Not valid JSON — last valid value kept.
        </p>
      ) : null}
    </div>
  );
}
