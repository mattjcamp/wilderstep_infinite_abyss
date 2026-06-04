"use client";

/**
 * Animation picker — embedded into RecordForm fields whose key matches
 * a known animation-field (Spell/Ability/Item/Effect.animation_id). The
 * picker lists every entry from the module's animations.json catalog
 * and writes the selected `id` back through onChange.
 *
 * Layout:
 *   [ ▸ Animation name (visual · cast/hit sfx) ] [ ▶ play ] [ ✕ clear ]
 *   (expands when open) ┌─ shared preview canvas ─┐
 *                       ┌─ scrollable list, each row with a ▶ ─┐
 *
 * Click an animation row → field value becomes that animation's id.
 * Empty value = "(none)". The text input is intentionally hidden
 * because animation ids should only come from the catalog — there's
 * no legacy free-text path to preserve here.
 *
 * Preview pipeline:
 *   - Phaser is lazy-imported the first time the picker is opened.
 *   - One PreviewScene is mounted into a 240×80 canvas at the top
 *     of the open picker; it holds a "caster" dot on the left and a
 *     "target" dot on the right.
 *   - Click a row's ▶ (or the header's ▶) → the scene resolves the
 *     animation's `visual` through the VFX registry, runs it from
 *     caster→target coords, and plays cast_sfx → hit_sfx.
 *   - The canvas survives close/reopen so designers can flip
 *     through the catalog without re-paying the Phaser load.
 *
 * The catalog is fetched once and cached at module scope so multiple
 * pickers on the same form (or rapid edits) share a single request.
 */

import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/util/basePath";
// NOTE: `@/vfx/effectRegistry` transitively pulls in `phaser`, which
// touches `navigator` at module load and crashes Next.js static
// prerendering of any page that imports this picker. `@/battle/audio/Sfx`
// is similarly browser-only (Web Audio + localStorage). Both are
// lazy-`import()`-ed inside the preview effect below, which only ever
// runs in the browser.

interface AnimationRecord {
  id: string;
  name: string;
  description?: string;
  visual?: string;
  cast_sfx?: string;
  hit_sfx?: string;
}

interface AnimationsFile {
  _comment?: string;
  animations: AnimationRecord[];
}

type CatalogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; animations: AnimationRecord[] }
  | { kind: "error"; message: string };

// Module-scope cache so every picker on the page shares one fetch.
// The catalog is small and changes only when the underlying file
// changes (which the editor would reload anyway); no invalidation.
let _cached: AnimationRecord[] | null = null;
let _inflight: Promise<AnimationRecord[]> | null = null;

async function loadCatalog(): Promise<AnimationRecord[]> {
  if (_cached) return _cached;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const url = withBasePath("/modules/default/animations.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as AnimationsFile;
    const list = Array.isArray(file.animations) ? file.animations : [];
    _cached = list;
    return list;
  })();
  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

/** Test-only escape hatch: clear the catalog cache between runs so
 *  one test's stubbed fetch doesn't bleed into the next. */
export function __resetAnimationCatalogCacheForTests(): void {
  _cached = null;
  _inflight = null;
}

// ── Preview canvas geometry ─────────────────────────────────────────
// The preview shows a left-side "caster" dot and right-side "target"
// dot; visuals run between them. Sized to fit comfortably inside the
// picker's flex-1 column without dominating the list below.
const PREVIEW_WIDTH = 240;
const PREVIEW_HEIGHT = 80;
const PREVIEW_FROM = { x: 28, y: PREVIEW_HEIGHT / 2 };
const PREVIEW_TO = { x: PREVIEW_WIDTH - 28, y: PREVIEW_HEIGHT / 2 };

export function AnimationPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CatalogState>({ kind: "idle" });

  useEffect(() => {
    if (state.kind !== "idle") return;
    setState({ kind: "loading" });
    loadCatalog()
      .then((animations) => setState({ kind: "ok", animations }))
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, [state.kind]);

  // Resolve the current value to a record so we can show a friendly
  // summary in the closed-state button.
  const current =
    state.kind === "ok"
      ? state.animations.find((a) => a.id === value) ?? null
      : null;

  // ── Phaser preview ────────────────────────────────────────────────
  // The container ref points at the div Phaser attaches its canvas to.
  // We mount Phaser the first time the picker is opened, then keep
  // the canvas alive across close/reopen so flipping through animations
  // doesn't re-pay the bundle load.
  const previewMountRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<unknown>(null);
  const playRef = useRef<((a: AnimationRecord) => void) | null>(null);
  const pendingPlayRef = useRef<AnimationRecord | null>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** Id of the animation currently playing in the preview — used to
   *  highlight the active row and show its name above the canvas. */
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  useEffect(() => {
    if (open && !hasOpened) setHasOpened(true);
  }, [open, hasOpened]);

  useEffect(() => {
    if (!hasOpened) return;
    if (gameRef.current) return;
    const mountTarget = previewMountRef.current;
    if (!mountTarget) return;
    let cancelled = false;
    setPreviewState("loading");
    (async () => {
      try {
        // All three modules are browser-only (phaser touches `navigator`,
        // Sfx touches Web Audio, effectRegistry pulls phaser via Vfx),
        // so they're imported here rather than at module top level —
        // otherwise Next.js's static prerender crashes with
        // `ReferenceError: navigator is not defined`.
        const [Phaser, { resolveProjectileEffect }, { Sfx }] =
          await Promise.all([
            import("phaser"),
            import("@/vfx/effectRegistry"),
            import("@/battle/audio/Sfx"),
          ]);
        if (cancelled) return;
        class PreviewScene extends Phaser.Scene {
          constructor() {
            super({ key: "animation-preview" });
          }
          create() {
            // Background gridline so the empty canvas reads as "preview
            // surface" rather than a black blank.
            const g = this.add.graphics();
            g.lineStyle(1, 0xece0c4, 0.08);
            g.lineBetween(0, PREVIEW_HEIGHT / 2, PREVIEW_WIDTH, PREVIEW_HEIGHT / 2);
            // Caster + target dots — small, low-key.
            this.add.circle(PREVIEW_FROM.x, PREVIEW_FROM.y, 5, 0xece0c4, 0.55);
            this.add.circle(PREVIEW_TO.x, PREVIEW_TO.y, 5, 0xff8866, 0.55);

            // Bind the play handler now that the scene is alive. We
            // close over `this` so the visual function gets a real
            // Phaser scene to draw into.
            playRef.current = async (a) => {
              try {
                if (a.cast_sfx) Sfx.play(a.cast_sfx);
                const vis = (a.visual ?? "").trim();
                if (vis && vis !== "none") {
                  const fn = resolveProjectileEffect({ effect_type: vis });
                  await fn(this, PREVIEW_FROM, PREVIEW_TO);
                } else {
                  // Audio-only animations still need *some* gap before
                  // the hit_sfx so cast and hit don't stack into one
                  // sound. ~180ms reads as "two distinct beats".
                  await new Promise<void>((r) => setTimeout(r, 180));
                }
                if (a.hit_sfx) Sfx.play(a.hit_sfx);
              } catch {
                // Visual failures are never fatal — just stop.
              } finally {
                setPreviewingId(null);
              }
            };

            setPreviewState("ready");
            // If the user clicked play before mount finished, fulfill
            // that request now.
            const pending = pendingPlayRef.current;
            if (pending) {
              pendingPlayRef.current = null;
              playRef.current(pending);
            }
          }
        }
        const game = new Phaser.Game({
          type: Phaser.AUTO,
          width: PREVIEW_WIDTH,
          height: PREVIEW_HEIGHT,
          parent: mountTarget,
          scene: PreviewScene,
          backgroundColor: "#0a0908",
          banner: false,
        } as Phaser.Types.Core.GameConfig);
        gameRef.current = game;
      } catch (e) {
        if (cancelled) return;
        setPreviewState("error");
        setPreviewError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      // Teardown on unmount only — close/reopen of the picker doesn't
      // destroy this effect because `hasOpened` is sticky.
      if (gameRef.current) {
        try {
          (gameRef.current as { destroy: (b: boolean) => void }).destroy(
            true,
          );
        } catch {
          /* ignore */
        }
        gameRef.current = null;
      }
      playRef.current = null;
    };
  }, [hasOpened]);

  const requestPlay = (a: AnimationRecord) => {
    setPreviewingId(a.id);
    if (playRef.current) {
      playRef.current(a);
    } else {
      // Scene not ready yet — queue the request; create() will fire it.
      pendingPlayRef.current = a;
    }
  };

  const summary = (() => {
    if (!value) return "(none)";
    if (state.kind === "loading") return value;
    if (state.kind === "error") return value;
    if (!current) {
      // Value points at an id the catalog doesn't recognize — show the
      // raw id with a warning marker so the designer notices.
      return `${value} ⚠`;
    }
    const parts: string[] = [current.name];
    const tail: string[] = [];
    if (current.visual && current.visual !== "none") {
      tail.push(current.visual);
    }
    if (current.cast_sfx) tail.push(`cast:${current.cast_sfx}`);
    if (current.hit_sfx) tail.push(`hit:${current.hit_sfx}`);
    if (tail.length > 0) parts.push(`(${tail.join(" · ")})`);
    return parts.join(" ");
  })();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-left text-sm text-parchment hover:bg-ink/60"
          aria-expanded={open}
        >
          <span className="text-parchment/60 mr-1">{open ? "▾" : "▸"}</span>
          {summary}
        </button>
        {current ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // Opening the picker lazy-mounts Phaser; play needs the
              // canvas to exist. Auto-open on the first play.
              if (!hasOpened) setOpen(true);
              requestPlay(current);
            }}
            className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/85 hover:bg-ink/40"
            title={`Preview "${current.name}".`}
          >
            ▶
          </button>
        ) : null}
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/85 hover:bg-ink/40"
            title="Clear the animation reference."
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* The preview container is rendered unconditionally once the
          picker has ever been opened, so Phaser can hold onto its
          canvas across close/reopen cycles. CSS hides it when the
          picker is closed. */}
      <div className={open ? "block" : "hidden"}>
        {hasOpened ? (
          <div className="mt-1 rounded border border-parchment/15 bg-ink/60 p-2">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-parchment/75">Preview</span>
              <span className="font-mono text-parchment/60">
                {previewState === "loading"
                  ? "loading Phaser…"
                  : previewState === "error"
                    ? `error: ${previewError ?? "unknown"}`
                    : previewingId
                      ? previewingId
                      : "ready"}
              </span>
            </div>
            <div
              ref={previewMountRef}
              className="mx-auto"
              style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
            />
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="mt-1 max-h-64 overflow-auto rounded border border-parchment/15 bg-ink/60 p-2">
          {state.kind === "loading" ? (
            <p className="text-[13px] text-parchment/70">Loading animations…</p>
          ) : null}
          {state.kind === "error" ? (
            <p className="text-[13px] text-ember">
              Couldn&apos;t load animations.json: {state.message}
            </p>
          ) : null}
          {state.kind === "ok" ? (
            <ul className="space-y-1">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className={`w-full rounded px-2 py-1 text-left text-sm transition ${
                    value === ""
                      ? "bg-ember/30 text-parchment"
                      : "text-parchment/75 hover:bg-ink/40"
                  }`}
                >
                  <span className="font-mono text-parchment/70">(none)</span>{" "}
                  <span className="text-parchment/65">
                    — no animation assigned
                  </span>
                </button>
              </li>
              {state.animations.map((a) => {
                const tail: string[] = [];
                if (a.visual && a.visual !== "none") tail.push(a.visual);
                if (a.cast_sfx) tail.push(`cast:${a.cast_sfx}`);
                if (a.hit_sfx) tail.push(`hit:${a.hit_sfx}`);
                const isActive = a.id === value;
                const isPreviewing = a.id === previewingId;
                return (
                  <li key={a.id} className="flex items-stretch gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onChange(a.id);
                        setOpen(false);
                      }}
                      className={`flex-1 rounded px-2 py-1 text-left text-sm transition ${
                        isActive
                          ? "bg-ember/30 text-parchment"
                          : isPreviewing
                            ? "bg-ember/15 text-parchment"
                            : "text-parchment/85 hover:bg-ink/40"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{a.name}</span>
                        <span className="font-mono text-xs text-parchment/65">
                          {a.id}
                        </span>
                      </div>
                      {tail.length > 0 ? (
                        <div className="text-xs text-parchment/70">
                          {tail.join(" · ")}
                        </div>
                      ) : null}
                      {a.description ? (
                        <div className="text-xs text-parchment/65">
                          {a.description}
                        </div>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestPlay(a);
                      }}
                      className={`shrink-0 rounded border px-2 text-[13px] transition ${
                        isPreviewing
                          ? "border-ember/60 bg-ember/30 text-parchment"
                          : "border-parchment/20 text-parchment/85 hover:bg-ink/40"
                      }`}
                      title={`Preview "${a.name}".`}
                    >
                      ▶
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
