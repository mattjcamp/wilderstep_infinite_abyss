"use client";

/**
 * Inventory editor — structured editor for `{ item, charges }[]` fields
 * (party starting stash, a character's carried items), replacing the
 * raw JSON textarea those fields used to render.
 *
 * Layout, per row:
 *
 *   [sprite] Item Name (id)   × [charges]   ✕
 *
 * plus a "+ Add item…" button that expands the shared filterable
 * catalog panel (the same one IdListPicker / KeyMapEditor use, so the
 * item options + sprite thumbnails come from one loader + cache and
 * respect module inheritance). Items the catalog no longer carries
 * render in warning colour but are PRESERVED — same forward-reference
 * policy as the id-list picker.
 *
 * `charges` is the stack quantity (torch ×10, arrows ×20); it's stored
 * as a positive integer and defaults to 1 for a freshly-added item.
 * Pure controlled component — the parent owns the array value.
 */

import { useMemo, useState } from "react";
import {
  IdOptionPanel,
  useIdOptions,
  type IdListOption,
} from "./IdListPicker";
import type { IdListSource } from "./idListFields";

/** One stash row. `charges` is optional on disk (legacy rows may omit
 *  it); the editor always writes a positive integer. */
export interface InventoryEntry {
  item: string;
  charges?: number;
}

const ITEMS_SOURCE: IdListSource = { kind: "catalog", model: "items" };

export function InventoryEditor({
  value,
  onChange,
  moduleId = "default",
  help,
}: {
  value: ReadonlyArray<InventoryEntry>;
  onChange: (next: InventoryEntry[]) => void;
  moduleId?: string;
  help?: string;
}) {
  const [open, setOpen] = useState(false);
  const state = useIdOptions(moduleId, ITEMS_SOURCE);

  const optionById = useMemo(() => {
    const m = new Map<string, IdListOption>();
    if (state.kind === "ok") for (const o of state.options) m.set(o.id, o);
    return m;
  }, [state]);

  const addItem = (id: string) => {
    onChange([...value, { item: id, charges: 1 }]);
  };
  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };
  const setCharges = (idx: number, raw: string) => {
    const n = Math.max(1, Math.floor(Number(raw)));
    const charges = Number.isFinite(n) ? n : 1;
    onChange(value.map((e, i) => (i === idx ? { ...e, charges } : e)));
  };

  return (
    <div className="flex-1">
      <div className="space-y-1">
        {value.length === 0 ? (
          <p className="text-sm text-parchment/55">(no items)</p>
        ) : null}
        {value.map((entry, idx) => {
          const opt = optionById.get(entry.item);
          const unknown = state.kind === "ok" && !opt;
          const label = opt?.label ?? entry.item;
          return (
            <div key={`${entry.item}-${idx}`} className="flex items-center gap-2">
              {opt?.thumb ? (
                <img
                  src={opt.thumb}
                  alt=""
                  width={22}
                  height={22}
                  style={{ imageRendering: "pixelated" }}
                  className="h-[22px] w-[22px] shrink-0 object-contain"
                />
              ) : (
                <span className="h-[22px] w-[22px] shrink-0" />
              )}
              <span
                className={`min-w-[9rem] flex-1 truncate text-sm ${
                  unknown ? "text-ember/90" : "text-parchment/85"
                }`}
                title={
                  unknown
                    ? `"${entry.item}" isn't a known item — kept as-is.`
                    : entry.item
                }
              >
                {label}
                {label !== entry.item ? (
                  <span className="ml-1 font-mono text-parchment/55">
                    ({entry.item})
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-parchment/55">×</span>
              <input
                type="number"
                min={1}
                step={1}
                value={typeof entry.charges === "number" ? entry.charges : 1}
                onChange={(e) => setCharges(idx, e.target.value)}
                title="Quantity / charges"
                className="w-20 shrink-0 rounded border border-parchment/20 bg-ink/50 px-2 py-0.5 text-sm text-parchment/90 focus:border-parchment/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                title="Remove item"
                className="shrink-0 rounded border border-parchment/20 px-1.5 text-parchment/70 hover:bg-ink/50 hover:text-parchment"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/85 hover:bg-ink/50"
        >
          {open ? "Done" : "+ Add item…"}
        </button>
        {open ? <IdOptionPanel state={state} onPick={addItem} /> : null}
      </div>
      {help ? <p className="mt-1 text-xs text-parchment/60">{help}</p> : null}
    </div>
  );
}
