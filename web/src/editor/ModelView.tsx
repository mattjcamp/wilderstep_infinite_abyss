"use client";

/**
 * Client component that fetches one model's JSON at runtime and renders
 * a browse table (for collections) or a single-record JSON dump (for
 * singletons like Party).
 *
 * Fetching at runtime (rather than baking the data into the bundle) is
 * intentional — the editor's whole reason for being is to load fresh
 * data from /modules/<id>/ and /data/. Same path the player runtime
 * will use.
 */

import { useEffect, useState } from "react";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import { MODELS, type ModelKey } from "@/data_model/models";

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; data: unknown }
  | { kind: "error"; message: string };

export function ModelView({
  moduleId,
  modelKey,
}: {
  moduleId: string;
  modelKey: ModelKey;
}) {
  const def = MODELS[modelKey];
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const src = new StaticModuleSource();
    setState({ kind: "loading" });
    src
      .loadModel(moduleId, modelKey)
      .then((data) => setState({ kind: "ok", data }))
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, [moduleId, modelKey]);

  if (state.kind === "loading") {
    return <p className="p-4 text-parchment/60">Loading {def.label}…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load {def.label}.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }

  // Singleton — render the full JSON.
  if (def.collectionKey === null) {
    return (
      <div className="p-4">
        <Header def={def} />
        <pre className="mt-4 overflow-auto rounded bg-ink/60 p-4 text-xs text-parchment/90">
          {JSON.stringify(state.data, null, 2)}
        </pre>
      </div>
    );
  }

  // Collection — pull out the records, render the table.
  const raw = state.data as Record<string, unknown> | null;
  const records = raw && Array.isArray(raw[def.collectionKey])
    ? (raw[def.collectionKey] as Array<Record<string, unknown>>)
    : [];

  return (
    <div className="p-4">
      <Header def={def} count={records.length} />
      <div className="mt-4 overflow-auto rounded border border-parchment/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink/60 text-parchment/70">
            <tr>
              <th className="w-6 px-2 py-1"></th>
              {def.columns.map((c) => (
                <th key={c.field} className="px-2 py-1 font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => {
              const id = String(r.id ?? i);
              const isOpen = openId === id;
              return (
                <ExpandableRow
                  key={id}
                  record={r}
                  rowKey={id}
                  isOpen={isOpen}
                  onToggle={() => setOpenId(isOpen ? null : id)}
                  def={def}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Header({ def, count }: { def: (typeof MODELS)[ModelKey]; count?: number }) {
  return (
    <header className="flex items-baseline justify-between">
      <h1 className="font-display text-3xl text-parchment">{def.label}</h1>
      <div className="flex items-center gap-3 text-sm text-parchment/60">
        {count !== undefined ? <span>{count} records</span> : null}
        <span className="text-parchment/40">·</span>
        <span>{def.scope === "shared" ? "shared" : "module-scoped"}</span>
      </div>
    </header>
  );
}

function ExpandableRow({
  record,
  rowKey,
  isOpen,
  onToggle,
  def,
}: {
  record: Record<string, unknown>;
  rowKey: string;
  isOpen: boolean;
  onToggle: () => void;
  def: (typeof MODELS)[ModelKey];
}) {
  return (
    <>
      <tr
        className={`cursor-pointer border-t border-parchment/5 ${
          isOpen ? "bg-ember/10" : "hover:bg-ink/30"
        }`}
        onClick={onToggle}
      >
        <td className="px-2 py-1 text-parchment/50">{isOpen ? "▾" : "▸"}</td>
        {def.columns.map((c) => {
          const v = record[c.field];
          const display = c.format ? c.format(v) : v == null ? "" : String(v);
          return (
            <td key={c.field} className="max-w-md truncate px-2 py-1 text-parchment/90">
              {display}
            </td>
          );
        })}
      </tr>
      {isOpen && (
        <tr className="border-t border-parchment/5">
          <td></td>
          <td colSpan={def.columns.length} className="px-2 pb-3">
            <pre className="overflow-auto rounded bg-ink/60 p-3 text-xs text-parchment/85">
              {JSON.stringify(record, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
