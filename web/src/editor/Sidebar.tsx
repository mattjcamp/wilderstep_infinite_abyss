"use client";

/**
 * Editor sidebar — lists every model the editor knows about, grouped
 * by scope (per-module vs shared), plus an Assets section. The active
 * route is highlighted via usePathname() so the sidebar can stay a
 * single client component regardless of which page renders.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ALL_MODEL_KEYS, MODELS } from "@/data_model/models";

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
              : "text-parchment/85 hover:bg-ink/40 hover:text-parchment"
          }`}
        >
          {def.label}
        </Link>
      </li>
    );
  };

  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-parchment/10 bg-ink/30 p-3">
      <Link
        href="/editor"
        className="mb-1 block text-[13px] uppercase tracking-wide text-parchment/75 hover:text-parchment/85"
      >
        ← All modules
      </Link>
      <Link
        href={`/editor/${moduleId}`}
        className="mb-3 block border-b border-parchment/10 pb-2 font-display text-sm text-parchment/85 hover:text-parchment"
      >
        {moduleId}
      </Link>

      <p className="mb-1 mt-2 text-[13px] uppercase tracking-wide text-parchment/60">
        Module data
      </p>
      <ul className="mb-4 space-y-0.5">{ALL_MODEL_KEYS.map(renderLink)}</ul>

      <p className="mb-1 mt-2 text-[13px] uppercase tracking-wide text-parchment/60">
        Assets
      </p>
      <ul className="space-y-0.5">
        <li>
          <Link
            href={`/editor/${moduleId}/sprites`}
            className={`block rounded px-2 py-1 text-sm transition ${
              pathname === `/editor/${moduleId}/sprites`
                ? "bg-ember/30 text-parchment"
                : "text-parchment/85 hover:bg-ink/40 hover:text-parchment"
            }`}
          >
            Sprites
          </Link>
        </li>
        <li>
          <Link
            href={`/editor/${moduleId}/soundtrack`}
            className={`block rounded px-2 py-1 text-sm transition ${
              pathname === `/editor/${moduleId}/soundtrack`
                ? "bg-ember/30 text-parchment"
                : "text-parchment/85 hover:bg-ink/40 hover:text-parchment"
            }`}
          >
            Soundtrack
          </Link>
        </li>
      </ul>

      {/* Simulations — dedicated testbeds for in-game systems. Each
          sub-item launches a self-contained Phaser sim that exercises
          one slice of the runtime (battle screen, future
          encounter-balance / movement / lighting tests, etc.). */}
      <p className="mb-1 mt-4 text-[13px] uppercase tracking-wide text-parchment/60">
        Simulations
      </p>
      <ul className="space-y-0.5">
        <li>
          <Link
            href={`/editor/${moduleId}/sim/battle`}
            className={`block rounded px-2 py-1 text-sm transition ${
              pathname === `/editor/${moduleId}/sim/battle`
                ? "bg-ember/30 text-parchment"
                : "text-parchment/85 hover:bg-ink/40 hover:text-parchment"
            }`}
          >
            Battle
          </Link>
        </li>
      </ul>
    </aside>
  );
}
