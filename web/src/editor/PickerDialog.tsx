"use client";

/**
 * Shared frame for the editor's large, centred picker dialogs — the
 * same look as MapPickerDialog (the Link map picker): a portal over a
 * dimmed backdrop, a title bar with a count + ✕, a search row, and a
 * scrolling body that fills the rest of the dialog. Esc or a click on
 * the backdrop closes it.
 *
 * Used by the Map editor's cell-inspector pickers (background tile,
 * item, NPC, counter, quest, dungeon, trap, lore, encounter, spawn,
 * pressure-plate tile) so they open in the middle of the screen
 * instead of squeezing a scroll box into the narrow side panel.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalKeyLock } from "@/play/modalKeyLock";

export function PickerDialogFrame({
  title,
  count,
  search,
  onSearch,
  searchPlaceholder = "Search…",
  onSearchEnter,
  toolbar,
  onClose,
  children,
}: {
  title: string;
  /** Optional "12 of 40 items"-style count shown beside the title. */
  count?: ReactNode;
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  /** Enter in the search box (e.g. pick the single match). */
  onSearchEnter?: () => void;
  /** Extra buttons on the search row (None, Expand all, …). */
  toolbar?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  // Own the keyboard while open so window-level listeners underneath
  // (map editor shortcuts) stay out of the way while typing.
  useModalKeyLock();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-[86vh] w-[min(1100px,94vw)] flex-col rounded-md border border-parchment/20 bg-ink shadow-2xl"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-parchment/10 px-5 py-3">
          <h2 className="font-display text-2xl text-parchment">{title}</h2>
          {count !== undefined ? (
            <span className="text-sm text-parchment/60">{count}</span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded border border-parchment/20 px-2 py-0.5 text-sm text-parchment/80 hover:bg-ink/50"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-parchment/10 px-5 py-2">
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onSearchEnter) {
                e.preventDefault();
                onSearchEnter();
              }
            }}
            placeholder={searchPlaceholder}
            className="min-w-[16rem] flex-1 rounded border border-parchment/20 bg-ink/50 px-3 py-1.5 text-sm text-parchment/90 focus:border-parchment/60 focus:outline-none"
          />
          {toolbar}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto px-5 py-3">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Small toolbar button styled like the map picker's Expand / Collapse. */
export function PickerToolbarButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/75 hover:bg-ink/40 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Lower-cased, whitespace-split AND match over a haystack. */
export function matchesQuery(hay: string, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const h = hay.toLowerCase();
  return words.every((w) => h.includes(w));
}
