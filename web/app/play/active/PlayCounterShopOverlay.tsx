"use client";

/**
 * Play-time counter shop overlay. Opens when the party walks into a
 * tile with a `counter` field, or an NPC whose `counter` field
 * resolves in the counters catalog.
 *
 * Buy/sell mutates `liveSave.party.gold` and `liveSave.party.inventory`
 * via the same stacking helpers PlayPartyScreenOverlay uses; changes
 * commit upstream through `onMutateSave`. The counter's stock now
 * lives PERSISTENTLY on `liveSave.counters[counter.id]` — items bought
 * disappear from the row, items sold land back in the counter with
 * their current per-instance durability intact, and sell prices scale
 * linearly with that durability so a worn-out sword fetches less than
 * a fresh one. Counters never auto-restock; the catalog's
 * `counter.items` field is only the seed used the first time a save
 * opens a given counter (see `counterStock.getCounterStock`).
 *
 * Escape, the backdrop, or the Close button dismisses.
 */

import { useCallback, useEffect, useState } from "react";
import type { WorldSave } from "@/play/saveTypes";
import {
  addToInventory,
  consumeOneFromInventory,
} from "@/play/inventoryStacking";
import {
  computeSellPrice,
  getCounterStock,
  setCounterStock,
  type CounterStockEntry,
} from "@/play/counterStock";
import { Sfx } from "@/battle/audio/Sfx";

interface ShopItemRef {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  buy?: number | null;
  sell?: number | null;
  stackable?: boolean;
  charges?: number;
  /** Catalog peak durability for non-stackable wear. Drives the
   *  durability-scaled sell price (`computeSellPrice`); absent for
   *  items that don't wear (consumables, tokens). */
  durability?: number;
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
  memberNameById,
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
  /** Display name per member id. Surfaces in the service counter's
   *  party panel so the player sees who's getting healed rather than
   *  raw character ids. Missing ids fall back to the id. */
  memberNameById?: ReadonlyMap<string, string>;
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

  // Effective stock for this counter. Persisted on the save under
  // `liveSave.counters[counter.id]` — first open seeds the array
  // from `counter.items` (one fresh entry per id). Subsequent buys
  // / sells update the saved array directly, so the worn-in dagger
  // a Thief sold sits there waiting to be re-bought on the next
  // visit. We render straight off this derived value rather than
  // mirroring it into local state so a parent-driven save update
  // (autosave, dungeon transition) shows through immediately.
  const stock: CounterStockEntry[] = getCounterStock(
    liveSave.counters,
    counter.id,
    counter.items,
  );

  // Sparkle-pulse animation tracking. When a temple service applies,
  // we tag the affected member ids here with a per-tag flavor (hp /
  // mp / revive) so each row can render a colored glow that matches
  // what the player just paid for. The tags clear ~900ms later via
  // a setTimeout so the pulse plays once and tidies itself up. Kept
  // out of `liveSave` because it's pure presentational state — no
  // need to round-trip through the save.
  type SparkleFlavor = "hp" | "mp" | "revive" | "cure";
  const [sparkles, setSparkles] = useState<Record<string, SparkleFlavor>>(
    {},
  );
  const SPARKLE_MS = 900;
  const triggerSparkles = useCallback(
    (ids: ReadonlyArray<string>, flavor: SparkleFlavor) => {
      if (ids.length === 0) return;
      setSparkles((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = flavor;
        return next;
      });
      window.setTimeout(() => {
        setSparkles((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            if (next[id] === flavor) delete next[id];
          }
          return next;
        });
      }, SPARKLE_MS);
    },
    [],
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
  /** Sell price for a specific inventory entry. Scales the catalog
   *  base by the entry's per-instance `durability` / item's
   *  `durability` peak so a half-worn weapon fetches half. Entries
   *  without a durability stamp (fresh gear, consumables, stackable
   *  ammo) keep the base price. */
  const sellPriceFor = (entry: {
    item: string;
    durability?: number;
  }): number => {
    return computeSellPrice(itemsById.get(entry.item), entry);
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
    const entry = stock[stockIndex];
    const itemId = entry.item;
    const price = buyPrice(itemId);
    if (price <= 0) return;
    const gold = liveSave.party.gold ?? 0;
    if (gold < price) return;
    // Stackable ammo / consumables are sold as bundles — one shop
    // click adds the catalog's `charges` count (Arrows = 20, Lockpick
    // = 5, etc.) instead of a single physical item. Mirrors the
    // bundle behavior `TownActions.addToStash` already uses for the
    // tile-bump shop path so both code paths agree. For non-stackable
    // gear with a stored per-instance durability (an item the player
    // previously sold to this counter at less-than-fresh wear), we
    // thread that durability into the inventory entry so the buyer
    // receives the SAME worn instance back — counters are pawn
    // shops, not refurbishers.
    const bundle = bundleSize(itemId);
    const nextInventory = addToInventory(
      liveSave.party.inventory,
      itemId,
      items,
      bundle,
      entry.durability,
    );
    const nextCounters = setCounterStock(
      liveSave.counters,
      counter.id,
      stock.filter((_, i) => i !== stockIndex),
    );
    commit({
      ...liveSave,
      counters: nextCounters,
      party: {
        ...liveSave.party,
        gold: gold - price,
        inventory: nextInventory,
      },
    });
    Sfx.play("buy");
  };

  /** Apply a temple service to the party. Each id has a hand-coded
   *  recipe today — heal / restore / raise / cure. Unknown ids are
   *  no-ops so the gold doesn't drain for nothing. The service rows
   *  are also disabled in the UI when there's nothing to do (party
   *  fully healed, no dead, no poisons), so reaching this with an
   *  unknown id would normally take a stale counters.json.
   *
   *  Side effects on apply:
   *    - Records each affected member id so the matching party-row
   *      gets a brief colored sparkle pulse (green for HP heal,
   *      blue for MP restore, gold for raise, white for cure).
   *    - Fires the `heal` SFX once per apply. The same cue works
   *      for every flavor — it's a short ascending arpeggio that
   *      reads as "temple magic" without locking us into separate
   *      sounds for each service. */
  const handleService = (s: ServiceRef) => {
    const cost = s.cost ?? 0;
    const gold = liveSave.party.gold ?? 0;
    if (gold < cost) return;
    let members = liveSave.party.members.slice();
    const affected: string[] = [];
    let flavor: SparkleFlavor = "hp";
    if (s.id === "heal_all_hp") {
      flavor = "hp";
      members = members.map((m) => {
        if (m.hp <= 0) return m;
        const max = maxHpById.get(m.id) ?? m.hp;
        if (m.hp >= max) return m;
        affected.push(m.id);
        return { ...m, hp: max };
      });
    } else if (s.id === "restore_all_mp") {
      flavor = "mp";
      members = members.map((m) => {
        if (m.hp <= 0) return m;
        const mp = m.mp ?? 0;
        const max = maxMpById.get(m.id) ?? mp;
        if (mp >= max) return m;
        affected.push(m.id);
        return { ...m, mp: max };
      });
    } else if (s.id === "raise_dead") {
      flavor = "revive";
      members = members.map((m) => {
        if (m.hp > 0) return m;
        const max = maxHpById.get(m.id) ?? 0;
        if (max <= 0) return m;
        affected.push(m.id);
        return { ...m, hp: max };
      });
    } else if (s.id === "cure_all_poisons") {
      flavor = "cure";
      members = members.map((m) => {
        const list = m.effects ?? [];
        if (list.length === 0) return m;
        const filtered = list.filter((e) => !/poison/i.test(e.id));
        if (filtered.length === list.length) return m;
        affected.push(m.id);
        return { ...m, effects: filtered };
      });
    } else {
      return;
    }
    if (affected.length === 0) return;
    commit({
      ...liveSave,
      party: { ...liveSave.party, gold: gold - cost, members },
    });
    triggerSparkles(affected, flavor);
    Sfx.play("heal");
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
    const price = sellPriceFor(entry);
    if (price <= 0) return;
    const nextInventory = consumeOneFromInventory(inv, invIndex, items);
    // Push the sold entry back onto the counter, preserving the
    // per-instance `durability` if present so the row reads as the
    // same worn instance the player just relinquished. Stackable
    // sells push one "fresh" row of the item id — the inventory
    // side already decremented its `charges` by 1, so a counter row
    // per sold unit lets the player re-buy a single ammo bundle
    // back without weird half-stack accounting. (Stackables don't
    // have meaningful per-instance durability anyway.)
    const def = itemsById.get(entry.item);
    const counterRow: CounterStockEntry = { item: entry.item };
    if (!def?.stackable && typeof entry.durability === "number") {
      counterRow.durability = entry.durability;
    }
    const nextCounters = setCounterStock(
      liveSave.counters,
      counter.id,
      [...stock, counterRow],
    );
    const gold = liveSave.party.gold ?? 0;
    commit({
      ...liveSave,
      counters: nextCounters,
      party: {
        ...liveSave.party,
        gold: gold + price,
        inventory: nextInventory,
      },
    });
    Sfx.play("sell");
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
          // Temple-style counter: party panel + list services with
          // apply buttons. The party panel shows each member's name
          // + HP/MP so the player can see WHO needs help before they
          // spend gold; when a service applies, the affected rows
          // get a colored sparkle pulse driven by `sparkles[id]` so
          // the player can also see who just received the heal /
          // restore / revive. Each service row gates on (a) party
          // gold ≥ cost and (b) the service actually having work to
          // do (heal a wounded member, raise a dead one, etc) so
          // the player doesn't pay for a no-op.
          <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
            {/* Inline keyframes for the per-member sparkle pulse.
                Scoped to a single <style> tag inside the modal so we
                don't have to thread CSS through a global stylesheet
                just for this one effect. Three colors map to the
                three flavors of healing — green = hp restored,
                blue = mp restored, gold = revived from dead, white
                = cured. The animation fades a colored radial halo
                in + out over ~900ms (matches `SPARKLE_MS`) so the
                row settles back to its resting look. */}
            <style>{`
              @keyframes counter-sparkle-hp {
                0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
                30% { box-shadow: 0 0 16px 4px rgba(74, 222, 128, 0.75); }
                100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
              }
              @keyframes counter-sparkle-mp {
                0% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
                30% { box-shadow: 0 0 16px 4px rgba(96, 165, 250, 0.75); }
                100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
              }
              @keyframes counter-sparkle-revive {
                0% { box-shadow: 0 0 0 0 rgba(252, 211, 77, 0); }
                30% { box-shadow: 0 0 18px 5px rgba(252, 211, 77, 0.85); }
                100% { box-shadow: 0 0 0 0 rgba(252, 211, 77, 0); }
              }
              @keyframes counter-sparkle-cure {
                0% { box-shadow: 0 0 0 0 rgba(229, 231, 235, 0); }
                30% { box-shadow: 0 0 14px 4px rgba(229, 231, 235, 0.7); }
                100% { box-shadow: 0 0 0 0 rgba(229, 231, 235, 0); }
              }
              .counter-sparkle-hp     { animation: counter-sparkle-hp     900ms ease-out; }
              .counter-sparkle-mp     { animation: counter-sparkle-mp     900ms ease-out; }
              .counter-sparkle-revive { animation: counter-sparkle-revive 900ms ease-out; }
              .counter-sparkle-cure   { animation: counter-sparkle-cure   900ms ease-out; }
            `}</style>
            {liveSave.party.members.length > 0 ? (
              <div className="rounded border border-parchment/15 bg-ink/30 p-2">
                <h3 className="mb-1.5 text-[10px] uppercase tracking-wide text-amber-300">
                  Party
                </h3>
                <ul className="space-y-1">
                  {liveSave.party.members.map((m) => {
                    const peakHp = maxHpById.get(m.id);
                    const peakMp = maxMpById.get(m.id);
                    const name = memberNameById?.get(m.id) ?? m.id;
                    const sparkle = sparkles[m.id];
                    const sparkleClass = sparkle
                      ? `counter-sparkle-${sparkle}`
                      : "";
                    const down = m.hp <= 0;
                    // Compact HP / MP readout: "Name   12/30 HP   5/20 MP".
                    // We always show the current value and (when known)
                    // the peak; the peak comes from save.party.members
                    // backfill, with the catalog as a last resort.
                    return (
                      <li
                        key={m.id}
                        className={`flex items-center justify-between rounded border border-transparent bg-ink/40 px-2 py-1 text-sm text-parchment ${sparkleClass}`}
                      >
                        <span
                          className={`truncate font-display ${
                            down ? "text-parchment/45 line-through" : ""
                          }`}
                          title={down ? "Unconscious" : name}
                        >
                          {name}
                        </span>
                        <span className="ml-2 shrink-0 font-mono text-[11px] text-parchment/70">
                          <span
                            className={
                              typeof peakHp === "number" && m.hp < peakHp
                                ? "text-rose-300"
                                : ""
                            }
                          >
                            {m.hp}
                            {typeof peakHp === "number" ? `/${peakHp}` : ""}
                            <span className="ml-0.5 text-parchment/45">HP</span>
                          </span>
                          {typeof peakMp === "number" && peakMp > 0 ? (
                            <span
                              className={`ml-2 ${
                                (m.mp ?? 0) < peakMp ? "text-sky-300" : ""
                              }`}
                            >
                              {m.mp ?? 0}/{peakMp}
                              <span className="ml-0.5 text-parchment/45">MP</span>
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
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
              {stock.map((entry, i) => {
                const id = entry.item;
                const price = buyPrice(id);
                const canAfford = gold >= price && price > 0;
                const def = itemsById.get(id);
                const bundle = bundleSize(id);
                // Worn-in resale stock — surface the durability
                // bar in the label so the player can see they're
                // looking at the same beat-up dagger they sold last
                // visit (and not a fresh one). Stackable rows skip
                // this since they don't carry per-instance wear.
                const wearLabel =
                  !def?.stackable &&
                  typeof entry.durability === "number" &&
                  typeof def?.durability === "number" &&
                  def.durability > 0
                    ? ` (${entry.durability}/${def.durability})`
                    : "";
                return (
                  <li key={`${id}-${i}`}>
                    <button
                      type="button"
                      onClick={() => handleBuy(i)}
                      disabled={!canAfford}
                      title={def?.description ?? itemLabel(id)}
                      className="flex w-full items-center justify-between rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-left text-parchment hover:bg-ink/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate">
                        {itemLabel(id)}
                        {bundle > 1 ? (
                          <span className="ml-1 text-parchment/55">
                            ×{bundle}
                          </span>
                        ) : null}
                        {wearLabel ? (
                          <span className="ml-1 text-parchment/55">
                            {wearLabel}
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
                const price = sellPriceFor(entry);
                const def = itemsById.get(entry.item);
                const qty =
                  def?.stackable && typeof entry.charges === "number"
                    ? entry.charges
                    : 1;
                const qtyLabel = qty > 1 ? ` (${qty})` : "";
                // Show the worn-in price next to the catalog base
                // when they differ, so the player can see at a
                // glance that selling a battered weapon nets less
                // gold than selling the same item fresh. Stackable
                // items don't carry per-instance wear so they
                // always sell at base — skip the badge for them.
                const basePrice =
                  typeof def?.sell === "number" ? def.sell : 0;
                const showWearDiscount =
                  !def?.stackable &&
                  basePrice > 0 &&
                  price > 0 &&
                  price < basePrice;
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
                        {price > 0 ? (
                          showWearDiscount ? (
                            <>
                              <span className="text-parchment/40 line-through">
                                {basePrice}g
                              </span>
                              <span className="ml-1">+{price}g</span>
                            </>
                          ) : (
                            `+${price}g`
                          )
                        ) : (
                          "—"
                        )}
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
