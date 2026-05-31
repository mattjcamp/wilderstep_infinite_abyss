"use client";

/**
 * PixelEditor — a tiny per-pixel paint surface for sprite editing.
 *
 * Bare-essentials toolkit (v1):
 *   - Pencil + eraser (eraser writes a transparent pixel)
 *   - 16-color preset palette + a custom hex picker
 *   - Single-step undo per stroke (one stroke = one mousedown..mouseup
 *     drag, regardless of how many cells it covers)
 *   - Live preview at native size next to the working canvas
 *   - Save (writes the draft to localStorage via spriteDraft.ts) /
 *     Discard draft / Download as PNG
 *
 * Out of scope intentionally (mid-tier work for a later pass): fill
 * bucket, line / rect / circle tools, eyedropper, multi-frame
 * animation, layers, copy-paste regions, brush sizes other than 1.
 *
 * Image handling:
 *   - Existing sprite → loaded into an offscreen ImageData via a
 *     temporary <img> + canvas, then drawn into the working pixel
 *     grid at 1:1 cell resolution. Whatever dimensions the source
 *     PNG has become the editor's grid (most are 32×32; a couple of
 *     person sprites are 34×32 — they edit identically).
 *   - New sprite → starts as a transparent grid at the size passed in
 *     via `newSpriteSize` (defaults to 32×32 since the world is built
 *     on a 32-tile grid).
 *
 * Storage contract — the editor owns one and only one sprite path at
 * a time. `path` is the canonical key (e.g. "map/grass.png"); the
 * draft module strips any leading "/sprites/" the caller passes so
 * either form works.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  discardSpriteDraft,
  loadSpriteDraft,
  saveSpriteDraft,
} from "@/data_model/spriteDraft";
import { publishItems } from "@/data_model/publishClient";
import { usePublishServer } from "./usePublishServer";
import { withBasePath } from "@/util/basePath";

/** Display scale — every grid cell paints as a SCALE×SCALE block on
 *  screen so the artist can comfortably click individual pixels. The
 *  exported PNG is always at native resolution; SCALE only affects
 *  the on-screen working surface. */
const SCALE = 16;

/** Default canvas size for new sprites. Matches `TILE_SIZE` from the
 *  world renderer so painted tiles fit the grid without resampling. */
const DEFAULT_NEW_SIZE = 32;

/** Preset palette — picked to cover the v1 game's overall art style:
 *  earthy browns + warm woods (terrain), greens (foliage), blues
 *  (water + sky), a few warms (fire / blood / gold), neutrals (rock,
 *  stone, shadow), and a high-contrast white/black at the corners.
 *  Authors with strong opinions can drop their own hex via the
 *  custom input below. */
const PRESET_PALETTE: ReadonlyArray<string> = [
  "#000000",
  "#1f1f1f",
  "#5a3a1a",
  "#8b5a2b",
  "#caa472",
  "#f0d8a8",
  "#264820",
  "#3f7c2c",
  "#76c443",
  "#1d3a6b",
  "#2f6abf",
  "#7fb8ff",
  "#b22d2d",
  "#e6691c",
  "#f0c33c",
  "#ffffff",
];

type Tool = "pencil" | "eraser" | "fill" | "eyedropper";

/** Sentinel value for "the current colour is the transparent slot."
 *  The palette renders this as a checker swatch; selecting it makes
 *  the pencil paint transparent pixels (functionally equivalent to
 *  the eraser tool, but in-palette so authors don't have to flip
 *  tools while colour-picking). Distinct from "#hexstring" so the
 *  hex parser doesn't accidentally read a colour out of it. */
const TRANSPARENT_COLOR = "transparent";

/** One pixel — RGBA tuple. `a === 0` denotes a transparent cell;
 *  the editor renders these as the checker pattern beneath. */
interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

const TRANSPARENT: Pixel = { r: 0, g: 0, b: 0, a: 0 };

function hexToPixel(hex: string): Pixel {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return TRANSPARENT;
  const n = Number.parseInt(m[1], 16);
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
    a: 255,
  };
}

function pixelToCss(p: Pixel): string {
  if (p.a === 0) return "transparent";
  return `rgba(${p.r}, ${p.g}, ${p.b}, ${p.a / 255})`;
}

/** Two pixels are equal when every channel matches exactly. Used by
 *  flood-fill to decide which neighbours to recolour and by the
 *  pencil's no-op guard. */
function pixelsEqual(a: Pixel, b: Pixel): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

/** Convert an opaque pixel to a "#rrggbb" string for the colour state.
 *  Returns the TRANSPARENT_COLOR sentinel for alpha-0 pixels so the
 *  eyedropper round-trips correctly into the palette swatch. */
function pixelToColorString(p: Pixel): string {
  if (p.a === 0) return TRANSPARENT_COLOR;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(p.r)}${hex(p.g)}${hex(p.b)}`;
}

/** Four-neighbour flood fill from (col, row). Mutates `pixels` in
 *  place and returns the same array reference for caller convenience
 *  (so React state setters can compare-or-replace). Walks the grid
 *  with an iterative queue — recursion would blow the stack on a
 *  fully-uniform 32×32 canvas otherwise. No-op when the seed cell
 *  already matches `replacement`. */
function floodFill(
  pixels: Pixel[],
  w: number,
  h: number,
  col: number,
  row: number,
  replacement: Pixel,
): Pixel[] {
  if (col < 0 || row < 0 || col >= w || row >= h) return pixels;
  const seedIdx = row * w + col;
  const target = pixels[seedIdx];
  if (pixelsEqual(target, replacement)) return pixels;
  const queue: number[] = [seedIdx];
  while (queue.length > 0) {
    const i = queue.pop()!;
    if (!pixelsEqual(pixels[i], target)) continue;
    pixels[i] = replacement;
    const c = i % w;
    const r = (i - c) / w;
    if (c > 0) queue.push(i - 1);
    if (c < w - 1) queue.push(i + 1);
    if (r > 0) queue.push(i - w);
    if (r < h - 1) queue.push(i + w);
  }
  return pixels;
}

export interface PixelEditorProps {
  /** The module id this sprite belongs to. Forwarded to
   *  spriteDraft.ts so drafts don't cross-contaminate between
   *  modules opened back-to-back. */
  moduleId: string;
  /** Sprite path relative to /sprites/ (e.g. "map/grass.png").
   *  Acts as the storage key + the download filename root. */
  path: string;
  /** When true, the editor opens with a blank transparent canvas at
   *  `newSpriteSize`. When false (default), the source PNG / existing
   *  draft is loaded. */
  startBlank?: boolean;
  /** Initial size for new-sprite mode. Ignored when editing an
   *  existing sprite — the source PNG's dimensions win. */
  newSpriteSize?: { w: number; h: number };
  /** Fires after a successful Save so the parent (sprite browser)
   *  can refresh thumbnails / the "modified" pip. Optional. */
  onSaved?: () => void;
  /** Fires after Discard Draft. Same purpose as onSaved. Optional. */
  onDiscarded?: () => void;
}

/** State of the editing surface — pixel grid + the dimensions it's
 *  laid out at. Stored as a flat array (length = w * h) so the
 *  rendering loop is a single pass. */
interface CanvasState {
  w: number;
  h: number;
  pixels: Pixel[];
}

function blankCanvas(w: number, h: number): CanvasState {
  return {
    w,
    h,
    pixels: Array.from({ length: w * h }, () => ({ ...TRANSPARENT })),
  };
}

/** Render a CanvasState into a freshly-allocated HTMLCanvasElement at
 *  native (un-scaled) resolution. Used both for the side-preview and
 *  for producing the data URL on Save / Download. */
function renderToNativeCanvas(state: CanvasState): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = state.w;
  canvas.height = state.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(state.w, state.h);
  for (let i = 0; i < state.pixels.length; i++) {
    const p = state.pixels[i];
    const off = i * 4;
    img.data[off + 0] = p.r;
    img.data[off + 1] = p.g;
    img.data[off + 2] = p.b;
    img.data[off + 3] = p.a;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function PixelEditor({
  moduleId,
  path,
  startBlank = false,
  newSpriteSize,
  onSaved,
  onDiscarded,
}: PixelEditorProps) {
  const [canvas, setCanvas] = useState<CanvasState>(() =>
    blankCanvas(
      newSpriteSize?.w ?? DEFAULT_NEW_SIZE,
      newSpriteSize?.h ?? DEFAULT_NEW_SIZE,
    ),
  );
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState<string>(PRESET_PALETTE[0]);
  const [customHex, setCustomHex] = useState<string>("#9966cc");
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  /** Pre-stroke snapshot used by undo. Captured on mousedown, applied
   *  on Cmd/Ctrl-Z. One slot, single-level — the simplest model that
   *  still covers "I just made an oopsie". */
  const undoRef = useRef<CanvasState | null>(null);
  /** Live drag flag. Mousedown sets it true and snapshots; mouseup
   *  clears. While true, mousemove paints continuously. */
  const draggingRef = useRef<boolean>(false);
  /** Bumped to force the source/draft load effect to re-run in place —
   *  e.g. after Discard (draft gone → reload the on-disk PNG) or
   *  Publish (now-published PNG becomes the source). Without this the
   *  canvas kept showing the in-memory draft after Discard, so the
   *  button looked like it did nothing. */
  const [reloadNonce, setReloadNonce] = useState(0);

  // ── Source / draft load ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadStatus("loading");
    setStatusMessage(null);

    if (startBlank) {
      setCanvas(
        blankCanvas(
          newSpriteSize?.w ?? DEFAULT_NEW_SIZE,
          newSpriteSize?.h ?? DEFAULT_NEW_SIZE,
        ),
      );
      setLoadStatus("ready");
      return () => {
        cancelled = true;
      };
    }

    // Draft first; fall back to the on-disk PNG. Either way we hydrate
    // through an <img> element, which gives us cross-browser PNG
    // decoding without bundling a decoder.
    const draft = loadSpriteDraft(moduleId, path);
    const src = draft ?? withBasePath(`/sprites/${path.replace(/^\/+/, "")}`);

    const img = new Image();
    // Same-origin / data URLs both pass cleanly; setting crossOrigin
    // would force a CORS preflight against same-origin URLs, so leave
    // it unset.
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || DEFAULT_NEW_SIZE;
      const h = img.naturalHeight || DEFAULT_NEW_SIZE;
      const scratch = document.createElement("canvas");
      scratch.width = w;
      scratch.height = h;
      const ctx = scratch.getContext("2d");
      if (!ctx) {
        setLoadStatus("error");
        setStatusMessage("Could not decode the sprite — no 2D context.");
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h);
      const pixels: Pixel[] = new Array(w * h);
      for (let i = 0; i < pixels.length; i++) {
        const off = i * 4;
        pixels[i] = {
          r: data.data[off + 0],
          g: data.data[off + 1],
          b: data.data[off + 2],
          a: data.data[off + 3],
        };
      }
      setCanvas({ w, h, pixels });
      setLoadStatus("ready");
    };
    img.onerror = () => {
      if (cancelled) return;
      // Sprite doesn't exist yet (new file, mistyped path, etc.) —
      // fall through to a blank canvas at the default size instead of
      // bricking the editor. The author can paint + Save to create it.
      setCanvas(
        blankCanvas(
          newSpriteSize?.w ?? DEFAULT_NEW_SIZE,
          newSpriteSize?.h ?? DEFAULT_NEW_SIZE,
        ),
      );
      setLoadStatus("ready");
      setStatusMessage("Source PNG not found — starting from a blank canvas.");
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [moduleId, path, startBlank, newSpriteSize?.w, newSpriteSize?.h, reloadNonce]);

  // ── Paint helpers ─────────────────────────────────────────────────
  /** Active "paint colour" — either the picked hex or the transparent
   *  sentinel. Wrapping in a memo lets the cell-action callbacks
   *  recompute only when the user changes colour, not on every
   *  pointer event. */
  const currentReplacementPixel: Pixel =
    color === TRANSPARENT_COLOR ? TRANSPARENT : hexToPixel(color);

  const paintCell = useCallback(
    (col: number, row: number) => {
      setCanvas((prev) => {
        if (col < 0 || row < 0 || col >= prev.w || row >= prev.h) return prev;
        const next = prev.pixels.slice();
        const i = row * prev.w + col;
        // Transparent paint comes from either the explicit "eraser"
        // tool OR the "Transparent" palette slot — both routes write
        // an alpha-0 pixel.
        const value =
          tool === "eraser" ? TRANSPARENT : currentReplacementPixel;
        // Idempotent — clicking an already-painted cell of the same
        // colour shouldn't re-render. Tiny perf win; bigger UX win
        // (no flicker on repeat-clicks).
        if (pixelsEqual(prev.pixels[i], value)) return prev;
        next[i] = value;
        return { ...prev, pixels: next };
      });
    },
    [currentReplacementPixel, tool],
  );

  /** Single-shot flood fill — called once on pointer-down for the
   *  Fill tool; drag is intentionally disabled (dragging across a
   *  filled region would re-fill on every move, producing a flicker
   *  and a confusing undo state). */
  const fillFromCell = useCallback(
    (col: number, row: number) => {
      setCanvas((prev) => {
        if (col < 0 || row < 0 || col >= prev.w || row >= prev.h) return prev;
        const next = prev.pixels.slice();
        floodFill(next, prev.w, prev.h, col, row, currentReplacementPixel);
        return { ...prev, pixels: next };
      });
    },
    [currentReplacementPixel],
  );

  /** Eyedropper — read the pixel under the cursor + set the current
   *  colour state, then auto-switch back to pencil so the author can
   *  immediately paint with the picked colour. Transparent pixels
   *  round-trip into the TRANSPARENT palette slot. */
  const sampleFromCell = useCallback(
    (col: number, row: number) => {
      if (col < 0 || row < 0 || col >= canvas.w || row >= canvas.h) return;
      const i = row * canvas.w + col;
      setColor(pixelToColorString(canvas.pixels[i]));
      setTool("pencil");
    },
    [canvas],
  );

  // ── Pointer plumbing ──────────────────────────────────────────────
  // Translate a pointer event onto the working canvas's <div> into a
  // (col, row) cell. Wrapped so the mousedown / mousemove handlers
  // share the same conversion.
  const cellFromEvent = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): { col: number; row: number } => {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Scale-based math keeps the working surface DPR-independent —
      // the CSS pixel size of each cell is SCALE regardless of any
      // device-pixel-ratio retina goofiness.
      const col = Math.floor(x / SCALE);
      const row = Math.floor(y / SCALE);
      return { col, row };
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const { col, row } = cellFromEvent(e);
      if (tool === "fill") {
        // Snapshot BEFORE the fill so undo restores the pre-fill
        // grid. Drag is left disabled — fill is one-shot.
        undoRef.current = canvas;
        fillFromCell(col, row);
        return;
      }
      if (tool === "eyedropper") {
        // No undo snapshot — eyedropper only mutates the colour /
        // tool state, not the canvas. Auto-flips back to pencil
        // inside sampleFromCell.
        sampleFromCell(col, row);
        return;
      }
      // pencil / eraser — drag-paint behaviour.
      undoRef.current = canvas;
      draggingRef.current = true;
      paintCell(col, row);
    },
    [canvas, cellFromEvent, fillFromCell, paintCell, sampleFromCell, tool],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const { col, row } = cellFromEvent(e);
      paintCell(col, row);
    },
    [cellFromEvent, paintCell],
  );

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  // Cmd/Ctrl-Z restores the pre-stroke snapshot. One level — pressing
  // again is a no-op rather than a redo cycle (intentional v1
  // simplicity).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (undoRef.current) {
          setCanvas(undoRef.current);
          undoRef.current = null;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Save / Discard / Download ─────────────────────────────────────
  const handleSave = useCallback(() => {
    const native = renderToNativeCanvas(canvas);
    const dataUrl = native.toDataURL("image/png");
    const ok = saveSpriteDraft(moduleId, path, dataUrl);
    if (ok) {
      setStatusMessage(
        "Draft saved. Edits show up live; use Download to export the PNG.",
      );
      onSaved?.();
    } else {
      setStatusMessage(
        "Could not save the draft — storage may be full or disabled.",
      );
    }
  }, [canvas, moduleId, path, onSaved]);

  const handleDiscard = useCallback(() => {
    discardSpriteDraft(moduleId, path);
    // Reload the canvas from the on-disk PNG right away so the artist
    // SEES the draft revert (the button used to clear the draft but
    // leave the stale pixels on screen, so it looked like a no-op).
    setReloadNonce((n) => n + 1);
    setStatusMessage("Draft discarded — reverted to the published sprite.");
    onDiscarded?.();
  }, [moduleId, path, onDiscarded]);

  const handleDownload = useCallback(() => {
    const native = renderToNativeCanvas(canvas);
    const dataUrl = native.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    // Pull the leaf filename from `path` so a copy of "map/grass.png"
    // saves as "grass.png" rather than "map_grass.png".
    const leaf = path.split("/").pop() || "sprite.png";
    a.download = leaf.endsWith(".png") ? leaf : `${leaf}.png`;
    a.click();
  }, [canvas, path]);

  // ── Publish (publish-server only) ─────────────────────────────────
  // Mirrors the JSON Publish buttons elsewhere in the editor: a local
  // POST to the publish-server writes the PNG into
  // public/sprites/<category>/<filename> and rebuilds index.json. On
  // success the local draft is discarded — the canonical version
  // lives on disk now. Hidden when the server isn't reachable
  // (deployed build, no `npm run publish-server` running).
  const publishAvailable = usePublishServer().available;
  const [publishing, setPublishing] = useState(false);
  const handlePublish = useCallback(async () => {
    // Split "category/leaf.png" — the server validates both halves
    // anyway, so a bad path comes back as a clean error rather than
    // a silent write to the wrong place.
    const slash = path.indexOf("/");
    if (slash <= 0) {
      setStatusMessage(
        `Sprite path needs a category prefix (e.g. "map/${path}").`,
      );
      return;
    }
    const category = path.slice(0, slash);
    const fileName = path.slice(slash + 1);
    const native = renderToNativeCanvas(canvas);
    const dataUrl = native.toDataURL("image/png");
    setPublishing(true);
    try {
      const response = await publishItems([
        { kind: "sprite", category, fileName, dataUrl },
      ]);
      const first = response.results[0];
      if (!first || !first.ok) {
        setStatusMessage(
          `Publish failed: ${first?.error ?? "unknown error"}.`,
        );
        return;
      }
      // Server wrote the PNG + regenerated index.json. The local
      // draft is now redundant; discard it so the next page load
      // shows the on-disk version (and the "Drafted" pip clears).
      discardSpriteDraft(moduleId, path);
      setStatusMessage(
        `Published to ${first.path}. Index regenerated.`,
      );
      // Surface the discard via the same callback the Discard button
      // uses so the parent (sprite browser) refreshes its pip.
      onDiscarded?.();
    } catch (e) {
      setStatusMessage(
        `Publish failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPublishing(false);
    }
  }, [canvas, moduleId, onDiscarded, path]);

  // ── Render ────────────────────────────────────────────────────────
  if (loadStatus === "loading") {
    return (
      <p className="p-4 text-parchment/60">Loading {path}…</p>
    );
  }
  if (loadStatus === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Couldn’t open the sprite.</p>
        {statusMessage ? (
          <p className="mt-1 text-sm text-parchment/60">{statusMessage}</p>
        ) : null}
      </div>
    );
  }

  const workingW = canvas.w * SCALE;
  const workingH = canvas.h * SCALE;
  const colorIsTransparent = color === TRANSPARENT_COLOR;
  const currentPixel = colorIsTransparent ? TRANSPARENT : hexToPixel(color);
  // Inline-style for the checker-pattern swatches (current-colour
  // chip + the in-palette Transparent slot). Same recipe as the
  // working-canvas background, scaled down to swatch size so the
  // checker reads at a glance.
  const checkerSwatchStyle: React.CSSProperties = {
    backgroundImage:
      "linear-gradient(45deg, #2a2a2a 25%, transparent 25%, transparent 75%, #2a2a2a 75%), linear-gradient(45deg, #2a2a2a 25%, transparent 25%, transparent 75%, #2a2a2a 75%)",
    backgroundSize: "6px 6px",
    backgroundPosition: "0 0, 3px 3px",
    backgroundColor: "#1a1a1a",
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-xs text-parchment/60">
          {path}{" "}
          <span className="ml-2 text-parchment/40">
            {canvas.w}×{canvas.h}
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleSave}
            className="rounded border border-emerald-400/40 bg-emerald-700/30 px-3 py-1 text-sm text-parchment hover:bg-emerald-700/50"
          >
            Save draft
          </button>
          {publishAvailable ? (
            <button
              type="button"
              onClick={() => {
                void handlePublish();
              }}
              disabled={publishing}
              title="Write the PNG to public/sprites/ + regenerate index.json. Same publish flow used for maps + other module data."
              className="rounded border border-amber-300/50 bg-amber-700/30 px-3 py-1 text-sm text-parchment hover:bg-amber-700/50 disabled:opacity-50"
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleDiscard}
            className="rounded border border-parchment/20 bg-ink/40 px-3 py-1 text-sm text-parchment/80 hover:bg-ink/60"
          >
            Discard draft
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="rounded border border-parchment/20 bg-ink/40 px-3 py-1 text-sm text-parchment/80 hover:bg-ink/60"
          >
            Download PNG
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Working canvas — a div per pixel cell is simpler than a
            real <canvas>, costs us 32×32=1024 nodes (small), and
            gives us free CSS hover affordances. */}
        <div
          className="relative shrink-0 select-none border border-parchment/30"
          style={{
            width: `${workingW}px`,
            height: `${workingH}px`,
            backgroundImage:
              // Diagonal checker pattern under transparent pixels so
              // the artist can see what's actually painted vs. empty.
              "linear-gradient(45deg, #2a2a2a 25%, transparent 25%, transparent 75%, #2a2a2a 75%), linear-gradient(45deg, #2a2a2a 25%, transparent 25%, transparent 75%, #2a2a2a 75%)",
            backgroundSize: `${SCALE}px ${SCALE}px`,
            backgroundPosition: `0 0, ${SCALE / 2}px ${SCALE / 2}px`,
            backgroundColor: "#1a1a1a",
            cursor:
              tool === "eraser"
                ? "crosshair"
                : tool === "fill"
                  ? "copy"
                  : tool === "eyedropper"
                    ? "alias"
                    : "cell",
            touchAction: "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {canvas.pixels.map((p, i) => {
            if (p.a === 0) return null;
            const col = i % canvas.w;
            const row = Math.floor(i / canvas.w);
            return (
              <div
                key={i}
                className="pointer-events-none absolute"
                style={{
                  left: `${col * SCALE}px`,
                  top: `${row * SCALE}px`,
                  width: `${SCALE}px`,
                  height: `${SCALE}px`,
                  background: pixelToCss(p),
                }}
              />
            );
          })}
        </div>

        <div className="flex flex-col gap-3">
          {/* Tools. Pencil + eraser drag-paint; fill + eyedropper are
              single-click. Eyedropper auto-flips back to pencil after a
              successful sample so the picked colour can be used
              immediately without another tool change. */}
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setTool("pencil")}
              className={[
                "rounded border px-2 py-1 text-xs",
                tool === "pencil"
                  ? "border-amber-300 bg-amber-700/30 text-parchment"
                  : "border-parchment/20 bg-ink/40 text-parchment/70 hover:bg-ink/60",
              ].join(" ")}
            >
              Pencil
            </button>
            <button
              type="button"
              onClick={() => setTool("eraser")}
              className={[
                "rounded border px-2 py-1 text-xs",
                tool === "eraser"
                  ? "border-amber-300 bg-amber-700/30 text-parchment"
                  : "border-parchment/20 bg-ink/40 text-parchment/70 hover:bg-ink/60",
              ].join(" ")}
            >
              Eraser
            </button>
            <button
              type="button"
              onClick={() => setTool("fill")}
              title="Flood-fill connected pixels of the same colour"
              className={[
                "rounded border px-2 py-1 text-xs",
                tool === "fill"
                  ? "border-amber-300 bg-amber-700/30 text-parchment"
                  : "border-parchment/20 bg-ink/40 text-parchment/70 hover:bg-ink/60",
              ].join(" ")}
            >
              Fill
            </button>
            <button
              type="button"
              onClick={() => setTool("eyedropper")}
              title="Sample a pixel's colour and copy it to the current colour"
              className={[
                "rounded border px-2 py-1 text-xs",
                tool === "eyedropper"
                  ? "border-amber-300 bg-amber-700/30 text-parchment"
                  : "border-parchment/20 bg-ink/40 text-parchment/70 hover:bg-ink/60",
              ].join(" ")}
            >
              Eyedropper
            </button>
          </div>

          {/* Current colour */}
          <div className="flex items-center gap-2">
            <div
              className="h-6 w-6 rounded border border-parchment/40"
              style={
                colorIsTransparent
                  ? checkerSwatchStyle
                  : { background: pixelToCss(currentPixel) }
              }
            />
            <span className="font-mono text-xs text-parchment/70">
              {colorIsTransparent ? "transparent" : color}
            </span>
          </div>

          {/* Preset palette — the leading slot is the in-palette
              transparent option (functionally the same as the eraser
              tool, but reachable without flipping tools while colour-
              picking). The rest are the preset hex swatches. */}
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-parchment/40">
              Palette
            </p>
            <div className="grid grid-cols-8 gap-1">
              <button
                key={TRANSPARENT_COLOR}
                type="button"
                onClick={() => setColor(TRANSPARENT_COLOR)}
                title="Transparent (alpha 0)"
                className={[
                  "h-5 w-5 rounded border",
                  colorIsTransparent
                    ? "border-amber-300"
                    : "border-parchment/30 hover:border-parchment/60",
                ].join(" ")}
                style={checkerSwatchStyle}
              />
              {PRESET_PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setColor(hex)}
                  title={hex}
                  className={[
                    "h-5 w-5 rounded border",
                    color === hex
                      ? "border-amber-300"
                      : "border-parchment/30 hover:border-parchment/60",
                  ].join(" ")}
                  style={{ background: hex }}
                />
              ))}
            </div>
          </div>

          {/* Custom hex */}
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-parchment/40">
              Custom hex
            </p>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={customHex}
                onChange={(e) => setCustomHex(e.target.value)}
                className="w-24 rounded border border-parchment/20 bg-ink/40 px-2 py-1 font-mono text-xs text-parchment focus:border-parchment/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setColor(customHex)}
                className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-xs text-parchment/80 hover:bg-ink/60"
              >
                Use
              </button>
            </div>
          </div>

          {/* Preview at native size */}
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-parchment/40">
              Preview
            </p>
            <NativePreview canvas={canvas} />
          </div>
        </div>
      </div>

      {statusMessage ? (
        <p className="text-xs text-parchment/60">{statusMessage}</p>
      ) : null}
    </div>
  );
}

/** Native-size preview — renders the current canvas state into a
 *  small <canvas> at 1:1 so the artist can see what the sprite
 *  actually looks like in-game. Re-paints on every state change via
 *  the effect below; the canvas size is fixed so layout doesn't
 *  reflow when pixels change. */
function NativePreview({ canvas }: { canvas: CanvasState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.width = canvas.w;
    el.height = canvas.h;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(canvas.w, canvas.h);
    for (let i = 0; i < canvas.pixels.length; i++) {
      const p = canvas.pixels[i];
      const off = i * 4;
      img.data[off + 0] = p.r;
      img.data[off + 1] = p.g;
      img.data[off + 2] = p.b;
      img.data[off + 3] = p.a;
    }
    ctx.putImageData(img, 0, 0);
  }, [canvas]);
  return (
    <canvas
      ref={ref}
      width={canvas.w}
      height={canvas.h}
      style={{ imageRendering: "pixelated" }}
      className="block border border-parchment/30"
    />
  );
}
