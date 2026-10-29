/**
 * Browser fullscreen for Play mode.
 *
 * The Fullscreen API only works from a user gesture (a click or a key
 * press), so it can't be switched on when /play/active loads by itself.
 * Instead the screens that START a game (Begin, load slot, Return to
 * Game, Continue) call `enterFullscreen()` from their click / key
 * handler, and in game the F key toggles it.
 *
 * Every call is best-effort: a browser that refuses (no gesture, an
 * iframe without permission, iOS Safari on iPhone) just leaves the page
 * as it was — the game still fills the browser window.
 *
 * While fullscreen, Chromium browsers also lock the Escape key (the
 * Keyboard Lock API) so Esc keeps closing the game's own menus instead
 * of dropping out of fullscreen; holding Esc still exits. Other
 * browsers exit fullscreen on Esc as usual.
 */

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type KeyboardLock = {
  lock?: (codes?: string[]) => Promise<void>;
  unlock?: () => void;
};

function keyboardApi(): KeyboardLock | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
}

export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as FsDocument;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export function enterFullscreen(): void {
  if (typeof document === "undefined" || isFullscreen()) return;
  const el = document.documentElement as FsElement;
  try {
    const p = el.requestFullscreen
      ? el.requestFullscreen({ navigationUI: "hide" })
      : el.webkitRequestFullscreen?.();
    void Promise.resolve(p)
      .then(() => keyboardApi()?.lock?.(["Escape"]))
      .catch(() => {
        // Refused (no gesture / not allowed) — stay windowed.
      });
  } catch {
    // Older browsers throw synchronously instead of rejecting.
  }
}

export function exitFullscreen(): void {
  if (typeof document === "undefined" || !isFullscreen()) return;
  const d = document as FsDocument;
  try {
    keyboardApi()?.unlock?.();
    const p = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.();
    void Promise.resolve(p).catch(() => {});
  } catch {
    // Best-effort.
  }
}

export function toggleFullscreen(): void {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
}
