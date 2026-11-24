"use client";

/**
 * Touch-screen controls for /play — tablets (and, later, phones).
 *
 * Everything here renders ONLY when `useTouchUi()` is true, so desktop
 * play is untouched. The buttons don't call into the game directly:
 * they dispatch the same `keydown` / `keyup` events a keyboard would
 * (`sendKey`), so every existing keyboard path — movement gating,
 * overlay guards, combat shortcuts — applies unchanged.
 *
 * Detection: a coarse primary pointer (finger) turns the touch UI on.
 * `?touch=1` / `?touch=0` in the URL forces it on / off for this tab
 * (sessionStorage, so it never sticks across visits) so it can be tried
 * on a desktop browser; `?touch=auto` forgets the override and goes
 * back to detection.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { setTouchUiActive } from "@/play/touchMode";

const TOUCH_PREF_KEY = "wilderstep.touchUi";

/** keyCode per key — Phaser's keyboard plugin routes `keydown-SPACE`
 *  etc. off `event.keyCode`, which a synthetic KeyboardEvent can't set
 *  through its constructor, so it's patched onto the event below. */
const KEY_CODES: Record<string, number> = {
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  " ": 32,
  Escape: 27,
  Enter: 13,
  p: 80,
  q: 81,
  l: 76,
  j: 74,
  h: 72,
  z: 90,
  f: 70,
};

/** Dispatch a synthetic key event on `window`, where the play host's
 *  listeners and Phaser's keyboard plugin both listen. */
export function sendKey(
  key: string,
  type: "keydown" | "keyup" = "keydown",
  repeat = false,
): void {
  if (typeof window === "undefined") return;
  const ev = new KeyboardEvent(type, {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    repeat,
  });
  const code = KEY_CODES[key] ?? 0;
  Object.defineProperty(ev, "keyCode", { get: () => code });
  Object.defineProperty(ev, "which", { get: () => code });
  window.dispatchEvent(ev);
}

function readForcedPref(): boolean | null {
  try {
    // Older builds kept the override in localStorage, so a one-off
    // `?touch=1` test left the touch controls stuck on in that browser
    // for good (e.g. a laptop in fullscreen). Drop any such leftover.
    window.localStorage.removeItem(TOUCH_PREF_KEY);
  } catch {
    /* storage unavailable */
  }
  try {
    const store = window.sessionStorage;
    const q = new URLSearchParams(window.location.search).get("touch");
    if (q === "auto") {
      store.removeItem(TOUCH_PREF_KEY);
      return null;
    }
    if (q === "1" || q === "0") {
      store.setItem(TOUCH_PREF_KEY, q);
      return q === "1";
    }
    const saved = store.getItem(TOUCH_PREF_KEY);
    if (saved === "1" || saved === "0") return saved === "1";
  } catch {
    /* storage unavailable — fall through to detection */
  }
  return null;
}

/** True when the touch UI should show. False during SSR / first paint,
 *  so desktop never flashes touch controls. */
export function useTouchUi(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const forced = readForcedPref();
    if (forced !== null) {
      setOn(forced);
      return;
    }
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  // Mirror into the module flag the Phaser combat scene reads.
  useEffect(() => {
    setTouchUiActive(on);
  }, [on]);
  return on;
}

/** Max viewport height treated as a phone held sideways. Landscape
 *  phones run ~320–440px tall; the smallest iPad is ~744px. */
const PHONE_MAX_HEIGHT = 520;

/** True on a touch device whose screen is phone-sized (landscape
 *  height ≤ PHONE_MAX_HEIGHT). Phones get the controls in the side
 *  column instead of floating over the map. */
export function usePhoneLayout(touchUi: boolean): boolean {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-height: ${PHONE_MAX_HEIGHT}px)`);
    const update = () => setSmall(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return touchUi && small;
}

/** Whether this browser can go fullscreen at all (iPhone Safari
 *  can't — the button is hidden there). */
function useFullscreenSupported(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const d = document as Document & { webkitFullscreenEnabled?: boolean };
    setOk(!!(d.fullscreenEnabled || d.webkitFullscreenEnabled));
  }, []);
  return ok;
}

/** True while the viewport is taller than wide. */
function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return portrait;
}

// ── Buttons ────────────────────────────────────────────────────────

/** Delay before a held d-pad button starts repeating, then the repeat
 *  interval. The host drops steps that arrive mid-slide, so repeating
 *  a little faster than a step takes keeps held walking smooth. */
const HOLD_DELAY_MS = 260;
const HOLD_REPEAT_MS = 90;

/** A touch button. `repeat` re-sends the key while held (d-pad);
 *  `hold` sends keydown on press and keyup on release (Z overview). */
function TouchButton({
  label,
  keyName,
  repeat = false,
  hold = false,
  className = "",
  children,
}: {
  label: string;
  keyName: string;
  repeat?: boolean;
  hold?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const timers = useRef<{ delay?: number; tick?: number }>({});
  const pressedRef = useRef(false);
  const [pressed, setPressed] = useState(false);

  // pointerup and lostpointercapture both land here; the ref makes the
  // second call a no-op (so a held key only gets one keyup).
  const stop = () => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.tick);
    timers.current = {};
    if (!pressedRef.current) return;
    pressedRef.current = false;
    if (hold) sendKey(keyName, "keyup");
    setPressed(false);
  };
  useEffect(() => () => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.tick);
  }, []);

  return (
    <button
      type="button"
      aria-label={label}
      // No `title`: press-and-hold on a control means "keep walking",
      // not "show a tooltip" (see TouchTooltipLayer).
      onPointerDown={(e) => {
        e.preventDefault();
        // Keep receiving this finger's events if it slides off the
        // button. Capture can throw (e.g. a pointer that's no longer
        // active) — never let that stop the key from being sent.
        try {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          /* ignore */
        }
        pressedRef.current = true;
        setPressed(true);
        sendKey(keyName, "keydown");
        if (repeat) {
          timers.current.delay = window.setTimeout(() => {
            timers.current.tick = window.setInterval(
              () => sendKey(keyName, "keydown", true),
              HOLD_REPEAT_MS,
            );
          }, HOLD_DELAY_MS);
        }
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      className={[
        "pointer-events-auto flex select-none items-center justify-center rounded-lg border font-display text-parchment shadow-lg",
        "border-parchment/30 bg-ink/70 backdrop-blur-sm active:bg-ember/50",
        pressed ? "bg-ember/50" : "",
        className,
      ].join(" ")}
      style={{ touchAction: "none", WebkitTouchCallout: "none" }}
    >
      {children ?? label}
    </button>
  );
}

const DPAD = "h-16 w-16 text-2xl";
const SMALL = "h-11 min-w-[3.25rem] px-2 text-sm";

/** Exploration controls: a d-pad bottom-left, actions bottom-right.
 *  Sits under the modal overlays (z-40/50) so open menus cover it. */
export function ExplorationTouchControls() {
  const fullscreenOk = useFullscreenSupported();
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* D-pad — bottom-left, clear of the 32px log strip. */}
      <div className="absolute bottom-12 left-4 grid grid-cols-3 grid-rows-3 gap-1">
        <span />
        <TouchButton label="Up" keyName="ArrowUp" repeat className={DPAD}>▲</TouchButton>
        <span />
        <TouchButton label="Left" keyName="ArrowLeft" repeat className={DPAD}>◀</TouchButton>
        <TouchButton label="Wait a turn" keyName=" " className={`${DPAD} text-xs`}>Wait</TouchButton>
        <TouchButton label="Right" keyName="ArrowRight" repeat className={DPAD}>▶</TouchButton>
        <span />
        <TouchButton label="Down" keyName="ArrowDown" repeat className={DPAD}>▼</TouchButton>
        <span />
      </div>
      {/* Menus — bottom-right column. */}
      <div className="absolute bottom-12 right-4 flex flex-col items-end gap-2">
        <TouchButton label="Party" keyName="p" className={SMALL} />
        <TouchButton label="Quests" keyName="q" className={SMALL} />
        <TouchButton label="Journal" keyName="j" className={SMALL} />
        <TouchButton label="Log" keyName="l" className={SMALL} />
        <div className="flex gap-2">
          <TouchButton label="Help" keyName="h" className={SMALL} />
          <TouchButton label="Hold to see the whole map" keyName="z" hold className={SMALL}>
            Map
          </TouchButton>
        </div>
      </div>
      {/* Fullscreen — top-right (where the browser supports it). */}
      {fullscreenOk ? (
        <div className="absolute right-4 top-3">
          <TouchButton label="Fullscreen" keyName="f" className="h-9 w-9 text-base">⛶</TouchButton>
        </div>
      ) : null}
    </div>
  );
}

const PHONE_DPAD = "h-14 w-14 text-xl";
const PHONE_BTN = "h-9 w-full px-1 text-[13px]";

/** Phone layout: the controls live in the left column (where the log
 *  panel sits on bigger screens), so nothing covers the map. The log
 *  is a tap away on the Log button (full log overlay). Hidden — not
 *  unmounted — during combat, which gets the full width. */
export function PhoneControlPanel({ hidden = false }: { hidden?: boolean }) {
  const fullscreenOk = useFullscreenSupported();
  return (
    <aside
      className={`${hidden ? "hidden" : "flex"} h-full w-[188px] shrink-0 flex-col justify-between gap-2 border-r border-parchment/15 bg-ink/95 p-2`}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <TouchButton label="Party" keyName="p" className={PHONE_BTN} />
        <TouchButton label="Quests" keyName="q" className={PHONE_BTN} />
        <TouchButton label="Journal" keyName="j" className={PHONE_BTN} />
        <TouchButton label="Log" keyName="l" className={PHONE_BTN} />
        <TouchButton label="Help" keyName="h" className={PHONE_BTN} />
        <TouchButton label="Hold to see the whole map" keyName="z" hold className={PHONE_BTN}>
          Map
        </TouchButton>
        {fullscreenOk ? (
          <TouchButton label="Fullscreen" keyName="f" className={`${PHONE_BTN} col-span-2`}>
            ⛶ Fullscreen
          </TouchButton>
        ) : null}
      </div>
      <div className="grid grid-cols-3 grid-rows-3 justify-items-center gap-1 self-center">
        <span />
        <TouchButton label="Up" keyName="ArrowUp" repeat className={PHONE_DPAD}>▲</TouchButton>
        <span />
        <TouchButton label="Left" keyName="ArrowLeft" repeat className={PHONE_DPAD}>◀</TouchButton>
        <TouchButton label="Wait a turn" keyName=" " className={`${PHONE_DPAD} text-xs`}>Wait</TouchButton>
        <TouchButton label="Right" keyName="ArrowRight" repeat className={PHONE_DPAD}>▶</TouchButton>
        <span />
        <TouchButton label="Down" keyName="ArrowDown" repeat className={PHONE_DPAD}>▼</TouchButton>
        <span />
      </div>
    </aside>
  );
}

/** Full-screen "turn your device" card for touch devices held
 *  upright. The layouts are landscape-first; portrait is unsupported. */
export function RotateDevicePrompt() {
  const portrait = usePortrait();
  if (!portrait) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-[#0c0c14] p-8 text-center text-parchment">
      <div className="text-6xl" aria-hidden>
        ⟳
      </div>
      <p className="font-display text-2xl">Turn your device sideways</p>
      <p className="max-w-sm text-sm text-parchment/70">
        Wilderstep plays in landscape. Rotate your screen to continue.
      </p>
    </div>
  );
}

// ── Press-and-hold tooltips ────────────────────────────────────────

/** How long a finger must rest on an element before its tooltip shows. */
const HOLD_TOOLTIP_MS = 450;
/** Finger travel (px) that cancels a hold — it's a scroll, not a press. */
const HOLD_SLOP_PX = 10;

/**
 * Touch stand-in for hover tooltips. Everything in the play screens
 * explains itself through `title` (item descriptions, effect
 * durations, why a button is disabled…), which a finger can never
 * see. Pressing and holding any element that has a title shows that
 * text in a bubble instead — and swallows the tap that would
 * otherwise follow, so holding a shop row reads it instead of
 * buying it. Render only on touch devices.
 */
export function TouchTooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let holdTimer: number | undefined;
    let startX = 0;
    let startY = 0;
    let swallowClick = false;

    const cancelHold = () => {
      window.clearTimeout(holdTimer);
      holdTimer = undefined;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // Any new touch dismisses a showing bubble.
      setTip(null);
      cancelHold();
      const el = (e.target as Element | null)?.closest?.("[title]") as HTMLElement | null;
      const text = el?.getAttribute("title")?.trim();
      if (!el || !text) return;
      startX = e.clientX;
      startY = e.clientY;
      holdTimer = window.setTimeout(() => {
        holdTimer = undefined;
        const r = el.getBoundingClientRect();
        const below = r.top < 120;
        setTip({
          text,
          x: Math.min(Math.max(r.left + r.width / 2, 120), window.innerWidth - 120),
          y: below ? r.bottom + 8 : r.top - 8,
          below,
        });
        swallowClick = true;
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setTip(null), 5000);
      }, HOLD_TOOLTIP_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (holdTimer === undefined) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > HOLD_SLOP_PX) cancelHold();
    };
    // Capture phase so the swallowed click never reaches the row.
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContextMenu = (e: Event) => {
      // iOS / Android raise a context menu on long-press; ours wins.
      if (swallowClick || holdTimer !== undefined) e.preventDefault();
    };

    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", cancelHold, true);
    window.addEventListener("pointercancel", cancelHold, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      cancelHold();
      window.clearTimeout(hideTimer.current);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", cancelHold, true);
      window.removeEventListener("pointercancel", cancelHold, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[70] max-w-[16rem] whitespace-pre-line rounded-md border border-parchment/30 bg-[#161629] px-3 py-2 text-sm leading-snug text-parchment shadow-xl"
      style={{
        left: tip.x,
        top: tip.y,
        transform: tip.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      {tip.text}
    </div>
  );
}
