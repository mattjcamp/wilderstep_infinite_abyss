"use client";

/**
 * LootEditor — the map-editor inspector section for a container's
 * per-placement stash (the map cell's `loot` field).
 *
 * A container is a catalog item flagged `is_chest: true` (Treasure
 * Chest, …) placed in a cell's `item` slot. The catalog record gives
 * its look and an optional default `contents`; THIS editor gives the
 * individual placement its own gold + item list, so one container
 * type can hold a different hoard everywhere it's placed. Clearing
 * the stash falls back to the catalog default.
 */
import { spriteUrl } from "@/data_model/spriteUrl";

import { groupItemsByCategory } from "./itemTags";

export interface LootStash {
  gold?: number;
  items?: ReadonlyArray<{ id: string; qty?: number }>;
}

interface LootItemRef {
  id: string;
  name?: string;
  icon?: string;
  category?: string;
  stackable?: boolean;
  is_chest?: boolean;
  [k: string]: unknown;
}

export function LootEditor({
  loot,
  fallback,
  items,
  onChange,
}: {
  /** The cell's own stash, or null/undefined when it has none. */
  loot: LootStash | null | undefined;
  /** The container type's catalog `contents` — shown when the cell
   *  has no stash of its own, since that's what the party would get. */
  fallback: LootStash | null | undefined;
  items: ReadonlyArray<LootItemRef>;
  /** Next stash, or undefined to clear it (use the catalog default). */
  onChange: (next: LootStash | undefined) => void;
}) {
  const rows = loot?.items ?? [];
  const gold = loot?.gold ?? 0;
  const byId = new Map(items.map((i) => [i.id, i]));
  // Containers can't hold other containers.
  const groups = groupItemsByCategory(items.filter((i) => !i.is_chest));

  const commit = (next: { gold: number; items: Array<{ id: string; qty?: number }> }) => {
    const cleaned = next.items
      .filter((r) => r.id)
      .map((r) => ((r.qty ?? 1) > 1 ? { id: r.id, qty: r.qty } : { id: r.id }));
    const out: LootStash = {};
    if (next.gold > 0) out.gold = next.gold;
    if (cleaned.length > 0) out.items = cleaned;
    onChange(out);
  };
  const setRow = (i: number, patch: { id?: string; qty?: number }) => {
    const next = rows.map((r) => ({ ...r }));
    next[i] = { ...next[i], ...patch };
    commit({ gold, items: next });
  };
  const removeRow = (i: number) =>
    commit({ gold, items: rows.filter((_, j) => j !== i).map((r) => ({ ...r })) });
  const addRow = () => {
    const first = groups[0]?.items[0]?.id ?? "";
    commit({ gold, items: [...rows.map((r) => ({ ...r })), { id: first }] });
  };

  const hasOwn = loot != null;
  const shown = hasOwn ? loot : fallback;
  const fallbackSummary = (() => {
    const parts: string[] = [];
    if (fallback?.gold) parts.push(`${fallback.gold} gold`);
    for (const r of fallback?.items ?? []) {
      const n = byId.get(r.id)?.name ?? r.id;
      parts.push((r.qty ?? 1) > 1 ? `${r.qty}× ${n}` : n);
    }
    return parts.length ? parts.join(", ") : "empty";
  })();

  return (
    <div className="rounded border border-amber-300/30 bg-ink/40 p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-amber-300/90">
          Container loot
        </p>
        {hasOwn ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-xs text-parchment/70 hover:text-parchment"
            title="Remove this placement's stash and use the container type's default contents."
          >
            use default
          </button>
        ) : null}
      </div>

      {!hasOwn ? (
        <p className="mt-1 text-xs text-parchment/65">
          Using the container&apos;s default contents: {fallbackSummary}.
        </p>
      ) : null}

      <label className="mt-2 flex items-center gap-2 text-sm">
        <span className="w-12 text-xs text-parchment/70">Gold</span>
        <input
          type="number"
          min={0}
          value={shown?.gold ?? 0}
          onChange={(e) =>
            commit({
              gold: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              items: (shown?.items ?? []).map((r) => ({ ...r })),
            })
          }
          className="w-24 rounded border border-parchment/20 bg-ink/60 px-1.5 py-0.5 font-mono text-sm"
        />
      </label>

      <ul className="mt-2 space-y-1">
        {(hasOwn ? rows : []).map((r, i) => {
          const def = byId.get(r.id);
          return (
            <li key={i} className="flex items-center gap-1.5">
              {def?.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={spriteUrl(`item/${def.icon}.png`)}
                  alt=""
                  width={18}
                  height={18}
                  style={{ imageRendering: "pixelated" }}
                />
              ) : (
                <span className="inline-block h-[18px] w-[18px]" />
              )}
              <select
                value={r.id}
                onChange={(e) => setRow(i, { id: e.target.value })}
                className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/60 px-1 py-0.5 text-sm"
              >
                {!byId.has(r.id) ? (
                  <option value={r.id}>(missing) {r.id}</option>
                ) : null}
                {groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name ?? it.id}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={r.qty ?? 1}
                title="Quantity"
                onChange={(e) =>
                  setRow(i, {
                    qty: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                  })
                }
                className="w-14 rounded border border-parchment/20 bg-ink/60 px-1 py-0.5 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="px-1 text-parchment/60 hover:text-ember"
                title="Remove"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => {
          if (!hasOwn) {
            // Start this placement's stash from the default so the
            // author edits what the party would currently get.
            const seed = (fallback?.items ?? []).map((r) => ({ ...r }));
            const first = groups[0]?.items[0]?.id ?? "";
            commit({ gold: fallback?.gold ?? 0, items: [...seed, { id: first }] });
          } else {
            addRow();
          }
        }}
        className="mt-2 rounded border border-parchment/25 px-2 py-0.5 text-xs text-parchment/85 hover:bg-ink/60"
      >
        + Add item
      </button>
      <p className="mt-1 text-xs text-parchment/60">
        What the party finds when they open this container. Each placed
        container keeps its own stash.
      </p>
    </div>
  );
}
