"use client";

/**
 * Editor sidebar — lists every model the editor knows about, grouped
 * by scope (per-module vs shared), plus Assets + Simulations. The
 * active item is highlighted from the current query-param route:
 * `/editor/model?k=<key>` for models, and pathname alone for the
 * sprites/soundtrack/battle pages.
 */

import {
  editorModuleHref,
  editorModelHref,
  editorSpritesHref,
  editorSoundtrackHref,
  editorBattleSimHref,
} from "./moduleRoutes";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ALL_MODEL_KEYS, MODELS } from "@/data_model/models";

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
  // Model links live at /editor/model?k=<key>; highlight the one whose
  // key matches the current query (only when actually on the model
  // route).
  const activeModelKey =
    pathname === "/editor/model" ? searchParams.get("k") : null;

  const renderLink = (key: keyof typeof MODELS) => {
    const def = MODELS[key];
    return (
      <li key={key}>
        <Link
          href={editorModelHref(moduleId, key)}
          className={linkClass(activeModelKey === key)}
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
        href={editorModuleHref(moduleId)}
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
            href={editorSpritesHref(moduleId)}
            className={linkClass(pathname === "/editor/sprites")}
          >
            Sprites
          </Link>
        </li>
        <li>
          <Link
            href={editorSoundtrackHref(moduleId)}
            className={linkClass(pathname === "/editor/soundtrack")}
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
            href={editorBattleSimHref(moduleId)}
            className={linkClass(pathname === "/editor/sim/battle")}
          >
            Battle
          </Link>
        </li>
      </ul>
    </aside>
  );
}
