"use client";

/**
 * Modal overlay that opens when the player taps "Shop" inside the
 * NPC dialog. Shows two columns:
 *
 *   Left  — counter stock (one button per item; click to buy)
 *   Right — party inventory (one button per row; click to sell)
 *
 * Header shows the party's current gold. Buy / sell operations
 * mutate the party + stock arrays in place; the host re-renders by
 * tracking a tick counter (the arrays are shared by reference with
 * MapEditor's state, so this works without an explicit notification
 * channel). Transactions are lost on page reload because the
 * editor's simulation is intentionally a sandbox.
 *
 * Item shape comes from items.json — each Item has `buy` and `sell`
 * integer fields. An item with buy=0 cannot be purchased (shown but
 * disabled); an item with sell=0 cannot be sold.
 */

import { useEffect, useState } from "react";
import type { PartyInventoryEntry, SimParty } from "@/sim/types";
import {
  addToInventory,
  consumeOneFromInventory,
} from "@/play/inventoryStacking";

interface ItemRef {
  id: string;
  name?: string;
  buy?: number | null;
  sell?: number | null;
  stackable?: boolean;
  /** Catalog charges — per-use effect, NOT inventory quantity. The
   *  stacking helpers don't read this; just here so the shop's
   *  itemsById map stays a faithful copy of items.json. */
  charges?: number;
}

interface CounterRef {
  id: string;
  name?: string;
  kind?: string;
  items?: string[];
}

export function CounterShopOverlay({
  counter,
  party,
  items,
  onClose,
}: {
  counter: CounterRef;
  /** The party from state — mutated in place when buying / selling so
   *  changes propagate to wherever else the editor reads it from. */
  party: SimParty;
  /** Item catalog, indexed by id below. */
  items: ItemRef[];
  onClose: () => void;
}) {
  // Force a re-render after a transaction. The party + counter arrays
  // are mutated in place, so React doesn't see a state change on its
  // own; bumping this tick is the simplest nudge.
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);

  // ESC closes — same convention as the NPC dialog overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const itemsById = new Map(items.map((i) => [i.id, i]));
  const stock = Array.isArray(counter.items) ? counter.items : [];
  const inventory = Array.isArray(party.inventory) ? party.inventory : [];
  const gold = typeof party.gold === "number" ? party.gold : 0;

  const buyPrice = (id: string): number => {
    const it = itemsById.get(id);
    return typeof it?.buy === "number" ? it.buy : 0;
  };
  const sellPrice = (id: string): number => {
    const it = itemsById.get(id);
    return typeof it?.sell === "number" ? it.sell : 0;
  };
  const itemLabel = (id: string): string => itemsById.get(id)?.name ?? id;

  const handleBuy = (stockIndex: number) => {
    if (stockIndex < 0 || stockIndex >= stock.length) return;
    const itemId = stock[stockIndex];
    const price = buyPrice(itemId);
    if (price <= 0) return;
    if ((party.gold ?? 0) < price) return;
    party.gold = (party.gold ?? 0) - price;
    if (!Array.isArray(party.inventory)) party.inventory = [];
    // Use the shared stacking helper: merges into an existing stack
    // when the catalog flags the item stackable, otherwise pushes a
    // fresh row. One purchase = one physical item, regardless of how
    // the catalog uses its `charges` field (that's per-USE effect).
    party.inventory = addToInventory(
      party.inventory,
      itemId,
      items,
      1,
    ) as PartyInventoryEntry[];
    stock.splice(stockIndex, 1);
    refresh();
  };

  const handleSell = (invIndex: number) => {
    if (!Array.isArray(party.inventory)) return;
    if (invIndex < 0 || invIndex >= party.inventory.length) return;
    const entry = party.inventory[invIndex];
    const price = sellPrice(entry.item);
    if (price <= 0) return;
    // Sell ONE physical item — for stackable rows the stack
    // decrements; non-stackable rows splice in full. The shop's
    // stock receives a matching +1 (one item id pushed back).
    party.inventory = consumeOneFromInventory(
      party.inventory,
      invIndex,
      items,
    ) as PartyInventoryEntry[];
    party.gold = (party.gold ?? 0) + price;
    stock.push(entry.item);
    refresh();
  };

  const kindLabel = counter.kind ?? "shop";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-[48rem] max-w-full flex-col rounded border border-parchment/25 bg-ink/95 shadow-xl">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-parchment/15 px-4 py-3">
          <div>
            <h2 className="font-display text-xl text-parchment">
              {counter.name ?? counter.id}
            </h2>
            <p className="font-mono text-[10px] text-parchment/40">
              {counter.id} · {kindLabel}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded border border-parchment/20 bg-ink/60 px-2 py-1 text-sm text-parchment">
              <span className="text-parchment/55">Gold:</span>{" "}
              <span className="font-medium">{gold}g</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-parchment/20 px-2 py-1 text-xs text-parchment/70 hover:bg-ink/40"
              title="Leave (Esc)"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Two-column body */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-0 overflow-hidden">
          {/* Stock — BUY */}
          <section className="min-h-0 overflow-auto border-r border-parchment/10 px-3 py-3">
            <h3 className="mb-2 text-[11px] uppercase tracking-wide text-parchment/45">
              Stock ({stock.length})
            </h3>
            {stock.length === 0 ? (
              <p className="text-sm italic text-parchment/50">
                Nothing on the shelves right now.
              </p>
            ) : (
              <ul className="space-y-1">
                {stock.map((id, i) => {
                  const price = buyPrice(id);
                  const affordable = price > 0 && gold >= price;
                  const purchasable = price > 0;
                  return (
                    <li key={`${id}-${i}`}>
                      <button
                        type="button"
                        onClick={() => handleBuy(i)}
                        disabled={!affordable}
                        className={`flex w-full items-center justify-between gap-2 rounded border px-3 py-2 text-left text-sm transition ${
                          affordable
                            ? "border-parchment/15 bg-ink/40 text-parchment/85 hover:border-ember/50 hover:bg-ink/60"
                            : "cursor-not-allowed border-parchment/10 bg-ink/30 text-parchment/45"
                        }`}
                        title={
                          purchasable
                            ? affordable
                              ? `Buy ${itemLabel(id)} for ${price}g`
                              : "Not enough gold."
                            : "Not for sale here."
                        }
                      >
                        <span>{itemLabel(id)}</span>
                        <span className="font-mono text-xs">
                          {purchasable ? `${price}g` : "—"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Party inventory — SELL */}
          <section className="min-h-0 overflow-auto px-3 py-3">
            <h3 className="mb-2 text-[11px] uppercase tracking-wide text-parchment/45">
              Party stash ({inventory.length})
            </h3>
            {inventory.length === 0 ? (
              <p className="text-sm italic text-parchment/50">
                The party carries nothing to sell.
              </p>
            ) : (
              <ul className="space-y-1">
                {inventory.map((entry, i) => {
                  const price = sellPrice(entry.item);
                  const sellable = price > 0;
                  return (
                    <li key={`${entry.item}-${i}`}>
                      <button
                        type="button"
                        onClick={() => handleSell(i)}
                        disabled={!sellable}
                        className={`flex w-full items-center justify-between gap-2 rounded border px-3 py-2 text-left text-sm transition ${
                          sellable
                            ? "border-parchment/15 bg-ink/40 text-parchment/85 hover:border-ember/50 hover:bg-ink/60"
                            : "cursor-not-allowed border-parchment/10 bg-ink/30 text-parchment/45"
                        }`}
                        title={
                          sellable
                            ? `Sell ${itemLabel(entry.item)} for ${price}g`
                            : "The shopkeep won't take this."
                        }
                      >
                        <span className="flex items-baseline gap-2">
                          <span>{itemLabel(entry.item)}</span>
                          {typeof entry.charges === "number" ? (
                            <span className="text-[11px] text-parchment/45">
                              × {entry.charges}
                            </span>
                          ) : null}
                        </span>
                        <span className="font-mono text-xs">
                          {sellable ? `${price}g` : "—"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="border-t border-parchment/15 px-4 py-2 text-[11px] text-parchment/40">
          Transactions are live for this simulation session and reset
          when the editor reloads.
        </footer>
      </div>
    </div>
  );
}

// Silence "unused" warnings on the inventory-entry type when this file
// is included by a build that doesn't index the import.
export type { PartyInventoryEntry };
