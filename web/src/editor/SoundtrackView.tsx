"use client";

/**
 * Soundtrack browser — fetches /soundtrack/index.json at runtime and
 * renders tracks grouped by category with native HTML5 audio controls
 * per card. Click a track row to surface its path in the preview panel
 * (handy when filling in data fields that reference a soundtrack file
 * — e.g., a future Map.music or Encounter.theme).
 *
 * Only one track plays at a time: starting playback on one card pauses
 * any other that was playing. The native <audio controls> element
 * handles scrub/volume/loop on its own.
 *
 * The index.json file is hand-maintained for now, like sprites/index.json.
 * When the prebuild pipeline lands, this generation should move to a
 * build script next to build-module-index.mjs.
 */

import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/util/basePath";

interface SoundtrackIndex {
  _comment?: string;
  categories: Record<string, string[]>;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; index: SoundtrackIndex }
  | { kind: "error"; message: string };

export function SoundtrackView() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Track the currently-playing audio element so we can pause it when
  // another one starts.
  const playingRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setState({ kind: "loading" });
    fetch(withBasePath("/soundtrack/index.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((index: SoundtrackIndex) => setState({ kind: "ok", index }))
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, []);

  if (state.kind === "loading") {
    return <p className="p-4 text-parchment/60">Loading soundtrack…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load soundtrack.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }

  const categories = state.index.categories;
  const total = Object.values(categories).reduce(
    (n, arr) => n + arr.length,
    0,
  );
  const needle = filter.trim().toLowerCase();

  const onPlay = (el: HTMLAudioElement) => {
    if (playingRef.current && playingRef.current !== el) {
      playingRef.current.pause();
    }
    playingRef.current = el;
  };

  return (
    <div className="p-4">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-parchment">
            Soundtrack
          </h1>
          <p className="mt-1 text-sm text-parchment/60">
            {total} track{total === 1 ? "" : "s"} across{" "}
            {Object.keys(categories).length} categories · served from{" "}
            <code className="text-parchment/80">/soundtrack/</code>
          </p>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter by name…"
          className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment placeholder:text-parchment/40 focus:border-parchment/60 focus:outline-none"
        />
      </header>

      {selected && (
        <SelectedPreview
          path={selected}
          onClose={() => setSelected(null)}
        />
      )}

      <div className="mt-6 space-y-6">
        {Object.entries(categories).map(([cat, files]) => {
          const filtered = needle
            ? files.filter((f) => f.toLowerCase().includes(needle))
            : files;
          if (filtered.length === 0) return null;
          return (
            <section key={cat}>
              <h2 className="mb-2 text-xs uppercase tracking-wide text-parchment/40">
                {cat} · {filtered.length}
                {filtered.length !== files.length
                  ? ` of ${files.length}`
                  : ""}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {filtered.map((file) => {
                  const path = `/soundtrack/${cat}/${file}`;
                  const isSelected = selected === path;
                  const label = file
                    .replace(/\.(mp3|ogg|wav|m4a)$/i, "")
                    .replace(/_/g, " ");
                  return (
                    <li key={file}>
                      <div
                        className={`rounded border bg-ink/40 p-3 transition ${
                          isSelected
                            ? "border-ember/60 bg-ember/10"
                            : "border-parchment/10 hover:border-parchment/30"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelected(path)}
                          className="block w-full text-left text-sm text-parchment hover:text-parchment"
                          title="Select to see the path you can paste into a data record."
                        >
                          <span className="font-display capitalize">
                            {label}
                          </span>
                          <span className="ml-2 text-xs text-parchment/40">
                            {file}
                          </span>
                        </button>
                        <audio
                          controls
                          preload="none"
                          src={withBasePath(path)}
                          onPlay={(e) => onPlay(e.currentTarget)}
                          className="mt-2 w-full"
                        >
                          Your browser doesn&apos;t support inline audio
                          playback.
                        </audio>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SelectedPreview({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}) {
  return (
    <div className="mt-4 rounded border border-parchment/20 bg-ink/60 p-4">
      <div className="text-sm text-parchment/60">Path</div>
      <code className="break-all font-mono text-sm text-parchment">
        {path}
      </code>
      <div className="mt-3 text-xs text-parchment/50">
        Use this path in data records that reference audio. Apply
        basePath at fetch time.
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 rounded border border-parchment/20 px-3 py-1 text-xs text-parchment/80 hover:bg-ink/40"
      >
        Close
      </button>
    </div>
  );
}
