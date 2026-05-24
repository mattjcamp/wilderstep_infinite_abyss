"use client";

/**
 * Self-dismissing placard that announces a quest step / quest
 * completion. Renders center-top of the viewport, fades in, holds,
 * fades out, then invokes `onDismiss` so the host can shift the next
 * item off its celebration queue.
 *
 * Visual style mirrors the gold accent used by the quest-relevance
 * halo (sim/questGlow.ts) so the celebration reads as part of the
 * same family. Three variants:
 *
 *   - `kind: "step"` — small, "Step Complete" label, subtle gold.
 *     Used for intermediate kill / fetch credits while the quest is
 *     still ongoing.
 *   - `kind: "step-final"` — same footprint as `step` but with the
 *     louder gold halo of the `quest` placard and a different label
 *     ("Objectives Complete"). Fires the moment the LAST step of a
 *     quest is credited, so the player immediately reads the
 *     "return to giver" subtitle and knows to head back. Without
 *     this variant the final kill credit looked identical to any
 *     other step and the player had no in-game signal that the
 *     handoff was waiting.
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

/** All placard variants. Exported so the host's celebration-queue
 *  state type stays in lockstep with the component's prop shape.
 *  Quests use "step" / "step-final" / "quest"; race-active abilities
 *  use "pickpocket" / "tinker" so the placard's label can describe
 *  what just happened ("Pickpocketed!" / "Tinkered Up!") rather
 *  than misreporting an ability use as a quest step. */
export type PlayQuestCelebrationKind =
  | "step"
  | "step-final"
  | "quest"
  | "pickpocket"
  | "tinker";

export interface PlayQuestCelebrationProps {
  /** "step"       = an intermediate kill/retrieve credit, quest still ongoing.
   *  "step-final" = the LAST step's credit — quest objectives are now done
   *                 and the player should head back to the giver.
   *  "quest"      = the player turned the quest in and claimed rewards. */
  kind: PlayQuestCelebrationKind;
  /** Quest name — primary label. e.g. "The Goblin's Nest". */
  title: string;
  /** Step name or short flavor line, e.g. "Defeated the Goblin Chief",
   *  "Return to Jerald", or "Rewards claimed". Optional — when omitted
   *  the placard is title-only. */
  subtitle?: string;
  /** Fired once the placard finishes its fade-out so the host can
   *  shift it off the queue. The host is responsible for clearing
   *  timers if it tears the component down early. */
  onDismiss: () => void;
}

// Tuned so a step placard reads quickly but doesn't linger past a
// natural beat in the action; the bigger quest placard holds a little
// longer because there's more to read AND it's a meatier moment.
// step-final reuses the step footprint but holds a touch longer so
// the player has time to register the "return to giver" subtitle
// (which is the whole point of the variant).
const TIMINGS = {
  step:         { fadeIn: 200, hold: 2100, fadeOut: 500 },
  "step-final": { fadeIn: 230, hold: 2700, fadeOut: 550 },
  quest:        { fadeIn: 260, hold: 3000, fadeOut: 600 },
  // Race-ability placards reuse the step footprint — the moment
  // isn't quite a quest payoff but it IS something the player chose
  // to do and should see acknowledged. Hold a little longer so the
  // loot / item name has time to register.
  pickpocket:   { fadeIn: 210, hold: 2500, fadeOut: 520 },
  tinker:       { fadeIn: 210, hold: 2500, fadeOut: 520 },
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
  const isStepFinal = kind === "step-final";
  const isRaceAbility = kind === "pickpocket" || kind === "tinker";
  const opacity = phase === "enter" || phase === "exit" ? 0 : 1;
  const translateY = phase === "enter" ? -8 : 0;
  const fadeDur =
    phase === "exit" ? t.fadeOut : phase === "hold" ? t.fadeIn : t.fadeIn;

  // Label text — drives both the placard's heading and (subtly) its
  // visual weight. Kept in one switch so adding a future variant is
  // a single touch point.
  const label =
    kind === "quest"
      ? "Quest Complete"
      : kind === "step-final"
        ? "Objectives Complete"
        : kind === "pickpocket"
          ? "Pickpocketed!"
          : kind === "tinker"
            ? "Tinkered Up!"
            : "Step Complete";

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
          // Gold halo. The quest variant gets the full bloom;
          // step-final + race-ability variants share a softer bloom
          // (so they read brighter than a plain step but aren't
          // competing visually with the eventual turn-in placard);
          // plain step is just an inset ring.
          boxShadow: isQuest
            ? "0 0 24px 4px rgba(255, 215, 80, 0.45), 0 0 0 1px rgba(255, 215, 80, 0.4) inset"
            : isStepFinal || isRaceAbility
              ? "0 0 14px 2px rgba(255, 215, 80, 0.35), 0 0 0 1px rgba(255, 215, 80, 0.5) inset"
              : "0 0 0 1px rgba(255, 215, 80, 0.35) inset",
        }}
        className={
          isQuest
            ? "rounded-md border border-amber-300/50 bg-ink/90 px-6 py-3 text-center shadow-xl"
            : isStepFinal || isRaceAbility
              ? "rounded border border-amber-300/45 bg-ink/90 px-4 py-2 text-center shadow-lg"
              : "rounded border border-amber-300/30 bg-ink/85 px-4 py-2 text-center shadow-lg"
        }
      >
        <div
          className={
            isQuest
              ? "font-display text-[10px] uppercase tracking-[0.18em] text-amber-300/85"
              : isStepFinal || isRaceAbility
                ? "font-display text-[9px] uppercase tracking-[0.18em] text-amber-300/90"
                : "font-display text-[9px] uppercase tracking-[0.18em] text-amber-300/75"
          }
        >
          {label}
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
                : isStepFinal || isRaceAbility
                  ? // Slightly brighter than a step subtitle so the
                    // "Return to {giver}" prompt (or the stolen-item
                    // name) reads as an action line, not background
                    // flavor.
                    "mt-0.5 text-[11px] text-amber-100/85"
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

/**
 * Compose the "Return to {giver}" prompt shown as the step-final
 * placard's subtitle. Falls back to a name-free phrase so a quest
 * authored without a giver name (rare — usually a data-entry miss)
 * still surfaces an actionable message. Pure helper, exported so
 * the host (and tests) can call it without importing the
 * component itself.
 */
export function returnToGiverSubtitle(giverName: string | undefined | null): string {
  const trimmed = (giverName ?? "").trim();
  return trimmed.length > 0
    ? `Return to ${trimmed}`
    : "Return to the quest giver";
}
