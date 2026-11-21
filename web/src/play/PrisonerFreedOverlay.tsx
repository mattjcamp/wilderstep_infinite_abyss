"use client";

/**
 * Prisoner freed — shown instead of the NPC's usual dialog the first
 * time the party talks to a generated dungeon's prisoner. Says plainly
 * who they are and that the party is setting them free, gives their
 * words of thanks (their first authored dialog line), then reports the
 * rewards: the meeting XP and the item they hand over. When it closes
 * the prisoner slips away toward the surface.
 *
 * Closes on Enter / Esc / Space / E or a backdrop click. Movement keys
 * are swallowed so the party doesn't walk off under it.
 */

import { useEffect } from "react";
import { spriteUrl } from "@/data_model/spriteUrl";

const SWALLOW = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "w", "a", "s", "d", "W", "A", "S", "D",
]);

export interface PrisonerFreedInfo {
  name: string;
  /** NPC sprite path (as in npcs.json). */
  sprite?: string;
  /** Their first dialog line, shown as thanks. */
  thanks?: string;
  /** Meeting XP granted (0 = none, e.g. already met). */
  xp: number;
  /** The reward item, if any. */
  item?: { name: string; icon?: string };
  /** Lines for any level-ups the XP caused. */
  levelUps?: string[];
}

/** 16×16 pixel icon: an iron shackle snapped open, links flying. */
function BrokenShackles() {
  const px = (x: number, y: number, w: number, h: number, fill: string) => (
    <rect key={`${x}-${y}-${w}-${h}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} />
  );
  const iron = "#9aa3ad";
  const dark = "#4b5560";
  return (
    <svg viewBox="0 0 16 16" width={96} height={96} shapeRendering="crispEdges" aria-hidden="true">
      <style>{`
        @keyframes pf-spark { 0%,49% { opacity: 1 } 50%,100% { opacity: 0.2 } }
        .pf-spark { animation: pf-spark 0.6s steps(1) infinite; }
      `}</style>
      {/* left cuff, open */}
      {px(1, 6, 1, 5, iron)}{px(2, 5, 3, 1, iron)}{px(2, 11, 3, 1, iron)}{px(5, 6, 1, 2, iron)}
      {px(2, 6, 3, 5, dark)}
      {/* right cuff, open */}
      {px(14, 6, 1, 5, iron)}{px(11, 5, 3, 1, iron)}{px(11, 11, 3, 1, iron)}{px(10, 9, 1, 2, iron)}
      {px(11, 6, 3, 5, dark)}
      {/* the snapped chain between them */}
      {px(6, 7, 1, 1, iron)}{px(9, 8, 1, 1, iron)}
      <g className="pf-spark">
        {px(7, 4, 1, 1, "#ffe9a8")}{px(8, 3, 1, 1, "#fff6d8")}{px(8, 12, 1, 1, "#ffe9a8")}{px(7, 13, 1, 1, "#fff6d8")}
      </g>
    </svg>
  );
}

export function PlayPrisonerFreedOverlay({
  info,
  onClose,
}: {
  info: PrisonerFreedInfo;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["Escape", "Enter", " ", "e", "E"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (SWALLOW.has(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  const hasRewards = info.xp > 0 || !!info.item;
  return (
    <div onClick={onClose} className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <article
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prisoner-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-amber-500/50 bg-ink/95 shadow-2xl shadow-black/60"
      >
        <header className="flex flex-col items-center px-5 pt-5">
          <div className="flex items-center gap-3">
            <BrokenShackles />
            {info.sprite ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={spriteUrl(info.sprite)}
                alt=""
                width={80}
                height={80}
                style={{ imageRendering: "pixelated" }}
              />
            ) : null}
          </div>
          <h2 id="prisoner-title" className="mt-2 font-display text-3xl text-parchment">
            Prisoner Freed!
          </h2>
          <p className="mt-1 text-center text-base text-parchment/75">
            <span className="text-parchment/95">{info.name}</span> was being held prisoner
            in this cell. You break the shackles and set them free.
          </p>
          {info.thanks ? (
            <p className="mt-2 text-center text-sm italic text-parchment/70">
              “{info.thanks}”
            </p>
          ) : null}
        </header>

        <section className="px-5 py-4">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-parchment/60">Rewards</h3>
          {hasRewards ? (
            <ul className="space-y-2">
              {info.xp > 0 ? (
                <li className="flex items-center gap-3 rounded border border-parchment/15 bg-ink/40 px-3 py-2">
                  <span className="w-10 text-center text-xl text-amber-300">✦</span>
                  <span className="flex-1 font-display text-xl text-parchment">Experience</span>
                  <span className="text-base tabular-nums text-amber-200">+{info.xp} XP</span>
                </li>
              ) : null}
              {info.item ? (
                <li className="flex items-center gap-3 rounded border border-parchment/15 bg-ink/40 px-3 py-2">
                  {info.item.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={spriteUrl(`item/${info.item.icon}.png`)}
                      alt=""
                      width={40}
                      height={40}
                      className="shrink-0"
                      style={{ imageRendering: "pixelated" }}
                    />
                  ) : (
                    <span className="w-10 text-center text-xl text-parchment/70">◆</span>
                  )}
                  <span className="flex-1 font-display text-xl text-parchment">{info.item.name}</span>
                  <span className="text-sm text-parchment/60">added to inventory</span>
                </li>
              ) : null}
              {(info.levelUps ?? []).map((l) => (
                <li key={l} className="text-center text-sm text-amber-200">{l}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-parchment/65">They have nothing to give but their thanks.</p>
          )}
        </section>

        <footer className="flex flex-col items-center gap-2 px-5 pb-5">
          <p className="text-xs text-parchment/55">{info.name} will make their own way back to the surface.</p>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded border border-amber-600/60 bg-amber-900/30 px-5 py-1.5 font-display text-lg text-parchment hover:bg-amber-800/40"
          >
            Continue
          </button>
        </footer>
      </article>
    </div>
  );
}
