"use client";

/**
 * Soundtrack browser + volume mixer — fetches /audio/index.json at
 * runtime and renders every track with native HTML5 audio controls
 * per card. Click a track row to surface its path in the preview
 * panel (handy when filling in data fields that reference a track —
 * e.g. a module / map / dungeon `soundtrack` list).
 *
 * This reads the SAME catalog the SoundtrackPicker and the in-game
 * SoundtrackPlayer use (/audio/index.json, a flat
 * `tracks: [{ path, name?, gain? }]` list), so what you see here is
 * exactly what's selectable in the Module Properties dialog. Audio
 * files live in web/public/audio/.
 *
 * Per-track volume: each card has a gain slider (0–100%). Lowering it
 * tames a track that's mastered louder than the rest of the
 * soundtrack — the preview player auditions at that level so you can
 * match tracks by ear. Gain is stored back into index.json (via the
 * publish-server's `audio-index` op) and the in-game player folds it
 * into playback as `userVolume * trackGain`. Saving requires the
 * local publish-server (started by `npm run dev:all`); without it the
 * sliders still preview but can't persist.
 *
 * Only one track plays at a time: starting playback on one card pauses
 * any other that was playing.
 */

import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/util/basePath";
import { publishItems } from "@/data_model/publishClient";
import { usePublishServer } from "./usePublishServer";

interface AudioTrack {
  path: string;
  name?: string;
  gain?: number;
}

interface AudioIndex {
  _comment?: string;
  tracks: AudioTrack[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; tracks: AudioTrack[] }
  | { kind: "error"; message: string };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Normalise a track's gain to [0,1], defaulting to 1 (full). */
function gainOf(t: AudioTrack): number {
  return typeof t.gain === "number" && Number.isFinite(t.gain)
    ? clamp01(t.gain)
    : 1;
}

export function SoundtrackView() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Working gain values, keyed by track path. Seeded from the loaded
  // catalog; edited by the sliders.
  const [gains, setGains] = useState<Record<string, number>>({});
  // The last-persisted gains, so we can tell whether there are unsaved
  // changes (and reset cleanly after a save).
  const [savedGains, setSavedGains] = useState<Record<string, number>>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const { available } = usePublishServer();

  // Live handles to the per-card <audio> elements so a slider drag
  // updates the audition volume immediately while a track is playing.
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const playingRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setState({ kind: "loading" });
    fetch(withBasePath("/audio/index.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((index: AudioIndex) => {
        const tracks = Array.isArray(index.tracks)
          ? index.tracks.filter(
              (t): t is AudioTrack =>
                !!t && typeof t.path === "string" && t.path.length > 0,
            )
          : [];
        const seeded: Record<string, number> = {};
        for (const t of tracks) seeded[t.path] = gainOf(t);
        setGains(seeded);
        setSavedGains(seeded);
        setState({ kind: "ok", tracks });
      })
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, []);

  if (state.kind === "loading") {
    return <p className="p-4 text-parchment/80">Loading soundtrack…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load soundtrack.</p>
        <p className="mt-2 font-mono text-sm text-parchment/80">
          {state.message}
        </p>
      </div>
    );
  }

  const needle = filter.trim().toLowerCase();
  const basename = (p: string) => p.split("/").pop() ?? p;
  const labelFor = (t: AudioTrack) =>
    t.name && t.name.length > 0
      ? t.name
      : basename(t.path)
          .replace(/\.(mp3|ogg|wav|m4a)$/i, "")
          .replace(/_/g, " ");

  const allTracks = state.tracks;
  const tracks = needle
    ? allTracks.filter(
        (t) =>
          labelFor(t).toLowerCase().includes(needle) ||
          t.path.toLowerCase().includes(needle),
      )
    : allTracks;

  const dirty = allTracks.some(
    (t) => (gains[t.path] ?? 1) !== (savedGains[t.path] ?? 1),
  );

  const onPlay = (el: HTMLAudioElement, path: string) => {
    if (playingRef.current && playingRef.current !== el) {
      playingRef.current.pause();
    }
    el.volume = clamp01(gains[path] ?? 1);
    playingRef.current = el;
  };

  const setGain = (path: string, v: number) => {
    const next = clamp01(v);
    setGains((g) => ({ ...g, [path]: next }));
    // Update the audition volume live if this track is loaded.
    const el = audioRefs.current.get(path);
    if (el) el.volume = next;
    if (saveState.kind !== "idle") setSaveState({ kind: "idle" });
  };

  const resetGains = () => {
    setGains(savedGains);
    for (const [path, el] of audioRefs.current) {
      el.volume = clamp01(savedGains[path] ?? 1);
    }
    setSaveState({ kind: "idle" });
  };

  const save = async () => {
    setSaveState({ kind: "saving" });
    try {
      const payload = allTracks.map((t) => {
        const g = clamp01(gains[t.path] ?? 1);
        const out: AudioTrack = { path: t.path };
        if (t.name) out.name = t.name;
        if (g !== 1) out.gain = g;
        return out;
      });
      const res = await publishItems([{ kind: "audio-index", tracks: payload }]);
      const failed = res.results.find((r) => !r.ok);
      if (failed) throw new Error(failed.error ?? "publish failed");
      setSavedGains({ ...gains });
      setSaveState({ kind: "saved" });
    } catch (e: unknown) {
      setSaveState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div className="p-4">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-parchment">
            Soundtrack
          </h1>
          <p className="mt-1 text-sm text-parchment/80">
            {tracks.length}
            {needle ? ` of ${allTracks.length}` : ""} track
            {allTracks.length === 1 ? "" : "s"} · served from{" "}
            <code className="text-parchment/80">/audio/</code>
          </p>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter by name…"
          className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment placeholder:text-parchment/60 focus:border-parchment/60 focus:outline-none"
        />
      </header>

      <SaveBar
        available={available}
        dirty={dirty}
        saveState={saveState}
        onSave={save}
        onReset={resetGains}
      />

      {selected && (
        <SelectedPreview
          path={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {allTracks.length === 0 ? (
        <p className="mt-6 text-sm text-parchment/70">
          No tracks in <code className="text-parchment/80">/audio/index.json</code> yet
          — drop files in <code className="text-parchment/80">web/public/audio/</code>{" "}
          and run <code className="text-parchment/80">npm run reindex-audio</code>.
        </p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {tracks.map((track) => {
            const path = track.path;
            const isSelected = selected === path;
            const label = labelFor(track);
            const gain = gains[path] ?? 1;
            const pct = Math.round(gain * 100);
            return (
              <li key={path}>
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
                    <span className="font-display">{label}</span>
                    <span className="ml-2 text-[13px] text-parchment/60">
                      {basename(path)}
                    </span>
                  </button>

                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className="text-[13px] text-parchment/60"
                      title="Track volume: attenuates this track relative to the rest of the soundtrack. Applied in-game and to the preview below."
                    >
                      vol
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={gain}
                      onChange={(e) => setGain(path, Number(e.target.value))}
                      className="h-1 flex-1 accent-ember"
                      aria-label={`${label} volume`}
                    />
                    <span
                      className={`w-10 text-right font-mono text-[13px] ${
                        gain !== (savedGains[path] ?? 1)
                          ? "text-ember"
                          : "text-parchment/70"
                      }`}
                    >
                      {pct}%
                    </span>
                  </div>

                  <audio
                    ref={(el) => {
                      if (el) {
                        el.volume = clamp01(gains[path] ?? 1);
                        audioRefs.current.set(path, el);
                      } else {
                        audioRefs.current.delete(path);
                      }
                    }}
                    controls
                    preload="none"
                    src={withBasePath(path)}
                    onPlay={(e) => onPlay(e.currentTarget, path)}
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
      )}
    </div>
  );
}

function SaveBar({
  available,
  dirty,
  saveState,
  onSave,
  onReset,
}: {
  available: boolean | null;
  dirty: boolean;
  saveState: SaveState;
  onSave: () => void;
  onReset: () => void;
}) {
  // Probing — say nothing until we know whether saving is possible.
  if (available === null && !dirty) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded border border-parchment/10 bg-ink/30 px-3 py-2 text-sm">
      <span className="text-parchment/80">
        Drag a track&apos;s <span className="text-parchment/80">vol</span> slider
        to level it against the rest of the soundtrack.
      </span>
      <div className="ml-auto flex items-center gap-2">
        {saveState.kind === "saved" && !dirty && (
          <span className="text-[13px] text-parchment/70">Saved.</span>
        )}
        {saveState.kind === "error" && (
          <span className="text-[13px] text-ember">
            Save failed: {saveState.message}
          </span>
        )}
        {dirty && (
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-parchment/20 px-3 py-1 text-[13px] text-parchment/80 hover:bg-ink/40"
          >
            Reset
          </button>
        )}
        {available ? (
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saveState.kind === "saving"}
            className="rounded border border-ember/50 bg-ember/10 px-3 py-1 text-[13px] text-parchment hover:bg-ember/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveState.kind === "saving" ? "Saving…" : "Save volumes"}
          </button>
        ) : (
          <span className="text-[13px] text-parchment/60">
            Start the publish server (<code>npm run dev:all</code>) to save.
          </span>
        )}
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
      <div className="text-sm text-parchment/80">Path</div>
      <code className="break-all font-mono text-sm text-parchment">
        {path}
      </code>
      <div className="mt-3 text-[13px] text-parchment/70">
        Use this path in data records that reference audio. Apply
        basePath at fetch time.
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 rounded border border-parchment/20 px-3 py-1 text-[13px] text-parchment/80 hover:bg-ink/40"
      >
        Close
      </button>
    </div>
  );
}
