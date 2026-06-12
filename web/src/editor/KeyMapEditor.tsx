"use client";

/**
 * Key-map editor — structured editor for flat `{ key: value }`
 * record fields (recipe reagents, stat modifiers, equipment slots),
 * replacing their raw JSON textareas. P1.2 of the usability audit.
 *
 * Two layouts driven by config (keyMapFields.ts):
 *
 *   fixedRows — one row per key option, always visible. Stat blocks
 *   and equipment loadouts: every stat / slot is a row, no
 *   add/remove ceremony.
 *
 *   dynamic — rows only for keys present in the value, with ✕ to
 *   remove and "+ Add…" opening the shared IdOptionPanel to pick a
 *   new key (reagents: filterable item list with icons).
 *
 * Two value kinds: number (count / modifier input) and id (pick a
 * catalog record via the same panel — e.g. the item in a slot).
 *
 * Unknown keys (not in the option source) are PRESERVED and shown in
 * warning colour — same forward-reference policy as every picker.
 * Pure controlled component; the parent owns the object value.
 */

import { useMemo, useState } from "react";
import {
  IdOptionPanel,
  useIdOptions,
  type IdListOption,
} from "./IdListPicker";
import type { KeyMapFieldConfig } from "./keyMapFields";

type MapValue = string | number;

function clampNumber(
  raw: string,
  cfg: { integer?: boolean; min?: number },
): number {
  let n = Number(raw);
  if (!Number.isFinite(n)) n = cfg.min ?? 0;
  if (cfg.integer !== false) n = Math.trunc(n);
  if (cfg.min !== undefined && n < cfg.min) n = cfg.min;
  return n;
}

export function KeyMapEditor({
  value,
  onChange,
  config,
  moduleId = "default",
}: {
  /** The current map. Insertion order is preserved on edit. */
  value: Readonly<Record<string, MapValue>>;
  onChange: (next: Record<string, MapValue>) => void;
  config: KeyMapFieldConfig;
  moduleId?: string;
}) {
  const keyOptions = useIdOptions(moduleId, config.keys);
  // Value-id options load unconditionally (hooks can't be
  // conditional); for number-valued maps this is a cheap static
  // lookup that never fetches.
  const valueOptions = useIdOptions(
    moduleId,
    config.value.kind === "id"
      ? config.value.source
      : { kind: "static", options: [] },
  );
  /** Which row's picker panel is open: "add" for the new-key panel,
   *  otherwise the key whose id-value is being picked. */
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  const keyById = useMemo(() => {
    const m = new Map<string, IdListOption>();
    if (keyOptions.kind === "ok") {
      for (const o of keyOptions.options) m.set(o.id, o);
    }
    return m;
  }, [keyOptions]);
  const valueById = useMemo(() => {
    const m = new Map<string, IdListOption>();
    if (valueOptions.kind === "ok") {
      for (const o of valueOptions.options) m.set(o.id, o);
    }
    return m;
  }, [valueOptions]);

  const setEntry = (key: string, v: MapValue) => {
    onChange({ ...value, [key]: v });
  };
  const removeEntry = (key: string) => {
    const { [key]: _drop, ...rest } = value;
    onChange(rest);
  };

  // Row keys: fixedRows renders every key option (plus any unknown
  // keys the record carries, so nothing silently disappears);
  // dynamic renders the record's own keys in order.
  const rowKeys: string[] = config.fixedRows
    ? [
        ...(keyOptions.kind === "ok"
          ? keyOptions.options.map((o) => o.id)
          : Object.keys(value)),
        ...Object.keys(value).filter(
          (k) =>
            keyOptions.kind === "ok" &&
            !keyOptions.options.some((o) => o.id === k),
        ),
      ]
    : Object.keys(value);

  const numberCfg =
    config.value.kind === "number" ? config.value : { kind: "number" as const };

  return (
    <div className="flex-1">
      <div className="space-y-1">
        {rowKeys.length === 0 ? (
          <p className="text-sm text-parchment/55">(empty)</p>
        ) : null}
        {rowKeys.map((key) => {
          const keyOpt = keyById.get(key);
          const unknownKey = keyOptions.kind === "ok" && !keyOpt;
          const present = key in value;
          const current = value[key];
          return (
            <div key={key}>
              <div className="flex items-center gap-2">
                {/* Key label (+ thumbnail for catalog keys). */}
                {keyOpt?.thumb ? (
                  <img
                    src={keyOpt.thumb}
                    alt=""
                    width={20}
                    height={20}
                    style={{ imageRendering: "pixelated" }}
                    className="h-5 w-5 shrink-0 object-contain"
                  />
                ) : null}
                <span
                  className={`min-w-[7rem] text-sm ${
                    unknownKey
                      ? "text-ember/90"
                      : "text-parchment/85"
                  }`}
                  title={
                    unknownKey
                      ? `"${key}" isn't a known key — kept as-is.`
                      : key
                  }
                >
                  {keyOpt?.label ?? key}
                </span>

                {config.value.kind === "number" ? (
                  <input
                    type="number"
                    value={present ? Number(current) : 0}
                    min={numberCfg.min}
                    step={1}
                    onChange={(e) =>
                      setEntry(key, clampNumber(e.target.value, numberCfg))
                    }
                    className="w-20 rounded border border-parchment/20 bg-ink/50 px-2 py-0.5 text-sm text-parchment/90 focus:border-parchment/60 focus:outline-none"
                  />
                ) : (
                  <ValueIdCell
                    current={present ? String(current) : ""}
                    option={
                      present ? valueById.get(String(current)) : undefined
                    }
                    resolved={valueOptions.kind === "ok"}
                    pickerOpen={openPanel === key}
                    onTogglePicker={() =>
                      setOpenPanel((p) => (p === key ? null : key))
                    }
                    onClear={() => removeEntry(key)}
                  />
                )}

                {!config.fixedRows ? (
                  <button
                    type="button"
                    onClick={() => removeEntry(key)}
                    title="Remove this entry."
                    className="rounded border border-parchment/20 px-1.5 py-0.5 text-xs text-parchment/75 hover:bg-ink/60"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              {/* Per-row id-value picker panel. */}
              {config.value.kind === "id" && openPanel === key ? (
                <IdOptionPanel
                  state={valueOptions}
                  onPick={(id) => {
                    setEntry(key, id);
                    setOpenPanel(null);
                  }}
                  rowBadge={(o) =>
                    present && String(current) === o.id ? "current" : null
                  }
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Dynamic mode: add a new key from the option source. */}
      {!config.fixedRows ? (
        <>
          <button
            type="button"
            onClick={() => setOpenPanel((p) => (p === "add" ? null : "add"))}
            className="mt-1.5 rounded border border-parchment/30 px-2 py-0.5 text-xs text-parchment/85 hover:bg-ink/40"
          >
            {openPanel === "add" ? "Done" : "+ Add…"}
          </button>
          {openPanel === "add" ? (
            <IdOptionPanel
              state={keyOptions}
              onPick={(id) => {
                if (!(id in value)) {
                  setEntry(
                    id,
                    config.value.kind === "number"
                      ? Math.max(1, numberCfg.min ?? 1)
                      : "",
                  );
                }
              }}
              rowDisabled={(o) => o.id in value}
              rowBadge={(o) => (o.id in value ? "added" : null)}
              rowTitle={(o) =>
                o.id in value ? "Already in the map." : "Add a row."
              }
            />
          ) : null}
        </>
      ) : null}
      {config.help ? (
        <p className="mt-1 text-xs text-parchment/60">{config.help}</p>
      ) : null}
    </div>
  );
}

/** The id-valued cell: current pick as a chip (thumb + label) with
 *  Pick… / clear controls. */
function ValueIdCell({
  current,
  option,
  resolved,
  pickerOpen,
  onTogglePicker,
  onClear,
}: {
  current: string;
  option: IdListOption | undefined;
  /** True when options finished loading (drives unknown-id styling). */
  resolved: boolean;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onClear: () => void;
}) {
  const unknown = current !== "" && resolved && !option;
  return (
    <div className="flex flex-1 items-center gap-1.5">
      {current === "" ? (
        <span className="text-sm text-parchment/50">(empty)</span>
      ) : (
        <span
          className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[13px] ${
            unknown
              ? "border-ember/50 bg-ember/10 text-ember/90"
              : "border-parchment/25 bg-ink/40 text-parchment/90"
          }`}
          title={
            unknown ? `"${current}" isn't in the catalog — kept as-is.` : current
          }
        >
          {option?.thumb ? (
            <img
              src={option.thumb}
              alt=""
              width={18}
              height={18}
              style={{ imageRendering: "pixelated" }}
              className="h-[18px] w-[18px] shrink-0 object-contain"
            />
          ) : null}
          {option?.label ?? current}
        </span>
      )}
      <button
        type="button"
        onClick={onTogglePicker}
        className="rounded border border-parchment/30 px-2 py-0.5 text-xs text-parchment/85 hover:bg-ink/40"
      >
        {pickerOpen ? "Done" : "Pick…"}
      </button>
      {current !== "" ? (
        <button
          type="button"
          onClick={onClear}
          title="Clear this slot."
          className="rounded border border-parchment/20 px-1.5 py-0.5 text-xs text-parchment/75 hover:bg-ink/60"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
