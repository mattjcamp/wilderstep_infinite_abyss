"use client";

/**
 * TitleWanderers — people, animals and monsters strolling across the
 * /play title screen, purely for atmosphere.
 *
 * The layer sits BEHIND the title art and the menu (PlayLanding gives
 * those a page-colored, feathered backing at a higher z-index), so a
 * wanderer passing behind them fades out and reappears on the other
 * side. It never takes pointer events, is hidden from assistive tech,
 * and renders nothing for players who prefer reduced motion.
 *
 * Each wanderer (or group — a party of adventurers, a wolf pack, a few
 * sheep) crosses once on a CSS animation, then is replaced after a
 * short random pause. Roster and spawn rules: src/play/titleWanderers.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { withBasePath } from "@/util/basePath";
import {
  LANES,
  planWanderer,
  type Gait,
  type WandererKind,
  type WandererPlan,
} from "@/play/titleWanderers";

/** How many wanderers (or groups) are on screen at once. */
const CROWD = 7;

interface Wanderer extends WandererPlan {
  id: number;
  /** Start / end x in px and travel time, fixed at spawn. */
  fromPx: number;
  toPx: number;
  durationS: number;
  /** Negative delay starts it part-way across (used on first load). */
  delayS: number;
}

const GAIT_ANIM: Record<Gait, string> = {
  walk: "tw-walk 0.55s ease-in-out infinite",
  trot: "tw-trot 0.32s ease-in-out infinite",
  float: "tw-float 2.6s ease-in-out infinite",
  flap: "tw-flap 0.38s ease-in-out infinite",
  ooze: "tw-ooze 1.3s ease-in-out infinite",
  hop: "tw-hop 0.6s ease-out infinite",
};

const CSS = `
@keyframes tw-cross {
  from { transform: translate3d(var(--tw-from), 0, 0); }
  to { transform: translate3d(var(--tw-to), 0, 0); }
}
@keyframes tw-walk {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50% { transform: translateY(-3px) rotate(3deg); }
}
@keyframes tw-trot {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}
@keyframes tw-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-9px); }
}
@keyframes tw-flap {
  0%, 100% { transform: translateY(0) scaleY(1); }
  50% { transform: translateY(-6px) scaleY(0.78); }
}
@keyframes tw-ooze {
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.12, 0.86); }
}
@keyframes tw-hop {
  0%, 55%, 100% { transform: translateY(0); }
  25% { transform: translateY(-7px); }
}
`;

/** Space between group members, as a fraction of member size. Negative
 *  because the 64×64 sprites have transparent padding around the figure,
 *  so a slight overlap reads as walking side by side. */
const GROUP_GAP = -0.22;

function groupWidthPx(p: WandererPlan): number {
  return p.members.reduce(
    (w, m) => w + p.basePx * m.size * (1 + GROUP_GAP),
    0,
  );
}

let nextId = 1;

function spawn(widthPx: number, startPartway: boolean): Wanderer {
  const plan = planWanderer();
  const span = groupWidthPx(plan);
  // Start just off one edge, end just off the other.
  const fromPx = plan.dir === 1 ? -span - 16 : widthPx + 16;
  const toPx = plan.dir === 1 ? widthPx + 16 : -span - 16;
  const durationS = Math.abs(toPx - fromPx) / plan.speed;
  return {
    ...plan,
    id: nextId++,
    fromPx,
    toPx,
    durationS,
    delayS: startPartway ? -Math.random() * durationS : 0,
  };
}

export function TitleWanderers() {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [crowd, setCrowd] = useState<Wanderer[]>([]);
  const timers = useRef<number[]>([]);

  // Respect reduced motion; follow changes to the setting live.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setEnabled(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const width = () => layerRef.current?.clientWidth ?? window.innerWidth;

  // Populate on enable — already mid-stroll, so the screen isn't empty.
  useEffect(() => {
    if (!enabled) {
      setCrowd([]);
      return;
    }
    const w = width();
    setCrowd(Array.from({ length: CROWD }, () => spawn(w, true)));
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [enabled]);

  // A wanderer reached the far side: drop it and send a new one after
  // a short pause, so arrivals feel irregular.
  const onArrive = useCallback((id: number) => {
    setCrowd((c) => c.filter((x) => x.id !== id));
    const t = window.setTimeout(
      () => setCrowd((c) => [...c, spawn(width(), false)]),
      400 + Math.random() * 3600,
    );
    timers.current.push(t);
  }, []);

  if (!enabled) return null;

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden"
    >
      <style>{CSS}</style>
      {crowd.map((w) => (
        <WandererGroup key={w.id} w={w} onArrive={onArrive} />
      ))}
    </div>
  );
}

function WandererGroup({
  w,
  onArrive,
}: {
  w: Wanderer;
  onArrive: (id: number) => void;
}) {
  // Leader goes at the front of travel: rightmost when heading right.
  const order = w.dir === 1 ? [...w.members].reverse() : w.members;
  return (
    <div
      className="absolute left-0"
      style={
        {
          // Lanes are feet positions; lift by the tallest member.
          top: `${LANES[w.lane] * 100}%`,
          zIndex: w.lane + 1,
          opacity: w.opacity,
          "--tw-from": `${w.fromPx}px`,
          "--tw-to": `${w.toPx}px`,
          animation: `tw-cross ${w.durationS}s linear ${w.delayS}s both`,
          transform: `translate3d(${w.fromPx}px, 0, 0)`,
          willChange: "transform",
        } as React.CSSProperties
      }
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onArrive(w.id);
      }}
    >
      <div
        className="flex -translate-y-full items-end"
        style={{ gap: `${Math.round(w.basePx * GROUP_GAP)}px` }}
      >
        {order.map((m, i) => (
          <Member key={i} kind={m} basePx={w.basePx} dir={w.dir} phase={i} />
        ))}
      </div>
    </div>
  );
}

function Member({
  kind,
  basePx,
  dir,
  phase,
}: {
  kind: WandererKind;
  basePx: number;
  dir: 1 | -1;
  phase: number;
}) {
  const px = Math.round(basePx * kind.size);
  // Side-on art faces one way; flip it to face the direction of travel.
  const flip =
    (kind.facing === "left" && dir === 1) ||
    (kind.facing === "right" && dir === -1);
  const airborne = kind.gait === "float" || kind.gait === "flap";
  return (
    <div className="relative" style={{ width: px, height: px }}>
      {/* Ground shadow — fainter and smaller under fliers. */}
      <span
        className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-[50%] bg-black"
        style={{
          width: px * (airborne ? 0.4 : 0.6),
          height: Math.max(2, px * 0.08),
          opacity: airborne ? 0.18 : 0.35,
        }}
      />
      <div style={{ transform: flip ? "scaleX(-1)" : undefined }}>
        <div
          style={{
            animation: GAIT_ANIM[kind.gait],
            // Offset each member's step so a group doesn't bob in sync.
            animationDelay: `${-phase * 0.17}s`,
            transformOrigin: "50% 100%",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={withBasePath(`/modules/default/sprites/${kind.sprite}`)}
            alt=""
            width={px}
            height={px}
            draggable={false}
            style={{ imageRendering: "pixelated", display: "block" }}
          />
        </div>
      </div>
    </div>
  );
}
