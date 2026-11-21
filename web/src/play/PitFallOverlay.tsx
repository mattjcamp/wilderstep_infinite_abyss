"use client";

/**
 * Fall card — shown after the party drops through a pit in a dungeon
 * and lands on the floor below. A pixel figure tumbling into a broken
 * hole, a line saying where the party ended up, then one row per party
 * member with the damage the fall did (falls never take anyone below
 * 1 HP; members already down are untouched).
 *
 * Closes on Enter / Esc / Space / E or a backdrop click. Movement keys
 * are swallowed so the party doesn't walk off under it.
 */

import { useEffect } from "react";
import { spriteUrl } from "@/data_model/spriteUrl";
import type { PitFallLine } from "./pitFall";

const SWALLOW = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "w", "a", "s", "d", "W", "A", "S", "D",
]);

/** 16×16 pixel icon: a jagged hole with a little figure dropping into
 *  it, bobbing down by a pixel on a loop. Flat colours + crispEdges. */
function FallingIcon() {
  const px = (x: number, y: number, w: number, h: number, fill: string) => (
    <rect key={`${x}-${y}-${w}-${h}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} />
  );
  const hole = [
    px(1, 10, 14, 5, "#6b4a2b"),
    px(2, 11, 12, 3, "#0b0806"),
    px(1, 11, 1, 2, "#3a2716"), px(14, 11, 1, 2, "#3a2716"),
    px(4, 10, 2, 1, "#0b0806"), px(9, 10, 3, 1, "#0b0806"),
    px(3, 14, 2, 1, "#0b0806"), px(10, 14, 2, 1, "#0b0806"),
  ];
  const figure = [
    px(7, 2, 2, 2, "#f3d2a2"),            // head
    px(6, 4, 4, 3, "#c0392b"),            // body
    px(4, 3, 2, 1, "#f3d2a2"), px(10, 3, 2, 1, "#f3d2a2"), // arms flung up
    px(6, 7, 1, 2, "#3b2a1a"), px(9, 7, 1, 2, "#3b2a1a"),  // legs
  ];
  const debris = [px(3, 5, 1, 1, "#8a6a44"), px(12, 6, 1, 1, "#8a6a44"), px(11, 1, 1, 1, "#8a6a44")];
  return (
    <svg
      viewBox="0 0 16 16"
      width={128}
      height={128}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="drop-shadow-[0_0_18px_rgba(0,0,0,0.6)]"
    >
      <style>{`
        @keyframes pf-drop { 0%,49% { transform: translateY(0) } 50%,100% { transform: translateY(1px) } }
        .pf-drop { animation: pf-drop 0.5s steps(1) infinite; }
      `}</style>
      {hole}
      <g className="pf-drop">
        {figure}
        {debris}
      </g>
    </svg>
  );
}

export function PlayPitFallOverlay({
  floorName,
  lines,
  onClose,
}: {
  /** Where the party landed, e.g. "Sanctum (Floor 2)". */
  floorName: string;
  lines: ReadonlyArray<PitFallLine>;
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

  const hurt = lines.filter((l) => l.taken > 0);
  const totalTaken = hurt.reduce((sum, l) => sum + l.taken, 0);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
    >
      <article
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pitfall-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-amber-700/50 bg-ink/95 shadow-2xl shadow-black/60"
      >
        <header className="flex flex-col items-center px-5 pt-5">
          <FallingIcon />
          <h2 id="pitfall-title" className="mt-2 font-display text-3xl text-parchment">
            You Fell Through a Pit!
          </h2>
          <p className="mt-1 text-center text-base text-parchment/70">
            The floor gives way beneath you. The party plunges down to{" "}
            <span className="text-parchment/90">{floorName}</span> and lands hard.
          </p>
          <p className="mt-1 text-center text-sm text-parchment/60">
            {hurt.length === 0
              ? "Bruised, but no one was hurt."
              : `The fall cost the party ${totalTaken} HP in all.`}
          </p>
        </header>

        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {lines.map((l) => (
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
                <span className="text-sm italic text-parchment/50">Already fallen</span>
              ) : l.taken > 0 ? (
                <span className="shrink-0 text-base tabular-nums text-ember" title="Fall damage">
                  −{l.taken} HP
                  <span className="ml-1 text-xs text-parchment/50">
                    {l.hp}/{l.maxHp ?? l.hp}
                  </span>
                </span>
              ) : (
                <span className="shrink-0 text-sm text-parchment/60">
                  Unhurt
                  <span className="ml-1 text-xs text-parchment/50">
                    {l.hp}/{l.maxHp ?? l.hp}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>

        <footer className="flex justify-center px-5 pb-5">
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
