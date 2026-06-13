/**
 * /play/mine — manage the signed-in author's published modules.
 *
 * Pure client surface on the existing backend: the worker already does
 * auth (Cloudflare Access), ownership, and `delete-module`. This lists
 * the modules whose id-handle matches the signed-in handle (from
 * /status) and offers Edit (→ editor), Play, and Delete per module,
 * plus Sign in / Sign out. No database involved.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ModuleSummary } from "@/data_model/ModuleSource";
import { getModuleSource } from "@/data_model/sourceConfig";
import { ownerHandleOf } from "@/data_model/moduleIds";
import { usePublishServer } from "@/editor/usePublishServer";
import {
  deleteModule,
  publishSignInUrl,
  publishSignOutUrl,
} from "@/data_model/publishClient";
import { editorModuleHref } from "@/editor/moduleRoutes";
import { playPartyHref } from "@/play/playRoutes";

type ListState =
  | { kind: "loading" }
  | { kind: "ok"; modules: ModuleSummary[] }
  | { kind: "error"; message: string };

function isPlayable(m: ModuleSummary): boolean {
  return m.role !== "core" && m.role !== "library";
}

export default function MyModulesPage() {
  const { available, reachable, authenticated, handle } = usePublishServer();
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || !handle) return;
    let cancelled = false;
    setList({ kind: "loading" });
    getModuleSource()
      .list()
      .then((all) => {
        if (cancelled) return;
        // All modules this handle owns (any role — library modules are
        // theirs to manage too), newest-id order as the catalog returns.
        setList({
          kind: "ok",
          modules: all.filter((m) => ownerHandleOf(m.id) === handle),
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setList({
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, handle]);

  async function onDelete(m: ModuleSummary) {
    const ok = window.confirm(
      `Delete “${m.title ?? m.id}”?\n\nThis permanently removes the published module and everything in it. It can’t be undone.`,
    );
    if (!ok) return;
    setActionError(null);
    setBusyId(m.id);
    try {
      await deleteModule(m.id);
      setList((s) =>
        s.kind === "ok"
          ? { kind: "ok", modules: s.modules.filter((x) => x.id !== m.id) }
          : s,
      );
    } catch (e) {
      setActionError(
        `Couldn’t delete ${m.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-4xl text-parchment">My Modules</h1>
          {authenticated && handle ? (
            <p className="mt-1 text-parchment/60">
              Signed in as <span className="font-mono">@{handle}</span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/play/new" className="text-parchment/60 underline hover:text-parchment">
            Browse
          </Link>
          {authenticated ? (
            <a href={publishSignOutUrl()} className="text-ember underline">
              Sign out
            </a>
          ) : null}
        </div>
      </header>

      {/* Probe in flight */}
      {available === null ? (
        <p className="text-parchment/55">Checking sign-in…</p>
      ) : !reachable ? (
        <p className="text-parchment/65">
          The publishing service isn’t reachable from this build, so module
          management isn’t available here.
        </p>
      ) : !authenticated ? (
        <div className="flex flex-col gap-3">
          <p className="text-parchment/70">
            Sign in to see and manage the modules you’ve published.
          </p>
          <a
            href={publishSignInUrl()}
            className="self-start rounded-md border border-ember/50 px-4 py-2 text-sm text-ember hover:bg-ember/10"
          >
            Sign in
          </a>
        </div>
      ) : !handle ? (
        <p className="text-parchment/65">
          Module management needs the hosted publishing service (no author
          handle was resolved for this session).
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          {actionError ? (
            <p className="rounded-md border border-ember/40 bg-ember/10 px-3 py-2 text-sm text-ember">
              {actionError}
            </p>
          ) : null}

          {list.kind === "loading" ? (
            <p className="text-parchment/55">Loading your modules…</p>
          ) : list.kind === "error" ? (
            <p className="text-ember/85">
              Couldn’t load your modules: {list.message}
            </p>
          ) : list.modules.length === 0 ? (
            <p className="text-parchment/65">
              You haven’t published any modules yet.{" "}
              <Link href="/editor" className="text-ember underline">
                Open the editor
              </Link>{" "}
              to create one.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.modules.map((m) => (
                <li
                  key={m.id}
                  className="rounded-md border border-parchment/20 bg-ink/40 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-display text-xl text-parchment">
                        {m.title ?? m.id}
                      </div>
                      {m.description ? (
                        <div className="mt-1 text-sm text-parchment/70">
                          {m.description}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-parchment/45">
                        {m.version ? <span>v{m.version}</span> : null}
                        {m.role ? <span>{m.role}</span> : null}
                        <span className="font-mono">{m.id}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-stretch gap-2 text-sm">
                      <Link
                        href={editorModuleHref(m.id)}
                        className="rounded border border-parchment/30 px-3 py-1 text-center text-parchment/80 hover:border-parchment/60 hover:text-parchment"
                      >
                        Edit
                      </Link>
                      {isPlayable(m) ? (
                        <Link
                          href={playPartyHref(m.id)}
                          className="rounded border border-parchment/30 px-3 py-1 text-center text-parchment/80 hover:border-parchment/60 hover:text-parchment"
                        >
                          Play
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onDelete(m)}
                        disabled={busyId === m.id}
                        className="rounded border border-ember/40 px-3 py-1 text-center text-ember hover:bg-ember/10 disabled:opacity-50"
                      >
                        {busyId === m.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
