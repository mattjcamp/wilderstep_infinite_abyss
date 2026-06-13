"use client";

/**
 * Live module list for the /play/new picker. Loads through the
 * configured module source, so:
 *
 *   - static mode (default): same modules the old build-time list
 *     showed, plus any not-yet-built additions the static index
 *     knows about
 *   - remote mode: the HOSTED catalog — player-published
 *     `@handle/slug` modules appear next to the shipped ones
 *
 * Filtering matches ModuleSummary.role's contract: core + library
 * are excluded; an omitted/blank role counts as playable.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ModuleSummary } from "@/data_model/ModuleSource";
import { getModuleSource } from "@/data_model/sourceConfig";
import { playPartyHref } from "@/play/playRoutes";

function isPlayable(m: ModuleSummary): boolean {
  return m.role !== "core" && m.role !== "library";
}

export function ModulePickerList() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; modules: ModuleSummary[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    getModuleSource()
      .list()
      .then((all) => {
        if (!cancelled) {
          setState({ kind: "ok", modules: all.filter(isPlayable) });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Which catalog this build is wired to — NEXT_PUBLIC_* values are
  // inlined at compile time, so this badge reports what the BUNDLE
  // believes, which is exactly what we need when debugging mode
  // switches (and useful context for players later).
  const sourceBadge =
    process.env.NEXT_PUBLIC_MODULE_SOURCE === "remote"
      ? `hosted catalog (${process.env.NEXT_PUBLIC_READ_HOST ?? "no host!"})`
      : "local modules";

  if (state.kind === "loading") {
    return <p className="text-parchment/55">Loading modules…</p>;
  }
  if (state.kind === "error") {
    return (
      <p className="text-ember/85">
        Couldn&apos;t load the module catalog: {state.message}
      </p>
    );
  }
  if (state.modules.length === 0) {
    return (
      <p className="text-parchment/65">
        No playable modules are installed. Add a module under
        <code className="mx-1 rounded bg-ink/60 px-1 py-0.5 text-xs">
          public/modules/&lt;id&gt;/module.json
        </code>
        with{" "}
        <code className="mx-1 rounded bg-ink/60 px-1 py-0.5 text-xs">
          role: &quot;playable&quot;
        </code>
        and refresh.
      </p>
    );
  }
  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-3">
      <p className="text-xs text-parchment/40">{sourceBadge}</p>
    <ul className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      {state.modules.map((m) => (
        <li key={m.id}>
          <Link
            href={playPartyHref(m.id)}
            className="block rounded-md border border-parchment/20 bg-ink/40 p-4 transition hover:border-parchment/40 hover:bg-ink/30"
          >
            <div className="font-display text-xl text-parchment">
              {m.title ?? m.id}
            </div>
            {m.description ? (
              <div className="mt-1 text-sm text-parchment/70">
                {m.description}
              </div>
            ) : null}
            <div className="mt-2 flex gap-3 text-xs text-parchment/45">
              {m.author ? <span>by {m.author}</span> : null}
              {m.version ? <span>v{m.version}</span> : null}
              <span className="font-mono">{m.id}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
    </div>
  );
}
