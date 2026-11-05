"use client";

/**
 * Main-quest finale — the once-per-playthrough celebration that opens
 * when the module's main quest (`main_quest: true`) is turned in.
 *
 * Full-screen, animated: a slow-turning gold sunburst behind the
 * title, falling confetti, then a staggered recap of the adventure
 * (stat tiles that count up, and the party with their levels). One
 * button — "Continue adventuring" — dismisses it so the player can
 * keep exploring the world.
 *
 * Pure presentation: the host computes the {@link AdventureRecap},
 * plays the fanfare and owns open/close state. Keys: Enter / Space /
 * Esc dismiss (after a short grace period so the Enter that turned
 * the quest in can't instantly skip the moment); every other key is
 * swallowed so the world doesn't move underneath. Honours
 * prefers-reduced-motion (no confetti / spin / count-up).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { AdventureRecap } from "@/play/adventureRecap";

/** Keys are ignored this long after opening (ms). */
const KEY_GRACE_MS = 1400;
/** Count-up duration for each stat tile (ms). */
const COUNT_MS = 1100;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Animates 0 → `target` starting after `delayMs`. */
function CountUp({
  target,
  delayMs,
  instant,
}: {
  target: number;
  delayMs: number;
  instant: boolean;
}) {
  const [value, setValue] = useState(instant ? target : 0);
  useEffect(() => {
    if (instant) {
      setValue(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const timer = setTimeout(() => {
      const tick = (t: number) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / COUNT_MS);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - p, 3);
        setValue(Math.round(target * eased));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, delayMs, instant]);
  return <>{value.toLocaleString()}</>;
}

export function PlayMainQuestFinale({
  recap,
  onDismiss,
}: {
  recap: AdventureRecap;
  onDismiss: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const openedAt = useRef(Date.now());
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setReady(true);
      buttonRef.current?.focus({ preventScroll: true });
    }, KEY_GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // This overlay owns the keyboard while it's up: nothing reaches
      // the world sim, the inspector keys (P/Q/L/H) or the save key.
      e.stopPropagation();
      const k = e.key;
      if (k === "Enter" || k === " " || k === "Escape") {
        e.preventDefault();
        if (Date.now() - openedAt.current < KEY_GRACE_MS) return;
        onDismiss();
        return;
      }
      if (k.startsWith("Arrow") || k === "Tab") e.preventDefault();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onDismiss]);

  // Confetti: fixed pseudo-random layout per mount.
  const confetti = useMemo(() => {
    const colors = ["#e8c97a", "#ffd750", "#c8553d", "#f6efd6", "#7dd3a3"];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    return Array.from({ length: 70 }, (_, i) => ({
      left: rnd() * 100,
      delay: rnd() * 2.6,
      dur: 3.2 + rnd() * 2.8,
      size: 5 + rnd() * 7,
      drift: (rnd() - 0.5) * 160,
      spin: 360 + rnd() * 720,
      color: colors[i % colors.length],
      round: rnd() > 0.6,
    }));
  }, []);

  const stats: Array<{ label: string; value: number; icon: string }> = [
    { label: "Quests completed", value: recap.questsCompleted, icon: "⚜" },
    { label: "Encounters won", value: recap.encountersWon, icon: "⚔" },
    { label: "Dungeons cleared", value: recap.dungeonsCleared, icon: "✓" },
    { label: "Experience earned", value: recap.totalXp, icon: "★" },
    { label: "Places discovered", value: recap.placesDiscovered, icon: "⌂" },
    { label: "People met", value: recap.peopleMet, icon: "☺" },
    { label: "Gold in purse", value: recap.gold, icon: "◉" },
    { label: recap.days === 1 ? "Day on the road" : "Days on the road", value: recap.days, icon: "☼" },
  ];

  const statsStart = reduced ? 0 : 1.1; // seconds
  const partyStart = statsStart + stats.length * 0.09 + 0.3;

  return (
    <div
      className="wsf-root fixed inset-0 z-[60] flex items-center justify-center overflow-hidden p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wsf-title"
    >
      <style>{FINALE_CSS}</style>
      <div className="wsf-backdrop absolute inset-0" />
      {!reduced ? (
        <>
          <div className="wsf-sunburst pointer-events-none absolute left-1/2 top-[22%]" />
          <div className="pointer-events-none absolute inset-0">
            {confetti.map((c, i) => (
              <span
                key={i}
                className="wsf-confetti absolute top-0"
                style={
                  {
                    left: `${c.left}%`,
                    width: c.size,
                    height: c.round ? c.size : c.size * 0.45,
                    background: c.color,
                    borderRadius: c.round ? "50%" : 1,
                    animationDelay: `${c.delay}s`,
                    animationDuration: `${c.dur}s`,
                    "--wsf-drift": `${c.drift}px`,
                    "--wsf-spin": `${c.spin}deg`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        </>
      ) : null}

      <div className="wsf-panel relative flex max-h-full w-full max-w-2xl flex-col overflow-y-auto rounded-xl border border-amber-300/60 bg-ink/95 px-6 py-6 text-center shadow-2xl shadow-amber-300/25 sm:px-8">
        <p className="wsf-rise text-[11px] uppercase tracking-[0.35em] text-amber-200/80" style={{ animationDelay: "0.15s" }}>
          ★ Main Quest Complete ★
        </p>
        <h1
          id="wsf-title"
          className="wsf-title mt-2 font-display text-3xl leading-tight text-amber-200 sm:text-4xl"
        >
          {recap.questName}
        </h1>
        <p className="wsf-rise mt-2 text-sm text-parchment/75" style={{ animationDelay: "0.7s" }}>
          Your tale will be sung in every tavern. The road goes on, if you wish to walk it.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((s, i) => {
            const delay = statsStart + i * 0.09;
            return (
              <div
                key={s.label}
                className="wsf-rise rounded-lg border border-parchment/15 bg-parchment/[0.04] px-2 py-2.5"
                style={{ animationDelay: `${delay}s` }}
              >
                <div className="font-display text-2xl text-parchment">
                  <span className="mr-1 text-base text-amber-200/80">{s.icon}</span>
                  <CountUp target={s.value} delayMs={delay * 1000} instant={reduced} />
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-parchment/55">
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>

        {recap.members.length > 0 ? (
          <div className="mt-5">
            <p
              className="wsf-rise text-[10px] uppercase tracking-[0.25em] text-parchment/50"
              style={{ animationDelay: `${partyStart}s` }}
            >
              The Party
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {recap.members.map((m, i) => (
                <div
                  key={m.id}
                  className="wsf-rise min-w-[7.5rem] rounded-lg border border-amber-300/30 bg-amber-300/5 px-3 py-2"
                  style={{ animationDelay: `${partyStart + 0.12 + i * 0.1}s` }}
                >
                  <div className="font-display text-base text-parchment">{m.name}</div>
                  <div className="text-xs text-amber-200/85">Level {m.level}</div>
                  <div className="text-[10px] text-parchment/50">
                    {m.exp.toLocaleString()} XP{m.alive ? "" : " · fallen"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div
          className="wsf-rise mt-6 flex flex-col items-center gap-1"
          style={{ animationDelay: `${partyStart + 0.5}s` }}
        >
          <button
            ref={buttonRef}
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-ember/70 bg-ember/25 px-6 py-2 font-display text-base text-parchment shadow-lg shadow-ember/20 outline-none transition hover:bg-ember/40 focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            Continue adventuring
          </button>
          <span className={`text-[10px] text-parchment/40 transition-opacity ${ready ? "opacity-100" : "opacity-0"}`}>
            Enter to continue
          </span>
        </div>
      </div>
    </div>
  );
}

const FINALE_CSS = `
.wsf-backdrop {
  background: radial-gradient(ellipse at 50% 30%, rgba(60,45,15,0.92), rgba(8,8,18,0.96) 70%);
  animation: wsf-fade 0.8s ease-out both;
}
.wsf-sunburst {
  width: 1400px; height: 1400px; margin-left: -700px; margin-top: -700px;
  background: repeating-conic-gradient(from 0deg, rgba(255,215,80,0.10) 0deg 8deg, transparent 8deg 20deg);
  -webkit-mask-image: radial-gradient(circle, #000 0%, transparent 60%);
          mask-image: radial-gradient(circle, #000 0%, transparent 60%);
  animation: wsf-fade 1.6s ease-out both, wsf-spin 60s linear infinite;
}
.wsf-panel { animation: wsf-pop 0.7s cubic-bezier(.2,1.4,.4,1) 0.1s both; }
.wsf-title {
  text-shadow: 0 0 18px rgba(255,215,80,0.55), 0 0 2px rgba(255,215,80,0.9);
  animation: wsf-title 1s cubic-bezier(.2,1.3,.4,1) 0.35s both, wsf-glow 3s ease-in-out 1.4s infinite;
}
.wsf-rise { animation: wsf-rise 0.55s ease-out both; }
.wsf-confetti {
  opacity: 0;
  animation-name: wsf-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@keyframes wsf-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes wsf-spin { to { transform: rotate(360deg) } }
@keyframes wsf-pop { from { opacity: 0; transform: scale(.85) translateY(16px) } to { opacity: 1; transform: none } }
@keyframes wsf-title { from { opacity: 0; transform: scale(.6); letter-spacing: .3em } to { opacity: 1; transform: none; letter-spacing: normal } }
@keyframes wsf-glow { 0%,100% { text-shadow: 0 0 18px rgba(255,215,80,.55), 0 0 2px rgba(255,215,80,.9) } 50% { text-shadow: 0 0 30px rgba(255,215,80,.85), 0 0 4px rgba(255,235,150,1) } }
@keyframes wsf-rise { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
@keyframes wsf-fall {
  0%   { opacity: 0; transform: translate3d(0,-20px,0) rotate(0) }
  8%   { opacity: 1 }
  85%  { opacity: 1 }
  100% { opacity: 0; transform: translate3d(var(--wsf-drift),105vh,0) rotate(var(--wsf-spin)) }
}
@media (prefers-reduced-motion: reduce) {
  .wsf-backdrop, .wsf-panel, .wsf-title, .wsf-rise { animation: none !important; }
}
`;
