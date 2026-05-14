"use client";

/**
 * Editor sidebar — lists every model the editor knows about, grouped
 * by scope (per-module vs shared). The active route is highlighted via
 * usePathname() so the sidebar can stay a single client component
 * regardless of which model page is rendered.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODELS, MODULE_MODELS, SHARED_MODELS } from "@/data_model/models";

export function Sidebar({ moduleId }: { moduleId: string }) {
  const pathname = usePathname();

  const renderLink = (key: keyof typeof MODELS) => {
    const def = MODELS[key];
    const href = `/editor/${moduleId}/${key}`;
    const active = pathname === href;
    return (
      <li key={key}>
        <Link
          href={href}
          className={`block rounded px-2 py-1 text-sm transition ${
            active
              ? "bg-ember/30 text-parchment"
              : "text-parchment/70 hover:bg-ink/40 hover:text-parchment"
          }`}
        >
          {def.label}
        </Link>
      </li>
    );
  };

  return (
    <aside className="w-56 shrink-0 border-r border-parchment/10 bg-ink/30 p-3">
      <Link
        href={`/editor/${moduleId}`}
        className="mb-3 block text-xs uppercase tracking-wide text-parchment/50 hover:text-parchment/80"
      >
        ← {moduleId}
      </Link>

      <p className="mb-1 mt-2 text-xs uppercase tracking-wide text-parchment/40">
        Module data
      </p>
      <ul className="mb-4 space-y-0.5">{MODULE_MODELS.map(renderLink)}</ul>

      <p className="mb-1 mt-2 text-xs uppercase tracking-wide text-parchment/40">
        Shared
      </p>
      <ul className="mb-4 space-y-0.5">{SHARED_MODELS.map(renderLink)}</ul>

      <p className="mb-1 mt-2 text-xs uppercase tracking-wide text-parchment/40">
        Assets
      </p>
      <ul className="space-y-0.5">
        <li>
          <Link
            href={`/editor/${moduleId}/sprites`}
            className={`block rounded px-2 py-1 text-sm transition ${
              pathname === `/editor/${moduleId}/sprites`
                ? "bg-ember/30 text-parchment"
                : "text-parchment/70 hover:bg-ink/40 hover:text-parchment"
            }`}
          >
            Sprites
          </Link>
        </li>
      </ul>

      <div className="mt-6 border-t border-parchment/10 pt-3">
        <Link
          href="/editor"
          className="block text-xs text-parchment/50 hover:text-parchment/80"
        >
          ← All modules
        </Link>
      </div>
    </aside>
  );
}
