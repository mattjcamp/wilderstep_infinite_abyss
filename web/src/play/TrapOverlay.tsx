"use client";

/**
 * Trap card — shown when the party sets off a trap. Names the trap
 * (with its description), says what happened in one line, then one row
 * per party member: who was hit, for how much and what kind of damage,
 * whether they made their save, any affliction, and who was knocked out.
 *
 * Closes on Enter / Esc / Space / E or a backdrop click. Movement keys
 * are swallowed so the party doesn't walk off under it.
 */

import { useEffect } from "react";
import { spriteUrl } from "@/data_model/spriteUrl";
import type { TrapCard } from "./traps";

const SWALLOW = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "w", "a", "s", "d", "W", "A", "S", "D",
]);

/** Accent colour per damage type — matches the in-world burst. */
const ACCENT: Record<string, string> = {
  fire: "#ff7a1a",
  cold: "#7fd4ff",
  lightning: "#ffe55c",
  poison: "#7ddc4a",
  acid: "#b6e34a",
  magic: "#b07cff",
  necrotic: "#8a5cc2",
  piercing: "#d8d2c4",
  slashing: "#d8d2c4",
  bludgeoning: "#c9b48a",
};

/** 16×16 pixel icon: a sprung pressure plate with the trap's payload
 *  (darts, or a burst in the damage type's colour) flashing above it. */
function TrapIcon({ damageType, teleport }: { damageType?: string; teleport: boolean }) {
  const accent = teleport ? "#b07cff" : ACCENT[damageType ?? ""] ?? "#ff7a1a";
  const px = (x: number, y: number, w: number, h: number, fill: string) => (
    <rect key={`${x}-${y}-${w}-${h}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} />
  );
  const plate = [
    px(2, 12, 12, 3, "#4a4036"),
    px(3, 12, 10, 1, "#6e6252"),
    px(4, 13, 8, 1, "#2a241e"),
    px(5, 11, 6, 1, "#8a7c66"),
  ];
  const darts = damageType === "piercing" || damageType === "slashing";
  const payload = darts
    ? [
        px(2, 4, 4, 1, accent), px(6, 4, 1, 1, "#7a6a50"),
        px(9, 2, 4, 1, accent), px(13, 2, 1, 1, "#7a6a50"),
        px(5, 7, 4, 1, accent), px(9, 7, 1, 1, "#7a6a50"),
      ]
    : [
        px(7, 2, 2, 8, accent),
        px(4, 5, 8, 2, accent),
        px(5, 3, 1, 1, accent), px(10, 3, 1, 1, accent),
        px(5, 8, 1, 1, accent), px(10, 8, 1, 1, accent),
        px(7, 5, 2, 2, "#fff6d8"),
      ];
  return (
    <svg
      viewBox="0 0 16 16"
      width={112}
      height={112}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ filter: `drop-shadow(0 0 14px ${accent}88)` }}
    >
      <style>{`
        @keyframes tc-flash { 0%,49% { opacity: 1 } 50%,100% { opacity: 0.55 } }
        .tc-flash { animation: tc-flash 0.4s steps(1) infinite; }
      `}</style>
      {plate}
      <g className="tc-flash">{payload}</g>
    </svg>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function PlayTrapOverlay({
  card,
  onClose,
}: {
  card: TrapCard;
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

  const showRows = card.kind === "damage" || card.kind === "effect";
  const dmgWord = card.damageType ? `${card.damageType}` : "";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
    >
      <article
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trapcard-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-ember/50 bg-ink/95 shadow-2xl shadow-black/60"
      >
        <header className="flex flex-col items-center px-5 pt-5">
          <TrapIcon damageType={card.damageType} teleport={card.kind === "teleport"} />
          <h2 id="trapcard-title" className="mt-2 font-display text-3xl text-parchment">
            It&apos;s a Trap! — {card.trapName}
          </h2>
          {card.description ? (
            <p className="mt-1 text-center text-sm italic text-parchment/65">
              {card.description}
            </p>
          ) : null}
          <p className="mt-2 text-center text-base text-parchment/85">{card.summary}</p>
          {card.save ? (
            <p className="mt-1 text-center text-xs text-parchment/55">
              {cap(card.save.stat)} save, DC {card.save.dc} — a success halves the damage
              and avoids any affliction.
            </p>
          ) : null}
        </header>

        {showRows ? (
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
            {card.lines.map((l) => (
              <li
                key={l.id}
                className={`flex items-center gap-3 rounded border px-3 py-2 ${
                  l.targeted ? "border-ember/40 bg-ember/10" : "border-parchment/15 bg-ink/40"
                }`}
              >
                {l.sprite ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={spriteUrl(l.sprite)}
                    alt=""
                    width={40}
                    height={40}
                    className="shrink-0"
                    style={{
                      imageRendering: "pixelated",
                      opacity: l.fallen || l.knockedOut ? 0.4 : 1,
                    }}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-xl text-parchment">{l.name}</div>
                  {l.targeted ? (
                    <div className="text-xs text-parchment/60">
                      {l.saveTotal !== undefined
                        ? l.saved
                          ? `Dodged (rolled ${l.saveTotal}) — half damage`
                          : `Failed the save (rolled ${l.saveTotal})`
                        : "Caught by the trap"}
                      {l.effect ? (
                        <span className="ml-1 text-violet-300">· {cap(l.effect)}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {l.fallen ? (
                  <span className="text-sm italic text-parchment/50">Already fallen</span>
                ) : !l.targeted ? (
                  <span className="shrink-0 text-sm text-parchment/60">
                    Not hit
                    <span className="ml-1 text-xs text-parchment/50">
                      {l.hp}/{l.maxHp ?? l.hp}
                    </span>
                  </span>
                ) : (
                  <span className="shrink-0 text-right tabular-nums">
                    {l.damage > 0 ? (
                      <span className="text-base text-ember" title={`${dmgWord} damage`}>
                        −{l.damage} HP
                        {dmgWord ? (
                          <span className="ml-1 text-xs text-parchment/55">{dmgWord}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-sm text-parchment/70">No damage</span>
                    )}
                    <span className="block text-xs text-parchment/50">
                      {l.knockedOut ? (
                        <span className="font-semibold text-red-400">Knocked out!</span>
                      ) : (
                        `${l.hp}/${l.maxHp ?? l.hp}`
                      )}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-2" />
        )}

        <footer className="flex justify-center px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded border border-ember/60 bg-ember/20 px-5 py-1.5 font-display text-lg text-parchment hover:bg-ember/30"
          >
            Continue
          </button>
        </footer>
      </article>
    </div>
  );
}
