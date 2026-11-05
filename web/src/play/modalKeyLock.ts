/**
 * Modal key lock — lets a small picker modal (heal / revive target,
 * Tinker, Craft, Brew) own the keyboard while it is open.
 *
 * Why a lock rather than stopPropagation: the Party screen, the
 * character sheet and the pickers all listen on `window` in the
 * capture phase. Listeners on the same target fire in REGISTRATION
 * order, and the screens underneath register first — so a picker that
 * mounts later can never pre-empt them. Arrow keys would move the
 * sheet's cursor under the modal, Enter would re-cast the spell, and
 * Esc would pop the character sheet instead of cancelling the picker.
 *
 * Instead each underlying handler checks {@link isModalKeyLocked} and
 * bails, and the picker holds the lock for as long as it is mounted
 * ({@link useModalKeyLock}). A counter, so nested modals nest.
 */

import { useEffect } from "react";

let holders = 0;

/** True while any picker modal holds the keyboard. */
export function isModalKeyLocked(): boolean {
  return holders > 0;
}

/** Take the lock; returns the release function (idempotent). */
export function acquireModalKeyLock(): () => void {
  holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
  };
}

/** Hold the lock for the lifetime of the calling component. */
export function useModalKeyLock(): void {
  useEffect(() => acquireModalKeyLock(), []);
}
