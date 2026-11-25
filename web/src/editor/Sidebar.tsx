"use client";

/**
 * Editor sidebar — lists every editor in Dungeon Master Mode, grouped
 * World / Enemies / Assets / Players / Simulations (see editorNav.ts,
 * shared with the module landing page). The active item is highlighted
 * from the current route: `/editor/model?k=<key>` for models, and
 * pathname alone for the sprites / soundtrack / battle pages.
 */

import { editorModuleHref } from "./moduleRoutes";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  EDITOR_NAV_GROUPS,
  isNavEntryActive,
  navEntryInfo,
} from "./editorNav";

function linkClass(active: boolean): string {
  return `block rounded px-2 py-1 text-sm transition ${
    active
      ? "bg-ember/30 text-parchment"
      : "text-parchment/85 hover:bg-ink/40 hover:text-parchment"
  }`;
}

export function Sidebar({ moduleId }: { moduleId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const modelKeyParam = searchParams.get("k");

  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-parchment/10 bg-ink/30 p-3">
      <Link
        href="/editor"
        className="mb-1 block text-[13px] uppercase tracking-wide text-parchment/75 hover:text-parchment/85"
      >
        ← All modules
      </Link>
      <Link
        href={editorModuleHref(moduleId)}
        className="mb-3 block border-b border-parchment/10 pb-2 font-display text-sm text-parchment/85 hover:text-parchment"
      >
        {moduleId}
      </Link>

      {EDITOR_NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-4">
          <p className="mb-1 mt-2 text-[13px] uppercase tracking-wide text-parchment/60">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.entries.map((entry) => {
              const info = navEntryInfo(entry, moduleId);
              return (
                <li key={info.id}>
                  <Link
                    href={info.href}
                    className={linkClass(
                      isNavEntryActive(entry, pathname, modelKeyParam),
                    )}
                  >
                    {info.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}
