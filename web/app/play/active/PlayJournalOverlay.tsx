"use client";

/**
 * Journal — opens with `J` from the play screen. Lists every piece of
 * lore the party has read, newest first, with tag filter chips (built
 * from the discovered lore's tags), a search box, and the full text of
 * the selected entry.
 *
 * Keys: J / Esc close; ↑ ↓ move between entries. Movement keys are
 * swallowed (capture phase) so the party doesn't walk under the modal.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { filterLore, loreTags, type LoreRecord } from "@/play/lore";

export function PlayJournalOverlay({
  entries,
  onClose,
}: {
  /** Read lore, newest first (see `journalEntries`). */
  entries: ReadonlyArray<LoreRecord>;
  onClose: () => void;
}) {
  const [tag, setTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const tags = useMemo(() => loreTags(entries), [entries]);
  const visible = useMemo(() => filterLore(entries, tag, search), [entries, tag, search]);
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const selected =
    visible.find((e) => e.id === selectedId) ?? visible[0] ?? null;
  const readerRef = useRef<HTMLDivElement | null>(null);

  // Scroll the reading pane back to the top when the entry changes.
  useEffect(() => {
    readerRef.current?.scrollTo({ top: 0 });
  }, [selected?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (e.key === "Escape" || (!typing && (e.key === "j" || e.key === "J"))) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (visible.length === 0) return;
        const idx = Math.max(0, visible.findIndex((v) => v.id === selected?.id));
        const next =
          e.key === "ArrowDown"
            ? Math.min(visible.length - 1, idx + 1)
            : Math.max(0, idx - 1);
        setSelectedId(visible[next].id);
        return;
      }
      if (
        !typing &&
        ["ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"].includes(e.key)
      ) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose, visible, selected?.id]);

  const chip = (active: boolean) =>
    [
      "rounded border px-2 py-0.5 text-xs uppercase tracking-wide transition",
      active
        ? "border-amber-300/70 bg-amber-300/20 text-amber-100"
        : "border-parchment/20 text-parchment/65 hover:border-parchment/40 hover:text-parchment",
    ].join(" ");

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Journal"
        className="flex h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h2 className="font-display text-3xl text-parchment">Journal</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-parchment/50">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-parchment/20 px-3 py-1 text-base text-parchment/70 hover:bg-ink/40"
              title="Close (J or ESC)"
            >
              Close
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="p-4 text-lg text-parchment/60">
            You haven&apos;t discovered any lore yet. Look for books,
            plaques and inscriptions — and read the books you find.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Left: filters + list */}
            <div className="flex min-h-0 flex-col border-b border-parchment/15 md:w-72 md:border-b-0 md:border-r">
              <div className="space-y-2 p-3">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search the journal…"
                  aria-label="Search the journal"
                  className="w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment placeholder:text-parchment/40 focus:border-parchment/50 focus:outline-none"
                />
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
                    <button
                      type="button"
                      onClick={() => setTag(null)}
                      aria-pressed={tag === null}
                      className={chip(tag === null)}
                    >
                      All
                    </button>
                    {tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTag(tag === t ? null : t)}
                        aria-pressed={tag === t}
                        className={chip(tag === t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" role="listbox" aria-label="Lore">
                {visible.length === 0 ? (
                  <li className="px-2 py-1 text-sm text-parchment/50">
                    Nothing matches.
                  </li>
                ) : null}
                {visible.map((e) => {
                  const isSel = e.id === selected?.id;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        onClick={() => setSelectedId(e.id)}
                        className={[
                          "w-full rounded border px-2 py-1.5 text-left transition",
                          isSel
                            ? "border-amber-300/50 bg-amber-300/10"
                            : "border-transparent hover:bg-ink/50",
                        ].join(" ")}
                      >
                        <div className="font-display text-base text-parchment">
                          {e.name}
                        </div>
                        {e.tags.length > 0 ? (
                          <div className="truncate text-xs text-parchment/50">
                            {e.tags.join(" · ")}
                          </div>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Right: the selected entry */}
            <div ref={readerRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {selected ? (
                <article>
                  <h3 className="font-display text-2xl text-parchment">
                    {selected.name}
                  </h3>
                  {selected.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selected.tags.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTag(t)}
                          className="rounded border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-200/90 hover:bg-amber-300/20"
                          title={`Show all lore tagged ${t}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4 space-y-4">
                    {selected.paragraphs.map((p, i) => (
                      <p
                        key={i}
                        className="whitespace-pre-line text-lg leading-relaxed text-parchment/85"
                      >
                        {p}
                      </p>
                    ))}
                  </div>
                </article>
              ) : null}
            </div>
          </div>
        )}
        <div className="border-t border-parchment/15 py-1 text-center font-mono text-xs uppercase tracking-wider text-parchment/50">
          ↑↓ select · J / ESC close
        </div>
      </div>
    </div>
  );
}
