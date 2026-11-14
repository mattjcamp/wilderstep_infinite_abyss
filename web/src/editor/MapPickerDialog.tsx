"use client";

/**
 * Shared map picker for every editor that points at a map (Map Editor
 * Link / Pressure Plate, quest steps / triggers / Travel / tile ops,
 * party start position, spawn + encounter custom arenas).
 *
 *   <MapPickerField value onChange maps tagOrder … />
 *
 * renders a full-width trigger button showing the current choice; it
 * opens <MapPickerDialog>, a large centred dialog laid out like the
 * Maps browse screen: a search box, Expand / Collapse all, and the same
 * nested, collapsible tag tree (Hallowmere › House …) in the module's
 * pinned tag order. Clicking a map picks it and closes the dialog.
 *
 * The dialog renders through a portal so it isn't clipped by the
 * narrow, scrolling side panels many of these fields live in.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalKeyLock } from "@/play/modalKeyLock";
import {
  buildTagTree,
  collectTagPaths,
  isTagPinned,
  normalizeTag,
  PINNED_TAGS,
  tagAncestors,
  tagLabel,
  tagNodeRecords,
  UNTAGGED,
  type TagNode,
} from "./mapTags";

/** The bits of a map record the picker shows. */
export interface PickableMap {
  id: string;
  name?: string;
  tags?: string[];
  width?: number;
  height?: number;
  description?: string;
  /** Optional short note shown on the row (e.g. "hidden — no links in"). */
  note?: string;
}

function mapMatches(m: PickableMap, q: string): boolean {
  if (!q) return true;
  const hay = [m.name ?? "", m.id, ...(m.tags ?? []), m.description ?? ""]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Module tag order for pickers that don't get one as a prop — a
 *  browse screen provides it once (`<MapTagOrderContext.Provider
 *  value={effectiveTagOrder(mapsFile)}>`) instead of threading it
 *  through every nested editor. */
export const MapTagOrderContext = createContext<ReadonlyArray<string>>(PINNED_TAGS);

// ── Trigger field ───────────────────────────────────────────────────

export function MapPickerField({
  value,
  onChange,
  maps,
  tagOrder: tagOrderProp,
  title = "Choose a map",
  allowNone = false,
  noneLabel = "(none)",
  noneHint,
  placeholder = "— choose a map —",
  className = "",
}: {
  value: string;
  onChange: (id: string) => void;
  maps: ReadonlyArray<PickableMap>;
  /** Module tag order (maps.json `tag_order`) — pinned groups first. */
  tagOrder?: ReadonlyArray<string>;
  /** Dialog heading, e.g. "Link target map". */
  title?: string;
  /** Offer a "none" choice (and a ✕ clear button) that sets "". */
  allowNone?: boolean;
  noneLabel?: string;
  noneHint?: string;
  placeholder?: string;
  className?: string;
}) {
  const contextOrder = useContext(MapTagOrderContext);
  const tagOrder = tagOrderProp ?? contextOrder;
  const [open, setOpen] = useState(false);
  const current = value ? maps.find((m) => m.id === value) ?? null : null;
  const firstTag = current?.tags?.map(normalizeTag).find(Boolean);
  return (
    <div className={`flex min-w-0 items-stretch gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={value ? `${title} — currently ${value}` : title}
        className="flex min-w-0 flex-1 items-center gap-2 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-left text-[13px] text-parchment/90 hover:border-parchment/50 hover:bg-ink/70 focus:border-parchment/60 focus:outline-none"
      >
        <span aria-hidden className="shrink-0 text-parchment/60">
          🗺
        </span>
        {!value ? (
          <span className="truncate text-parchment/60">
            {allowNone ? noneLabel : placeholder}
          </span>
        ) : current ? (
          <span className="min-w-0 flex-1 truncate">
            <span className="font-display">{current.name ?? current.id}</span>
            <span className="ml-1.5 font-mono text-[12px] text-parchment/60">
              {current.id}
            </span>
            {firstTag ? (
              <span className="ml-1.5 text-[12px] text-parchment/50">
                · {tagLabel(firstTag)}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ember/90">
            (missing) <span className="font-mono">{value}</span> ⚠
          </span>
        )}
        <span aria-hidden className="ml-auto shrink-0 text-parchment/50">
          ⋯
        </span>
      </button>
      {allowNone && value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="shrink-0 rounded border border-parchment/20 px-2 text-[13px] text-parchment/80 hover:bg-ink/40"
          title={`Clear — ${noneLabel}${noneHint ? ` ${noneHint}` : ""}`}
        >
          ✕
        </button>
      ) : null}
      {open ? (
        <MapPickerDialog
          title={title}
          value={value}
          maps={maps}
          tagOrder={tagOrder}
          allowNone={allowNone}
          noneLabel={noneLabel}
          noneHint={noneHint}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────

export function MapPickerDialog({
  title,
  value,
  maps,
  tagOrder,
  allowNone,
  noneLabel,
  noneHint,
  onPick,
  onClose,
}: {
  title: string;
  value: string;
  maps: ReadonlyArray<PickableMap>;
  tagOrder: ReadonlyArray<string>;
  allowNone: boolean;
  noneLabel: string;
  noneHint?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  // Own the keyboard while open so screens underneath that listen on
  // window (the Party screen's ↑↓ / Enter / Esc) stay out of the way.
  useModalKeyLock();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const tree = useMemo(() => buildTagTree(maps, tagOrder), [maps, tagOrder]);
  const current = value ? maps.find((m) => m.id === value) ?? null : null;

  // Open the groups holding the current map so it's visible on arrival.
  const [openTags, setOpenTags] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const tags =
      current?.tags && current.tags.some((t) => normalizeTag(t))
        ? current.tags
        : current
          ? [UNTAGGED]
          : [];
    for (const t of tags) {
      for (const p of t === UNTAGGED ? [UNTAGGED] : tagAncestors(t)) {
        s.add(p.toLowerCase());
      }
    }
    return s;
  });
  const toggle = (path: string) =>
    setOpenTags((prev) => {
      const next = new Set(prev);
      const k = path.toLowerCase();
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const q = query.trim();
  const matches = useMemo(
    () => (q ? maps.filter((m) => mapMatches(m, q)) : null),
    [maps, q],
  );
  // While searching, show a tree of just the matches, fully expanded.
  const shownTree = useMemo(
    () => (matches ? buildTagTree(matches, tagOrder) : tree),
    [matches, tree, tagOrder],
  );
  const isOpen = (path: string) =>
    matches !== null || openTags.has(path.toLowerCase());

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Bring the current map's row into view once.
  const currentRowRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: "center" });
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
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-parchment/10 px-5 py-3">
          <h2 className="font-display text-2xl text-parchment">{title}</h2>
          <span className="text-sm text-parchment/60">
            {matches ? `${matches.length} of ${maps.length}` : maps.length} map
            {maps.length === 1 ? "" : "s"}
          </span>
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches && matches.length === 1) {
                e.preventDefault();
                onPick(matches[0].id);
              }
            }}
            placeholder="Search name, id, tag or description…"
            className="min-w-[16rem] flex-1 rounded border border-parchment/20 bg-ink/50 px-3 py-1.5 text-sm text-parchment/90 focus:border-parchment/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={() =>
              setOpenTags(
                new Set(collectTagPaths(tree).map((p) => p.toLowerCase())),
              )
            }
            disabled={matches !== null}
            className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/75 hover:bg-ink/40 disabled:opacity-40"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setOpenTags(new Set())}
            disabled={matches !== null}
            className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/75 hover:bg-ink/40 disabled:opacity-40"
          >
            Collapse all
          </button>
        </div>

        {/* Tree */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {allowNone ? (
            <button
              type="button"
              onClick={() => onPick("")}
              className={`mb-3 flex w-full items-baseline gap-2 rounded border px-3 py-2 text-left text-sm ${
                value === ""
                  ? "border-ember/60 bg-ember/25 text-parchment"
                  : "border-parchment/10 bg-ink/20 text-parchment/85 hover:border-parchment/40 hover:bg-ink/50"
              }`}
            >
              <span className="font-mono">{noneLabel}</span>
              {noneHint ? (
                <span className="text-[13px] text-parchment/60">{noneHint}</span>
              ) : null}
            </button>
          ) : null}
          {value && !current ? (
            <p className="mb-3 rounded border border-ember/40 bg-ember/10 px-3 py-2 text-[13px] text-parchment/85">
              Current value <span className="font-mono">{value}</span> isn&apos;t
              a map in this module.
            </p>
          ) : null}
          {shownTree.length === 0 ? (
            <p className="text-sm text-parchment/65">
              {q ? `No maps match “${q}”.` : "No maps in this module."}
            </p>
          ) : (
            <div className="space-y-2">
              {shownTree.map((node) => (
                <PickerGroup
                  key={node.path}
                  node={node}
                  depth={0}
                  tagOrder={tagOrder}
                  value={value}
                  isOpen={isOpen}
                  onToggle={toggle}
                  onPick={onPick}
                  currentRowRef={currentRowRef}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PickerGroup({
  node,
  depth,
  tagOrder,
  value,
  isOpen,
  onToggle,
  onPick,
  currentRowRef,
}: {
  node: TagNode<PickableMap>;
  depth: number;
  tagOrder: ReadonlyArray<string>;
  value: string;
  isOpen: (path: string) => boolean;
  onToggle: (path: string) => void;
  onPick: (id: string) => void;
  currentRowRef: React.MutableRefObject<HTMLButtonElement | null>;
}) {
  const open = isOpen(node.path);
  const pinned = node.path !== UNTAGGED && isTagPinned(tagOrder, node.path);
  const all = tagNodeRecords(node);
  const holdsCurrent = !!value && all.some((m) => m.id === value);
  return (
    <section style={{ paddingLeft: depth ? 16 : 0 }}>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[13px] uppercase tracking-wide text-parchment/70 hover:bg-ink/40 hover:text-parchment/90"
      >
        <span className="text-parchment/75">{open ? "▾" : "▸"}</span>
        {pinned ? <span aria-label="pinned">📌</span> : null}
        <span className="truncate">{node.label}</span>
        <span className="normal-case tracking-normal text-parchment/55">
          ({all.length})
        </span>
        {holdsCurrent && !open ? (
          <span className="normal-case tracking-normal text-ember/80">
            · current
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-1 space-y-2">
          {node.children.map((c) => (
            <PickerGroup
              key={c.path}
              node={c}
              depth={1}
              tagOrder={tagOrder}
              value={value}
              isOpen={isOpen}
              onToggle={onToggle}
              onPick={onPick}
              currentRowRef={currentRowRef}
            />
          ))}
          {node.records.length > 0 ? (
            <ul className="divide-y divide-parchment/5 rounded border border-parchment/10 bg-ink/20">
              {node.records.map((m) => {
                const active = m.id === value;
                const others = (m.tags ?? [])
                  .map(normalizeTag)
                  .filter(
                    (t) => t && t.toLowerCase() !== node.path.toLowerCase(),
                  );
                return (
                  <li key={`${node.path}::${m.id}`}>
                    <button
                      type="button"
                      ref={active ? currentRowRef : undefined}
                      onClick={() => onPick(m.id)}
                      className={`flex w-full flex-col px-3 py-2 text-left text-sm transition ${
                        active
                          ? "bg-ember/25 text-parchment"
                          : "text-parchment hover:bg-ink/50"
                      }`}
                    >
                      <span className="truncate">
                        <span className="font-display">{m.name ?? m.id}</span>
                        <span className="ml-2 font-mono text-[13px] text-parchment/65">
                          {m.id}
                        </span>
                        {typeof m.width === "number" &&
                        typeof m.height === "number" ? (
                          <span className="ml-2 text-[13px] text-parchment/60">
                            {m.width}×{m.height}
                          </span>
                        ) : null}
                        {others.length > 0 ? (
                          <span className="ml-2 text-[13px] text-parchment/60">
                            also: {others.map(tagLabel).join(", ")}
                          </span>
                        ) : null}
                        {m.note ? (
                          <span className="ml-2 text-[13px] text-amber-200/80">
                            {m.note}
                          </span>
                        ) : null}
                        {active ? (
                          <span className="ml-2 text-[12px] uppercase tracking-wide text-ember/90">
                            current
                          </span>
                        ) : null}
                      </span>
                      {m.description ? (
                        <span className="mt-0.5 line-clamp-1 text-[12px] text-parchment/55">
                          {m.description}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
