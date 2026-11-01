"use client";

/**
 * Collapsible folder tree for sprites. Layout comes solely from each
 * sprite's folder under `sprites/` (see spriteTree.ts): one row per
 * folder with a ▸/▾ toggle and a sprite count, that folder's own sprites
 * in a grid, then its subfolders indented beneath it.
 *
 * Collapse state lives in `useCollapsedFolders` (remembered per browser
 * under a storage key). While `forceOpen` is set — e.g. a name filter is
 * active — every folder with matches shows open.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { countSprites, type SpriteTreeNode } from "./spriteTree";

export interface CollapsedFolders {
  isCollapsed: (path: string) => boolean;
  toggle: (path: string) => void;
  setMany: (paths: string[], collapsed: boolean) => void;
}

/** Collapsed folder paths, persisted to localStorage under `storageKey`.
 *  Folders start expanded unless `defaultCollapsed` is true. */
export function useCollapsedFolders(
  storageKey: string,
  defaultCollapsed = false,
): CollapsedFolders {
  // Stored as the set of folders that differ from the default.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setFlipped(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* storage unavailable — start from defaults */
    }
  }, [storageKey]);

  const save = (next: Set<string>) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
    return next;
  };

  const isCollapsed = useCallback(
    (path: string) => flipped.has(path) !== defaultCollapsed,
    [flipped, defaultCollapsed],
  );

  const setMany = useCallback(
    (paths: string[], collapsed: boolean) =>
      setFlipped((prev) => {
        const next = new Set(prev);
        for (const p of paths) {
          if (collapsed !== defaultCollapsed) next.add(p);
          else next.delete(p);
        }
        return save(next);
      }),
    [defaultCollapsed, storageKey],
  );

  const toggle = useCallback(
    (path: string) =>
      setFlipped((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return save(next);
      }),
    [storageKey],
  );

  return { isCollapsed, toggle, setMany };
}

export function SpriteFolderTree({
  root,
  collapsed,
  forceOpen = false,
  totals,
  gridClassName,
  renderSprite,
  compact = false,
}: {
  root: SpriteTreeNode;
  collapsed: CollapsedFolders;
  /** Show every folder open (e.g. while filtering) without changing
   *  the remembered collapse state. */
  forceOpen?: boolean;
  /** Unfiltered tree, for "n of m" counts while filtering. */
  totals?: SpriteTreeNode;
  /** Tailwind grid classes for each folder's sprite grid. */
  gridClassName: string;
  /** Render one sprite tile (`path` is the full path under sprites/). */
  renderSprite: (path: string) => ReactNode;
  compact?: boolean;
}) {
  const totalsByPath = new Map<string, number>();
  if (totals) {
    const walk = (n: SpriteTreeNode) => {
      totalsByPath.set(n.path, countSprites(n));
      n.children.forEach(walk);
    };
    walk(totals);
  }

  const renderFolder = (node: SpriteTreeNode, depth: number): ReactNode => {
    const open = forceOpen || !collapsed.isCollapsed(node.path);
    const shown = countSprites(node);
    const total = totalsByPath.get(node.path);
    return (
      <section
        key={node.path}
        className={depth > 0 ? "ml-2 border-l border-parchment/10 pl-3" : ""}
      >
        <button
          type="button"
          onClick={() => collapsed.toggle(node.path)}
          aria-expanded={open}
          title={node.path}
          className={[
            "flex w-full items-center gap-1.5 rounded px-1 text-left uppercase tracking-wide hover:bg-ink/40",
            compact ? "py-0.5 text-xs" : "py-1 text-[13px]",
            depth === 0 ? "text-parchment/80" : "text-parchment/60",
          ].join(" ")}
        >
          <span className="inline-block w-3 text-parchment/50">
            {open ? "▾" : "▸"}
          </span>
          <span>{node.name}</span>
          <span className="normal-case text-parchment/40">
            · {shown}
            {total !== undefined && total !== shown ? ` of ${total}` : ""}
          </span>
        </button>
        {open ? (
          <div className={compact ? "mt-1 space-y-1.5" : "mt-1 space-y-3"}>
            {node.files.length > 0 ? (
              <ul className={gridClassName}>
                {node.files.map((p) => (
                  <li key={p}>{renderSprite(p)}</li>
                ))}
              </ul>
            ) : null}
            {node.children.map((c) => renderFolder(c, depth + 1))}
          </div>
        ) : null}
      </section>
    );
  };

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {root.children.map((c) => renderFolder(c, 0))}
    </div>
  );
}

/** Small "Expand all / Collapse all" control pair. */
export function TreeToggleAll({
  onExpand,
  onCollapse,
}: {
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const cls =
    "rounded border border-parchment/20 px-2 py-1 text-xs text-parchment/80 hover:bg-ink/40";
  return (
    <span className="flex gap-1">
      <button type="button" onClick={onExpand} className={cls} title="Expand all folders">
        Expand all
      </button>
      <button type="button" onClick={onCollapse} className={cls} title="Collapse all folders">
        Collapse all
      </button>
    </span>
  );
}
