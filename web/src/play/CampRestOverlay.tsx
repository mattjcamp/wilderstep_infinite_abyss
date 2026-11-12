"use client";

/**
 * Camp dialog — shown after the party rests with Camping Supplies. A
 * flickering pixel campfire, then one row per party member with the HP
 * and MP the rest restored (and where they now stand). Fallen members
 * are listed as still down — camping doesn't raise the dead.
 *
 * Closes on Enter / Esc / Space / E or a backdrop click. Movement keys
 * are swallowed so the party doesn't walk off under it.
 */

import { useEffect } from "react";
import { spriteUrl } from "@/data_model/spriteUrl";
import type { CampRestReport } from "./campRest";

const SWALLOW = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "w", "a", "s", "d", "W", "A", "S", "D",
]);

/** 16×16 pixel campfire, two flame frames swapped by CSS so it
 *  flickers. Flat colors + crispEdges — no anti-aliasing, in keeping
 *  with the game's pixel style. */
function Campfire() {
  const px = (x: number, y: number, w: number, h: number, fill: string, key?: string) => (
    <rect key={key ?? `${x}-${y}-${w}-${h}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} />
  );
  const logs = [
    px(2, 13, 12, 2, "#6b4226"),
    px(1, 12, 3, 2, "#8a5a34"),
    px(12, 12, 3, 2, "#8a5a34"),
    px(4, 14, 8, 1, "#4a2c18"),
  ];
  const frameA = [
    px(6, 4, 2, 2, "#f59e0b"), px(5, 6, 6, 2, "#f59e0b"), px(4, 8, 8, 4, "#f97316"),
    px(7, 7, 2, 2, "#fde68a"), px(6, 9, 4, 3, "#fcd34d"), px(9, 3, 1, 2, "#f97316"),
  ];
  const frameB = [
    px(8, 3, 2, 2, "#f59e0b"), px(5, 5, 5, 3, "#f59e0b"), px(4, 8, 8, 4, "#f97316"),
    px(6, 6, 2, 2, "#fde68a"), px(6, 9, 4, 3, "#fcd34d"), px(5, 4, 1, 2, "#f97316"),
  ];
  return (
    <svg
      viewBox="0 0 16 16"
      width={128}
      height={128}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="drop-shadow-[0_0_18px_rgba(249,115,22,0.55)]"
    >
      <style>{`
        @keyframes cr-a { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        @keyframes cr-b { 0%,49% { opacity: 0 } 50%,100% { opacity: 1 } }
        .cr-a { animation: cr-a 0.5s steps(1) infinite; }
        .cr-b { animation: cr-b 0.5s steps(1) infinite; }
      `}</style>
      <g className="cr-a">{frameA}</g>
      <g className="cr-b">{frameB}</g>
      {logs}
    </svg>
  );
}

export function PlayCampRestOverlay({
  report,
  onClose,
}: {
  report: CampRestReport;
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

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
    >
      <article
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="camp-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-orange-300/40 bg-ink/95 shadow-2xl shadow-orange-500/20"
      >
        <header className="flex flex-col items-center px-5 pt-5">
          <Campfire />
          <h2 id="camp-title" className="mt-2 font-display text-3xl text-parchment">
            {report.sleptToMorning ? "Camped Until Dawn" : "The Party Makes Camp"}
          </h2>
          <p className="mt-1 text-center text-base text-parchment/70">
            {report.sleptToMorning
              ? "You rest through the night by the fire. Wounds close and magic returns."
              : "You rest a while by the fire. Wounds close and magic returns."}
          </p>
        </header>

        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {report.lines.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-3 rounded border border-parchment/15 bg-ink/40 px-3 py-2"
            >
              {l.sprite ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={spriteUrl(l.sprite)}
                  alt=""
                  width={40}
                  height={40}
                  className="shrink-0"
                  style={{ imageRendering: "pixelated", opacity: l.fallen ? 0.4 : 1 }}
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate font-display text-xl text-parchment">
                {l.name}
              </span>
              {l.fallen ? (
                <span className="text-sm italic text-ember/90">Still fallen</span>
              ) : (
                <span className="flex shrink-0 gap-4 text-base tabular-nums">
                  <span className="text-emerald-300" title="Hit points restored">
                    +{l.hpGained} HP
                    <span className="ml-1 text-xs text-parchment/50">
                      {l.hp}/{l.maxHp ?? l.hp}
                    </span>
                  </span>
                  <span className="text-sky-300" title="Magic points restored">
                    +{l.mpGained} MP
                    <span className="ml-1 text-xs text-parchment/50">
                      {l.mp}/{l.maxMp ?? l.mp}
                    </span>
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>

        <footer className="flex justify-end border-t border-parchment/15 px-5 py-2.5">
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded border border-orange-300/50 px-4 py-1 text-sm text-parchment hover:bg-orange-300/15"
            title="Continue (Enter or Esc)"
          >
            Continue
          </button>
        </footer>
      </article>
    </div>
  );
}
