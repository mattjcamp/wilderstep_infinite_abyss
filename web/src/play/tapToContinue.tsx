"use client";

/**
 * Tap-anywhere dismissal for notification dialogs (Camp, Trap, Pit
 * Fall, Prisoner Freed). A tap or click anywhere on the screen — card
 * or backdrop — closes the dialog, so players on a phone never have to
 * hunt for a small Continue button that may sit off the visible area.
 *
 * Briefly unarmed after opening so the tap that triggered the dialog
 * (e.g. "Use" on Camping Supplies) can't also dismiss it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const ARM_DELAY_MS = 350;

export function useTapToContinue(onClose: () => void) {
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = performance.now();
  }, []);
  return useCallback(() => {
    if (performance.now() - openedAt.current < ARM_DELAY_MS) return;
    onClose();
  }, [onClose]);
}

/** True on a touch-first device (coarse pointer). */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return coarse;
}

/** Footer hint that replaces the Continue button. */
export function TapToContinue() {
  const coarse = useCoarsePointer();
  return (
    <footer className="flex justify-center border-t border-parchment/15 px-5 py-2.5 short:py-1.5">
      <span className="animate-pulse text-sm tracking-wide text-parchment/70">
        {coarse ? "Tap anywhere to continue" : "Click anywhere or press Enter to continue"}
      </span>
    </footer>
  );
}
