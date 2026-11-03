"use client";

/**
 * ChestContentsEditor — the items-catalog form's editor for a
 * container's default `contents` ({ gold?, items?: [{ id, qty? }] }).
 *
 * Replaces the raw JSON textarea with a Gold field plus the same item
 * picker the inventory fields use (sprites, quantity per row, a
 * filterable catalog panel). This is the container TYPE's fallback;
 * individual placements override it with the map tile's `loot`
 * (edited in the map editor's tile inspector).
 */
import { InventoryEditor, type InventoryEntry } from "./InventoryEditor";

export interface ChestContents {
  gold?: number;
  items?: Array<{ id: string; qty?: number }>;
}

/** True when `v` is a contents-shaped object (so the form can fall
 *  back to the raw textarea for anything hand-edited into another
 *  shape rather than silently mangling it). */
export function isChestContents(v: unknown): v is ChestContents {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o.gold !== undefined && typeof o.gold !== "number") return false;
  if (o.items === undefined) return true;
  return (
    Array.isArray(o.items) &&
    o.items.every(
      (r) =>
        r !== null &&
        typeof r === "object" &&
        typeof (r as { id?: unknown }).id === "string",
    )
  );
}

export function ChestContentsEditor({
  value,
  onChange,
  moduleId,
}: {
  value: ChestContents;
  onChange: (next: ChestContents) => void;
  moduleId?: string;
}) {
  const gold = value.gold ?? 0;
  const rows: InventoryEntry[] = (value.items ?? []).map((r) => ({
    item: r.id,
    charges: r.qty ?? 1,
  }));
  const emit = (nextGold: number, nextRows: ReadonlyArray<InventoryEntry>) => {
    const out: ChestContents = {};
    if (nextGold > 0) out.gold = nextGold;
    const items = nextRows.map((r) =>
      (r.charges ?? 1) > 1 ? { id: r.item, qty: r.charges } : { id: r.item },
    );
    if (items.length > 0) out.items = items;
    onChange(out);
  };
  return (
    <div className="flex-1">
      <label className="mb-2 flex items-center gap-2 text-sm">
        <span className="text-parchment/70">Gold</span>
        <input
          type="number"
          min={0}
          step={1}
          value={gold}
          onChange={(e) =>
            emit(Math.max(0, Math.floor(Number(e.target.value) || 0)), rows)
          }
          className="w-24 rounded border border-parchment/20 bg-ink/50 px-2 py-0.5 text-sm text-parchment/90 focus:border-parchment/60 focus:outline-none"
        />
      </label>
      <InventoryEditor
        value={rows}
        moduleId={moduleId}
        onChange={(next) => emit(gold, next)}
        help="Default contents for this container type. Each placed container can hold its own stash instead (map editor → tile → Container loot)."
      />
    </div>
  );
}
