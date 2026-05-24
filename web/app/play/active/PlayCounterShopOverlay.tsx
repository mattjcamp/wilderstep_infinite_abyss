"use client";

/**
 * Play-time counter shop overlay. Opens when the party walks into a
 * tile with a `counter` field, or an NPC whose `counter` field
 * resolves in the counters catalog.
 *
 * Buy/sell mutates `liveSave.party.gold` and `liveSave.party.inventory`
 * via the same stacking helpers PlayPartyScreenOverlay uses; changes
 * commit upstream through `onMutateSave`. The counter's stock array
 * is a local snapshot — selling pushes ids back so the player can
 * re-buy what they just sold, but those edits don't persist across
 * sessions (matches v1 — restocking happens on the next visit).
 *
 * Escape, the backdrop, or the Close button dismisses.
 */

import { useCallback, useEffect, useState } from "react";
import type { WorldSave } from "@/play/saveTypes";
import {
  addToInventory,
  consumeOneFromInventory,
} from "@/play/inventoryStacking";

interface ShopItemRef {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  buy?: number | null;
  sell?: number | null;
  stackable?: boolean;
  charges?: number;
}

interface ServiceRef {
  id: string;
  name?: string;
  description?: string;
  cost?: number;
}

interface CounterRef {
  id: string;
  name?: string;
  description?: string;
  kind?: string;
  items?: string[];
  services?: ServiceRef[];
}

export function PlayCounterShopOverlay({
  counter,
  save,
  items,
  maxHpById,
  maxMpById,
  onMutateSave,
  onClose,
}: {
  counter: CounterRef;
  save: WorldSave;
  items: ReadonlyArray<ShopItemRef>;
  /** Catalog peak HP per character id — used by the Heal-All-HP /
   *  Raise-Dead services to clamp restoration. The SavedCharacterState
   *  doesn't carry max_hp, so the host derives this from
   *  characters.json. */
  maxHpById: ReadonlyMap<string, number>;
  /** Same for max MP — drives Restore-All-MP. */
  maxMpById: ReadonlyMap<string, number>;
  onMutateSave: (next: WorldSave) => void;
  onClose: () => void;
}) {
  // Live save mirror so buy/sell can re-render the panel without
  // waiting for a parent re-render via the prop. Resyncs when the
  // upstream save reference changes.
  const [liveSave, setLiveSave] = useState<WorldSave>(save);
  useEffect(() => {
    setLiveSave(save);
  }, [save]);

  // Local snapshot of this counter's stock. Edits stay in this hook;
  // they don't write back to the catalog (counters restock per
  // session). Initialized once on mount.
  const [stock, setStock] = useState<string[]>(
    () => (Array.isArray(counter.items) ? [...counter.items] : []),
  );

  // ESC closes — capture-phase so the underlying sim's movement
  // keys don't fire under the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      } else if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "w" ||
        e.key === "a" ||
        e.key === "s" ||
        e.key === "d" ||
        e.key === "W" ||
        e.key === "A" ||
        e.key === "S" ||
        e.key === "D"
      ) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  const itemsById = new Map(items.map((i) => [i.id, i]));
  const commit = useCallback(
    (next: WorldSave) => {
      setLiveSave(next);
      onMutateSave(next);
    },
    [onMutateSave],
  );

  const buyPrice = (id: string): number => {
    const it = itemsById.get(id);
    return typeof it?.buy === "number" ? it.buy : 0;
  };
  const sellPrice = (id: string): number => {
    const it = itemsById.get(id);
    return typeof it?.sell === "number" ? it.sell : 0;
  };
  const itemLabel = (id: string): string => itemsById.get(id)?.name ?? id;
  /** How many physical items one purchase of `id` adds. For stackable
   *  ammo / consumables this is the catalog's `charges` field (Arrows
   *  bundle of 20, Lockpicks bundle of 5, etc.). For non-stackable
   *  items it's always 1 — the catalog's `charges` semantic there is
   *  per-instance durability, not bundle count, so we must not treat
   *  it as quantity. Mirrors `stackSizeOf` in battle/world/Items.ts
   *  but spelled out here so the play shop doesn't have to import
   *  the heavier battle module. */
  const bundleSize = (id: string): number => {
    const it = itemsById.get(id);
    if (!it?.stackable) return 1;
    return typeof it.charges === "number" && it.charges > 0 ? it.charges : 1;
  };

  const handleBuy = (stockIndex: number) => {
    if (stockIndex < 0 || stockIndex >= stock.length) return;
    const itemId = stock[stockIndex];
    const price = buyPrice(itemId);
    if (price <= 0) return;
    const gold = liveSave.party.gold ?? 0;
    if (gold < price) return;
    // Stackable ammo / consumables are sold as bundles — one shop
    // click adds the catalog's `charges` count (Arrows = 20, Lockpick
    // = 5, etc.) instead of a single physical item. Mirrors the
    // bundle behavior `TownActions.addToStash` already uses for the
    // tile-bump shop path so both code paths agree.
    const bundle = bundleSize(itemId);
    const nextInventory = addToInventory(
      liveSave.party.inventory,
      itemId,
      items,
      bundle,
    );
    commit({
      ...liveSave,
      party: {
        ...liveSave.party,
        gold: gold - price,
        inventory: nextInventory,
      },
    });
    setStock((cur) => cur.filter((_, i) => i !== stockIndex));
  };

  /** Apply a temple service to the party. Each id has a hand-coded
   *  recipe today — heal / restore / raise / cure. Unknown ids are
   *  no-ops so the gold doesn't drain for nothing. The service rows
   *  are also disabled in the UI when there's nothing to do (party
   *  fully healed, no dead, no poisons), so reaching this with an
   *  unknown id would normally take a stale counters.json. */
  const handleService = (s: ServiceRef) => {
    const cost = s.cost ?? 0;
    const gold = liveSave.party.gold ?? 0;
    if (gold < cost) return;
    let members = liveSave.party.members.slice();
    let applied = false;
    if (s.id === "heal_all_hp") {
      members = members.map((m) => {
        if (m.hp <= 0) return m;
        const max = maxHpById.get(m.id) ?? m.hp;
        if (m.hp >= max) return m;
        applied = true;
        return { ...m, hp: max };
      });
    } else if (s.id === "restore_all_mp") {
      members = members.map((m) => {
        if (m.hp <= 0) return m;
        const mp = m.mp ?? 0;
        const max = maxMpById.get(m.id) ?? mp;
        if (mp >= max) return m;
        applied = true;
        return { ...m, mp: max };
      });
    } else if (s.id === "raise_dead") {
      members = members.map((m) => {
        if (m.hp > 0) return m;
        const max = maxHpById.get(m.id) ?? 0;
        if (max <= 0) return m;
        applied = true;
        return { ...m, hp: max };
      });
    } else if (s.id === "cure_all_poisons") {
      members = members.map((m) => {
        const list = m.effects ?? [];
        if (list.length === 0) return m;
        const filtered = list.filter((e) => !/poison/i.test(e.id));
        if (filtered.length === list.length) return m;
        applied = true;
        return { ...m, effects: filtered };
      });
    } else {
      return;
    }
    if (!applied) return;
    commit({
      ...liveSave,
      party: { ...liveSave.party, gold: gold - cost, members },
    });
  };

  /** True when the service has work to do on the current party.
   *  Drives the disabled state on the apply button so the player
   *  doesn't waste gold paying for a no-op heal. */
  const serviceAvailable = (id: string): boolean => {
    const members = liveSave.party.members;
    if (id === "heal_all_hp") {
      return members.some(
        (m) => m.hp > 0 && m.hp < (maxHpById.get(m.id) ?? m.hp),
      );
    }
    if (id === "restore_all_mp") {
      return members.some(
        (m) =>
          m.hp > 0 &&
          (m.mp ?? 0) < (maxMpById.get(m.id) ?? (m.mp ?? 0)),
      );
    }
    if (id === "raise_dead") {
      return members.some(
        (m) => m.hp <= 0 && (maxHpById.get(m.id) ?? 0) > 0,
      );
    }
    if (id === "cure_all_poisons") {
      return members.some((m) =>
        (m.effects ?? []).some((e) => /poison/i.test(e.id)),
      );
    }
    return false;
  };

  const handleSell = (invIndex: number) => {
    const inv = liveSave.party.inventory;
    if (invIndex < 0 || invIndex >= inv.length) return;
    const entry = inv[invIndex];
    const price = sellPrice(entry.item);
    if (price <= 0) return;
    const nextInventory = consumeOneFromInventory(inv, invIndex, items);
    const gold = liveSave.party.gold ?? 0;
    commit({
      ...liveSave,
      party: {
        ...liveSave.party,
        gold: gold + price,
        inventory: nextInventory,
      },
    });
    setStock((cur) => [...cur, entry.item]);
  };

  const kindLabel = counter.kind ?? "shop";
  const gold = liveSave.party.gold ?? 0;
  const inventory = liveSave.party.inventory;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <header className="flex items-baseline justify-between border-b border-parchment/15 px-3 py-2">
          <div>
            <h2 className="font-display text-lg text-parchment">
              {counter.name ?? counter.id}
            </h2>
            <p className="text-[11px] uppercase tracking-wide text-parchment/45">
              {kindLabel}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-parchment/75">
              Gold: {gold}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
              title="Close (ESC)"
            >
              Close
            </button>
          </div>
        </header>
        {counter.description ? (
          <p className="border-b border-parchment/10 px-3 py-1.5 text-xs italic text-parchment/55">
            {counter.description}
          </p>
        ) : null}
        {counter.kind === "service" ? (
          // Temple-style counter: list services with apply buttons.
          // Each row gates on (a) party gold ≥ cost and (b) the
          // service actually having work to do (heal a wounded
          // member, raise a dead one, etc) so the player doesn't
          // pay for a no-op.
          <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
            {(counter.services ?? []).length === 0 ? (
              <p className="text-sm text-parchment/55">
                This temple has no services available.
              </p>
            ) : null}
            {(counter.services ?? []).map((s) => {
              const cost = s.cost ?? 0;
              const canAfford = gold >= cost;
              const available = serviceAvailable(s.id);
              const disabled = !canAfford || !available;
              const reason = !available
                ? "Nothing to do — already in good shape."
                : !canAfford
                  ? `Need ${cost}g (you have ${gold}g).`
                  : s.description ?? "Apply this service.";
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleService(s)}
                  disabled={disabled}
                  title={reason}
                  className="flex flex-col gap-1 rounded border border-parchment/20 bg-ink/40 p-2 text-left text-sm text-parchment hover:bg-ink/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-display">
                      {s.name ?? s.id}
                    </span>
                    <span className="font-mono text-xs text-parchment/65">
                      {cost > 0 ? `${cost}g` : "free"}
                    </span>
                  </span>
                  {s.description ? (
                    <span className="text-[11px] text-parchment/55">
                      {s.description}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </section>
        ) : (
        <div className="grid flex-1 grid-cols-2 gap-3 overflow-hidden p-3">
          {/* Stock — click to buy */}
          <section className="flex min-h-0 flex-col">
            <h3 className="mb-1 text-[11px] uppercase tracking-wide text-amber-300">
              Stock ({stock.length})
            </h3>
            <ul className="flex-1 space-y-1 overflow-auto pr-1 text-sm">
              {stock.length === 0 ? (
                <li className="text-xs text-parchment/45">(sold out)</li>
              ) : null}
              {stock.map((id, i) => {
                const price = buyPrice(id);
                const canAfford = gold >= price && price > 0;
                const bundle = bundleSize(id);
                return (
                  <li key={`${id}-${i}`}>
                    <button
                      type="button"
                      onClick={() => handleBuy(i)}
                      disabled={!canAfford}
                      title={
                        itemsById.get(id)?.description ?? itemLabel(id)
                      }
                      className="flex w-full items-center justify-between rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-left text-parchment hover:bg-ink/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate">
                        {itemLabel(id)}
                        {bundle > 1 ? (
                          <span className="ml-1 text-parchment/55">
                            ×{bundle}
                          </span>
                        ) : null}
                      </span>
                      <span className="ml-2 shrink-0 font-mono text-xs text-parchment/65">
                        {price > 0 ? `${price}g` : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Party inventory — click to sell */}
          <section className="flex min-h-0 flex-col">
            <h3 className="mb-1 text-[11px] uppercase tracking-wide text-amber-300">
              Your Stash ({inventory.length})
            </h3>
            <ul className="flex-1 space-y-1 overflow-auto pr-1 text-sm">
              {inventory.length === 0 ? (
                <li className="text-xs text-parchment/45">(empty)</li>
              ) : null}
              {inventory.map((entry, i) => {
                const price = sellPrice(entry.item);
                const def = itemsById.get(entry.item);
                const qty =
                  def?.stackable && typeof entry.charges === "number"
                    ? entry.charges
                    : 1;
                const qtyLabel = qty > 1 ? ` (${qty})` : "";
                return (
                  <li key={`${entry.item}-${i}`}>
                    <button
                      type="button"
                      onClick={() => handleSell(i)}
                      disabled={price <= 0}
                      title={
                        def?.description ??
                        itemLabel(entry.item)
                      }
                      className="flex w-full items-center justify-between rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-left text-parchment hover:bg-ink/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate">
                        {itemLabel(entry.item)}
                        {qtyLabel}
                      </span>
                      <span className="ml-2 shrink-0 font-mono text-xs text-parchment/65">
                        {price > 0 ? `+${price}g` : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
        )}
      </div>
    </div>
  );
}
