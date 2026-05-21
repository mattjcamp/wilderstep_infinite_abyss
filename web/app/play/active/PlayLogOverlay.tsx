"use client";

/**
 * Adventure log modal — opens with `L` from the play screen. Shows
 * the full back-buffer of in-world messages: tile text, lock /
 * link narration, boss approach warnings, combat outcomes, trap
 * triggers, spell casts, etc.
 *
 * The PlayHost retains the message buffer in state and slices the
 * latest N off for the in-canvas SceneLog strip; this overlay
 * renders the whole list. Newest at the bottom — same convention
 * the bottom strip uses.
 *
 * Read-only. ESC and L close.
 */

import { useEffect, useRef } from "react";

export function PlayLogOverlay({
  messages,
  onClose,
}: {
  messages: ReadonlyArray<string>;
  onClose: () => void;
}) {
  // ESC and L close. Capture so the sim's movement keys don't fire
  // under the modal. Arrow keys are swallowed too — the body might
  // try to scroll otherwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "l" || e.key === "L") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      } else if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "w" ||
        e.key === "a" ||
        e.key === "s" ||
        e.key === "d" ||
        e.key === "W" ||
        e.key === "A" ||
        e.key === "S" ||
        e.key === "D"
      ) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  // Auto-scroll to the bottom on mount so the player sees the most
  // recent line first. Hooks at render time rather than via a
  // useEffect because the list is short — no flicker risk.
  const listRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h2 className="font-display text-base text-parchment">
            Adventure Log
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
            title="Close (L or ESC)"
          >
            Close
          </button>
        </div>
        {messages.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-parchment/55">
            No log messages yet. Walk around and interact with the
            world to see entries here.
          </p>
        ) : (
          <ol
            ref={listRef}
            className="flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-snug text-parchment/80"
          >
            {messages.map((msg, i) => (
              <li
                key={`${i}-${msg}`}
                className="border-b border-parchment/10 py-0.5 last:border-b-0"
              >
                {msg}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
