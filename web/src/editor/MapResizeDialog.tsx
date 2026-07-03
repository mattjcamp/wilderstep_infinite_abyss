"use client";

/**
 * Modal overlay for growing a map's grid — the "Resize" toolbar
 * action. Maps only grow (shrinking would orphan painted content),
 * and space can be added on any edge. The dialog is a controlled
 * form: it holds the four edge counts locally and only fires
 * onResize when the author clicks "Resize Map". All grid reshaping,
 * inbound-link fix-ups, and persistence are the caller's job
 * (MapEditor + src/editor/resizeMap.ts).
 *
 * New cells are filled with the map's dominant ground tile —
 * resolved by the caller and surfaced here read-only so the author
 * knows what terrain the new real estate arrives as.
 */

import { useEffect, useMemo, useState } from "react";
import {
  MAX_MAP_DIM,
  resizeValidationError,
  type ResizeEdges,
} from "./resizeMap";

export function MapResizeDialog({
  mapId,
  width,
  height,
  fillTileName,
  onResize,
  onClose,
}: {
  mapId: string;
  width: number;
  height: number;
  /** Display name of the tile new cells will be painted with. Null →
   *  the caller couldn't resolve one (empty palette); the resize is
   *  still allowed, the note just goes generic. */
  fillTileName: string | null;
  onResize: (edges: ResizeEdges) => void;
  onClose: () => void;
}) {
  const [top, setTop] = useState(0);
  const [right, setRight] = useState(0);
  const [bottom, setBottom] = useState(0);
  const [left, setLeft] = useState(0);

  const edges: ResizeEdges = useMemo(
    () => ({ top, right, bottom, left }),
    [top, right, bottom, left],
  );
  const newW = width + left + right;
  const newH = height + top + bottom;
  const error = resizeValidationError(width, height, edges);
  const noop = top === 0 && right === 0 && bottom === 0 && left === 0;

  // Escape closes, Cmd/Ctrl+Enter applies — same keyboard contract
  // as the Map Properties dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!resizeValidationError(width, height, edges)) onResize(edges);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edges, width, height, onResize, onClose]);

  const edgeInput = (
    label: string,
    value: number,
    set: (v: number) => void,
  ) => (
    <label className="flex flex-col items-center gap-1">
      <span className="text-[13px] font-mono text-parchment/85">{label}</span>
      <input
        type="number"
        min={0}
        max={MAX_MAP_DIM}
        value={value}
        onChange={(e) => {
          const v = Math.floor(Number(e.target.value));
          set(Number.isFinite(v) && v > 0 ? v : 0);
        }}
        className="w-20 rounded border border-parchment/25 bg-ink/60 px-2 py-1 text-center text-parchment focus:border-ember focus:outline-none"
      />
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label="Resize map"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-[440px] max-w-[90vw] flex-col rounded-lg border border-parchment/25 bg-ink/95 p-4 text-parchment shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex shrink-0 items-baseline justify-between">
          <h2 className="font-display text-xl">Resize Map</h2>
          <span className="font-mono text-xs text-parchment/65">
            id: {mapId}
          </span>
        </header>

        <p className="mb-3 text-[13px] text-parchment/75">
          Add rows or columns to any edge. Existing content is
          preserved — links, pressure plates, and the party start
          position that point into this map are adjusted
          automatically when space is added on the top or left.
        </p>

        {/* Compass layout: top on its own row, left/right flanking
            the dimension readout, bottom on its own row. */}
        <div className="mb-3 flex flex-col items-center gap-2">
          {edgeInput("top", top, setTop)}
          <div className="flex items-center gap-4">
            {edgeInput("left", left, setLeft)}
            <div className="flex w-28 flex-col items-center text-center">
              <span className="text-[12px] text-parchment/60">
                {width}×{height} →
              </span>
              <span
                className={`font-display text-lg ${
                  error && !noop ? "text-red-400" : "text-parchment"
                }`}
              >
                {newW}×{newH}
              </span>
            </div>
            {edgeInput("right", right, setRight)}
          </div>
          {edgeInput("bottom", bottom, setBottom)}
        </div>

        <p className="mb-3 text-[13px] text-parchment/70">
          New cells are painted with{" "}
          <span className="text-parchment">
            {fillTileName ?? "the module's default tile"}
          </span>
          {fillTileName ? " (this map's most common ground tile)" : ""}.
        </p>

        {error && !noop ? (
          <p className="mb-3 text-[13px] text-red-400">{error}</p>
        ) : null}

        <footer className="flex shrink-0 justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-3 py-1 text-[13px] text-parchment/85 hover:bg-ink/40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!!error}
            onClick={() => {
              if (!error) onResize(edges);
            }}
            className="rounded border border-ember/50 bg-ember/25 px-3 py-1 text-[13px] text-parchment enabled:hover:bg-ember/40 disabled:cursor-not-allowed disabled:opacity-50"
            title="Grow the map. This writes to the maps draft like any other edit — Publish/Discard as usual."
          >
            Resize Map
          </button>
        </footer>
      </div>
    </div>
  );
}
