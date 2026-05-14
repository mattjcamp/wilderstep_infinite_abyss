"use client";

/**
 * Module picker — fetches the list of known modules at runtime via
 * StaticModuleSource and renders a card per module. Clicking a card
 * routes to /editor/[moduleId].
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import type { ModuleSummary } from "@/data_model/ModuleSource";

type State =
  | { kind: "loading" }
  | { kind: "ok"; modules: ModuleSummary[] }
  | { kind: "error"; message: string };

export function ModulePicker() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const src = new StaticModuleSource();
    src
      .list()
      .then((modules) => setState({ kind: "ok", modules }))
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, []);

  if (state.kind === "loading") {
    return <p className="text-parchment/60">Loading modules…</p>;
  }
  if (state.kind === "error") {
    return (
      <div>
        <p className="text-ember">Failed to list modules.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }
  if (state.modules.length === 0) {
    return <p className="text-parchment/60">No modules found.</p>;
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {state.modules.map((m) => (
        <li key={m.id}>
          <Link
            href={`/editor/${m.id}`}
            className="block rounded-md border border-parchment/20 bg-ink/40 p-4 transition hover:border-parchment/40 hover:bg-ink/60"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-xl text-parchment">{m.title}</h2>
              <span className="text-xs uppercase tracking-wide text-parchment/40">
                v{m.version}
              </span>
            </div>
            <p className="mt-1 text-sm text-parchment/70">{m.description}</p>
            <div className="mt-3 flex items-center gap-3 text-xs text-parchment/50">
              <span>id: {m.id}</span>
              {m.author ? <span>by {m.author}</span> : null}
              {m.role ? (
                <span className="rounded bg-ember/30 px-2 py-0.5 text-parchment/90">
                  {m.role}
                </span>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
