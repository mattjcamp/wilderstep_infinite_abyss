"use client";

/**
 * Lore picker — the `lore` field on an Item: makes the item readable
 * (a book, scroll or letter). Lists the module's Lore records (its own
 * file merged over what it inherits, drafts included) and writes the
 * chosen id; "(not readable)" clears it. A value pointing at a missing
 * record stays selectable, marked "(missing)", so it round-trips.
 */

import { useEffect, useState } from "react";
import { mergeModel } from "@/data_model/merge";
import { getEditorModuleSource } from "@/data_model/sourceConfig";

interface LoreRef {
  id: string;
  name?: string;
}

export function LorePicker({
  value,
  moduleId,
  onChange,
  noneLabel = "(not readable)",
  help = "Makes this item readable: using it from the Party screen opens this Lore (the item isn't used up). The first read adds it to the journal and grants its XP.",
}: {
  value: string;
  moduleId?: string;
  onChange: (next: string) => void;
  /** Label for the empty choice. */
  noneLabel?: string;
  /** Help line under the select. */
  help?: string;
}) {
  const [lore, setLore] = useState<LoreRef[] | null>(null);
  useEffect(() => {
    if (!moduleId) {
      setLore([]);
      return;
    }
    let cancelled = false;
    getEditorModuleSource()
      .loadModelLayers(moduleId, "lore")
      .then((layers) => {
        if (cancelled) return;
        const merged = mergeModel("lore", layers.inherited, layers.ownFile) as {
          lore?: LoreRef[];
        } | null;
        setLore((merged?.lore ?? []).filter((l) => l && typeof l.id === "string"));
      })
      .catch(() => {
        if (!cancelled) setLore([]);
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  const known = lore?.some((l) => l.id === value) ?? false;
  return (
    <div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment focus:border-parchment/60 focus:outline-none"
      >
        <option value="">{noneLabel}</option>
        {value && lore && !known ? (
          <option value={value}>(missing) {value}</option>
        ) : null}
        {(lore ?? [])
          .slice()
          .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.name ? `${l.name} — ${l.id}` : l.id}
            </option>
          ))}
      </select>
      <p className="mt-1 text-xs text-parchment/60">{help}</p>
    </div>
  );
}
