"use client";

/**
 * Self-dismissing placard that announces a quest step / quest
 * completion. Renders center-top of the viewport, fades in, holds,
 * fades out, then invokes `onDismiss` so the host can shift the next
 * item off its celebration queue.
 *
 * Visual style mirrors the gold accent used by the quest-relevance
 * halo (sim/questGlow.ts) so the celebration reads as part of the
 * same family. Two variants:
 *
 *   - `kind: "step"` — small, "Step Complete" label, subtle gold.
 *   - `kind: "quest"` — larger, "Quest Complete" label, brighter
 *     gold with a soft glow shadow. Reserved for full turn-ins so
 *     the player feels the bigger payoff.
 *
 * The component is pure presentation — sound effects and Phaser-side
 * particle bursts are fired by the host at the same moment the
 * placard is enqueued, NOT from this component. Keeping presentation
 * separate from side-effect wiring means we can re-render the placard
 * (e.g. on parent state change) without re-firing audio.
 */

import { useEffect, useState } from "react";

export interface PlayQuestCelebrationProps {
  /** "step" = a kill-step (or future fetch-step) flipped to done.
   *  "quest" = the player turned the quest in and claimed rewards. */
  kind: "step" | "quest";
  /** Quest name — primary label. e.g. "The Goblin's Nest". */
  title: string;
  /** Step name or short flavor line, e.g. "Defeated the Goblin Chief"
   *  or "Rewards claimed". Optional — when omitted the placard is
   *  title-only. */
  subtitle?: string;
  /** Fired once the placard finishes its fade-out so the host can
   *  shift it off the queue. The host is responsible for clearing
   *  timers if it tears the component down early. */
  onDismiss: () => void;
}

// Tuned so a step placard reads quickly but doesn't linger past a
// natural beat in the action; the bigger quest placard holds a little
// longer because there's more to read AND it's a meatier moment.
const TIMINGS = {
  step: { fadeIn: 200, hold: 2100, fadeOut: 500 },
  quest: { fadeIn: 260, hold: 3000, fadeOut: 600 },
} as const;

export function PlayQuestCelebration({
  kind,
  title,
  subtitle,
  onDismiss,
}: PlayQuestCelebrationProps) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");
  const t = TIMINGS[kind];

  useEffect(() => {
    // Schedule the three transitions back-to-back. Each timer is
    // captured so the cleanup below can clear them when the parent
    // tears the component down (map swap, page nav, etc.) before the
    // animation finishes.
    const t1 = window.setTimeout(() => setPhase("hold"), t.fadeIn);
    const t2 = window.setTimeout(
      () => setPhase("exit"),
      t.fadeIn + t.hold,
    );
    const t3 = window.setTimeout(
      () => onDismiss(),
      t.fadeIn + t.hold + t.fadeOut,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // onDismiss intentionally NOT in deps — the host passes a fresh
    // closure on each render and we want a single one-shot timer per
    // mount, not a re-arming loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const isQuest = kind === "quest";
  const opacity = phase === "enter" || phase === "exit" ? 0 : 1;
  const translateY = phase === "enter" ? -8 : 0;
  const fadeDur =
    phase === "exit" ? t.fadeOut : phase === "hold" ? t.fadeIn : t.fadeIn;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-10 z-40 flex justify-center px-4"
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          transition: `opacity ${fadeDur}ms ease-out, transform ${fadeDur}ms ease-out`,
          // Gold halo on the quest variant — matches the quest-glow
          // hue (0xffd750). On step it's a subtler 1px ring.
          boxShadow: isQuest
            ? "0 0 24px 4px rgba(255, 215, 80, 0.45), 0 0 0 1px rgba(255, 215, 80, 0.4) inset"
            : "0 0 0 1px rgba(255, 215, 80, 0.35) inset",
        }}
        className={
          isQuest
            ? "rounded-md border border-amber-300/50 bg-ink/90 px-6 py-3 text-center shadow-xl"
            : "rounded border border-amber-300/30 bg-ink/85 px-4 py-2 text-center shadow-lg"
        }
      >
        <div
          className={
            isQuest
              ? "font-display text-[10px] uppercase tracking-[0.18em] text-amber-300/85"
              : "font-display text-[9px] uppercase tracking-[0.18em] text-amber-300/75"
          }
        >
          {isQuest ? "Quest Complete" : "Step Complete"}
        </div>
        <div
          className={
            isQuest
              ? "mt-0.5 font-display text-xl text-parchment"
              : "mt-0.5 font-display text-sm text-parchment"
          }
        >
          {title}
        </div>
        {subtitle ? (
          <div
            className={
              isQuest
                ? "mt-0.5 text-xs italic text-parchment/70"
                : "mt-0.5 text-[11px] italic text-parchment/65"
            }
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
