"use client";

/**
 * Help tips modal — opens with `H` from the play screen. Static
 * content: a cheat-sheet of keyboard shortcuts and short gameplay
 * tips. The list is hand-curated rather than auto-generated so the
 * phrasing reads as a friendly tutorial instead of a key dump.
 *
 * Read-only. ESC and H close.
 */

import { useEffect } from "react";

interface ShortcutRow {
  key: string;
  description: string;
}

const MOVE_SHORTCUTS: ShortcutRow[] = [
  { key: "↑ ↓ ← →", description: "Move the party one tile in that direction" },
  { key: "W A S D", description: "Alternate movement keys" },
];

const INSPECTOR_SHORTCUTS: ShortcutRow[] = [
  { key: "P", description: "Party screen — roster, gold, shared stash, party effects" },
  { key: "Q", description: "Quest log — active quests, what's left to do, completed ones" },
  { key: "L", description: "Adventure log — full back-buffer of in-world messages" },
  { key: "H", description: "This help screen" },
];

const COMBAT_SHORTCUTS: ShortcutRow[] = [
  { key: "↑ ↓ ← →", description: "Move the cursor / step the active combatant" },
  { key: "Enter", description: "Activate the highlighted action / pick a target" },
  { key: "Space", description: "End turn" },
  { key: "Esc", description: "Cancel the current sub-mode (target picker, etc.)" },
  { key: "1 - 9", description: "Pick an option from a list (target, spell, item)" },
];

const TIPS: string[] = [
  "Torches and the Light spell brighten the party's light radius. Effects with a duration count down per step you take — watch the Effects panel on the Party screen.",
  "Detect Traps reveals nearby trap tiles as red X marks when at least one party member is a Thief (or Ranger Lv 3+) and you can see the tile in your light radius.",
  "Boats stay where you leave them. Hop onto a boat to sail; step onto land to disembark.",
  "Talk to NPCs by walking into them. Shops, locked doors, and quest givers all use the same step-to-interact pattern.",
  "Combat uses a dedicated battle screen. Spawn lairs that you defeat are gone for good; placed encounters never respawn either.",
];

export function PlayHelpTipsOverlay({
  onClose,
}: {
  onClose: () => void;
}) {
  // ESC and H close. Capture so the underlying sim's movement keys
  // don't fire under the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "h" || e.key === "H") {
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

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h2 className="font-display text-base text-parchment">
            Help &amp; Tips
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
            title="Close (H or ESC)"
          >
            Close
          </button>
        </div>
        <div className="space-y-4 p-3">
          <ShortcutSection title="Movement" rows={MOVE_SHORTCUTS} />
          <ShortcutSection title="Inspector Screens" rows={INSPECTOR_SHORTCUTS} />
          <ShortcutSection title="Combat" rows={COMBAT_SHORTCUTS} />
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-amber-300">
              Tips
            </h3>
            <ul className="mt-1 space-y-2 text-xs text-parchment/75">
              {TIPS.map((t, i) => (
                <li
                  key={i}
                  className="rounded border border-parchment/15 bg-ink/40 px-2 py-1.5 leading-snug"
                >
                  {t}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function ShortcutSection({
  title,
  rows,
}: {
  title: string;
  rows: ShortcutRow[];
}) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wide text-amber-300">
        {title}
      </h3>
      <ul className="mt-1 space-y-1 text-xs">
        {rows.map((row, i) => (
          <li
            key={i}
            className="grid grid-cols-[7rem_1fr] items-baseline gap-2"
          >
            <kbd className="rounded border border-parchment/30 bg-ink/60 px-1.5 py-0.5 text-center font-mono text-[11px] text-parchment/90">
              {row.key}
            </kbd>
            <span className="text-parchment/80">{row.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
