"use client";

/**
 * Modal overlay that opens when the party bumps a cell whose `item`
 * is a treasure chest (the item record carries `is_chest: true` in
 * the items catalog). The sim fires `chest_encountered` instead of
 * the normal post-move `item_picked` flow; the host catches it and
 * mounts this overlay.
 *
 * Two choices:
 *
 *   - **Open** — host merges the chest's `contents` (gold + items)
 *     into the party stash, fires SFX / celebration if appropriate,
 *     and calls the kernel's `clearCellItem(col, row)` to remove the
 *     chest from the map. Auto-closes the dialog after the contents
 *     animate in.
 *   - **Leave** — host dismisses the overlay only. The chest stays
 *     in place; the party can come back later. No SFX, no save
 *     mutation.
 *
 * Esc / arrow + Enter mirror the rest of the modal family
 * (QuestDialogOverlay, LockDialogOverlay) — outline focus ring on
 * the cursor target, Up/Down cycle, Enter activates. Default focus
 * lands on Open since "I bumped a chest — give me the loot" is the
 * dominant intent.
 */

import { useEffect, useState } from "react";
import { withBasePath } from "@/util/basePath";
import type { ChestContents } from "@/sim/types";

interface ChestItemForDisplay {
  id: string;
  name?: string;
  icon?: string;
  qty?: number;
}

export interface ChestDialogProps {
  /** Display name of the chest ("Wooden Chest", "Iron Strongbox"). */
  chestName: string;
  /** Catalog icon stem ("chest", "iron_chest"). Resolved against
   *  `/sprites/item/<icon>.png`. Falls back to an empty box graphic
   *  when omitted or when the texture doesn't load. */
  chestIcon?: string;
  /** Authored contents from the chest's catalog record. Both fields
   *  are optional; an empty chest still renders ("(nothing inside)")
   *  so the player gets feedback rather than an silent click. */
  contents?: ChestContents;
  /** Per-item display data the host pre-resolves from the items
   *  catalog: name + icon for each id in `contents.items`. Keeps
   *  the catalog lookup outside this component. */
  itemDisplay: ReadonlyArray<ChestItemForDisplay>;
  /** Host hands the chest's loot to the party + clears the cell. */
  onOpen: () => void;
  /** Host dismisses the overlay without mutating state. */
  onLeave: () => void;
}

export function ChestDialogOverlay({
  chestName,
  chestIcon,
  contents,
  itemDisplay,
  onOpen,
  onLeave,
}: ChestDialogProps) {
  type ActionKind = "open" | "leave";
  const actions: ActionKind[] = ["open", "leave"];
  const [focusedAction, setFocusedAction] = useState<number>(0);

  const gold = contents?.gold ?? 0;
  const items = contents?.items ?? [];
  const isEmpty = gold <= 0 && items.length === 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setFocusedAction((i) => (i + 1) % actions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setFocusedAction(
          (i) => (i - 1 + actions.length) % actions.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const a = actions[focusedAction];
        if (a === "open") onOpen();
        else onLeave();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // Esc is "back out" — for the chest, that's Leave (the chest
        // stays in place, no save mutation). Matches the back-out
        // semantics of the other dialogs in the family.
        onLeave();
        return;
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [actions, focusedAction, onOpen, onLeave]);

  const chestSpriteSrc = chestIcon
    ? withBasePath(`/sprites/item/${chestIcon}.png`)
    : null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label={`Treasure chest: ${chestName}`}
    >
      <div className="w-[440px] rounded-lg border border-parchment/25 bg-ink/95 p-4 text-parchment shadow-xl">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">{chestName}</h2>
          <span className="font-mono text-xs text-parchment/65">
            Treasure
          </span>
        </header>

        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-parchment/20 bg-ink/80">
            {chestSpriteSrc ? (
              <img
                src={chestSpriteSrc}
                alt=""
                width={36}
                height={36}
                style={{ imageRendering: "pixelated" }}
                className="h-9 w-9 object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility =
                    "hidden";
                }}
              />
            ) : (
              <span className="font-mono text-xs text-parchment/75">
                CHEST
              </span>
            )}
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-parchment/65">
              Contents
            </p>
            {isEmpty ? (
              <p className="mt-1 text-sm italic text-parchment/75">
                (Empty — but the chest itself looks like a curiosity.)
              </p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {gold > 0 ? (
                  <li className="flex items-baseline justify-between gap-2">
                    <span className="text-amber-300">Gold</span>
                    <span className="font-mono text-[13px] text-parchment/85">
                      {gold}g
                    </span>
                  </li>
                ) : null}
                {items.map((it, i) => {
                  // Icon resolution: each row pre-resolved by the
                  // host via the `itemDisplay` prop. Fall back to
                  // the id-as-name + no sprite when the host hasn't
                  // matched the id against the items catalog.
                  const display = itemDisplay.find((d) => d.id === it.id);
                  const label = display?.name ?? it.id;
                  const iconSrc = display?.icon
                    ? withBasePath(`/sprites/item/${display.icon}.png`)
                    : null;
                  const qty = it.qty ?? 1;
                  return (
                    <li
                      key={`${it.id}-${i}`}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-2">
                        {iconSrc ? (
                          <img
                            src={iconSrc}
                            alt=""
                            width={16}
                            height={16}
                            style={{ imageRendering: "pixelated" }}
                            className="h-4 w-4 object-contain"
                            onError={(e) => {
                              (
                                e.currentTarget as HTMLImageElement
                              ).style.visibility = "hidden";
                            }}
                          />
                        ) : null}
                        <span className="text-parchment/90">{label}</span>
                      </span>
                      {qty > 1 ? (
                        <span className="font-mono text-[13px] text-parchment/80">
                          ×{qty}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {(() => {
            // Each button looks up its own slot in the static `actions`
            // list so the focus ring + click handler stay aligned. The
            // ring is an `outline` rather than a border to avoid
            // shifting the buttons when focus moves.
            const focusRing =
              "outline outline-2 outline-amber-200 outline-offset-1";
            const openIdx = actions.indexOf("open");
            const leaveIdx = actions.indexOf("leave");
            return (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setFocusedAction(openIdx);
                    onOpen();
                  }}
                  className={[
                    "rounded border border-ember/60 bg-ember/25 px-3 py-2 text-left text-sm hover:bg-ember/45",
                    focusedAction === openIdx ? focusRing : "",
                  ].join(" ")}
                >
                  <div className="font-medium">Open</div>
                  <div className="text-xs text-parchment/75">
                    {isEmpty
                      ? "Take a look anyway — the chest itself goes back into the world's noise."
                      : "Take everything in the chest. The chest stays empty on the map."}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFocusedAction(leaveIdx);
                    onLeave();
                  }}
                  className={[
                    "rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm hover:bg-ink/60",
                    focusedAction === leaveIdx ? focusRing : "",
                  ].join(" ")}
                >
                  <div className="font-medium">Leave</div>
                  <div className="text-xs text-parchment/75">
                    Step back. The chest waits where you found it.
                  </div>
                </button>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
