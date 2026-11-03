"use client";

/**
 * Left-hand details panel for the exploration views (overworld, towns,
 * dungeons — hidden during battle). Takes ~20% of the screen width and
 * stacks detail sections top to bottom; the Log window is the first
 * section and fills whatever height the others leave.
 *
 * Log window — the notable events from the adventure log (XP, level-ups,
 * quests, finds, fights, traps, lock attempts — see notableCategory),
 * each with a coloured dot for its kind and stamped with the game
 * time it happened and grouped under a heading per in-game day. Newest
 * first: each new line lands at the top and pushes older ones down;
 * scroll down for history. While the player is scrolled down reading
 * history the view holds still, and a "Latest ↑" button jumps back
 * to the top.
 *
 * When a notable line lands, the panel plays a soft chime and the new
 * row glows in with a shimmer and sparkles (CSS in app/globals.css).
 * Lines already in the log when the panel first mounts don't animate.
 *
 * Buttons here never take keyboard focus, so arrow / WASD / Space keep
 * driving the party after a click.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { dateStr, timeStr } from "@/battle/world/GameTime";
import { Sfx } from "@/battle/audio/Sfx";
import {
  carryLog,
  notableCategory,
  type LogCategory,
} from "@/play/explorationLog";

/** Dot colour per kind of event. */
const CATEGORY_DOT: Record<LogCategory, string> = {
  xp: "bg-amber-300",
  quest: "bg-yellow-200",
  find: "bg-emerald-400",
  combat: "bg-red-400",
  trap: "bg-orange-400",
  lock: "bg-sky-300",
  loot: "bg-violet-300",
  story: "bg-parchment/70",
};

/** Keep focus on the game: buttons react to clicks only. */
const noFocus = {
  tabIndex: -1,
  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
};

export function PlayExplorationPanel({
  messages,
  storyLines,
  clockMinutes,
  hidden = false,
  onOpenFullLog,
}: {
  /** Hide without unmounting (battle), so the log keeps its stamps. */
  hidden?: boolean;
  messages: ReadonlyArray<string>;
  /** Authored Log Event lines — always shown (see notableCategory). */
  storyLines?: ReadonlySet<string>;
  clockMinutes: number;
  onOpenFullLog: () => void;
}) {
  return (
    <aside
      className={`${hidden ? "hidden" : "flex"} h-full w-[20%] min-w-[220px] max-w-[460px] shrink-0 flex-col gap-2 border-r border-parchment/15 bg-ink/95 p-2`}
    >
      <ExplorationLog
        messages={messages}
        storyLines={storyLines}
        clockMinutes={clockMinutes}
        onOpenFullLog={onOpenFullLog}
      />
    </aside>
  );
}

/** A titled section of the panel. `grow` sections share the leftover
 *  height and scroll inside themselves. */
function PanelSection({
  title,
  aside,
  grow = false,
  children,
}: {
  title: string;
  aside?: ReactNode;
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={[
        "flex flex-col rounded border border-parchment/15 bg-black/30",
        grow ? "min-h-0 flex-1" : "",
      ].join(" ")}
    >
      <header className="flex items-center justify-between gap-2 border-b border-parchment/10 px-2 py-1">
        <h2 className="font-display text-base text-parchment">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function ExplorationLog({
  messages,
  storyLines,
  clockMinutes,
  onOpenFullLog,
}: {
  messages: ReadonlyArray<string>;
  storyLines?: ReadonlySet<string>;
  clockMinutes: number;
  onOpenFullLog: () => void;
}) {
  // Per-line metadata carried across updates (see explorationLog.ts):
  // the game time it arrived and a sequence number, which keys the row
  // so trimming the buffer never remounts (and re-animates) old rows.
  const seen = useRef<{
    msgs: ReadonlyArray<string>;
    meta: Array<{ at: number; seq: number }>;
    nextSeq: number;
  }>({ msgs: [], meta: [], nextSeq: 0 });
  /** Lines with seq >= this arrived after the panel mounted. */
  const mountSeq = useRef<number | null>(null);
  if (seen.current.msgs !== messages) {
    let nextSeq = seen.current.nextSeq;
    const meta = carryLog(seen.current.msgs, seen.current.meta, messages, () => ({
      at: clockMinutes,
      seq: nextSeq++,
    }));
    seen.current = { msgs: messages, meta, nextSeq };
  }
  if (mountSeq.current === null) mountSeq.current = seen.current.nextSeq;
  const meta = seen.current.meta;

  // Newest line is at the top: stay pinned there unless the player
  // has scrolled down into older entries.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [atTop, setAtTop] = useState(true);
  // Height before this update, so when the player is reading older
  // entries a new line arriving above doesn't shove the text they're
  // looking at — we shift scrollTop by however much was added on top.
  // (Native scroll anchoring is turned off on the list so this is the
  // one rule in every browser.)
  const prevHeight = useRef(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (atTop) el.scrollTop = 0;
    else el.scrollTop += el.scrollHeight - prevHeight.current;
    prevHeight.current = el.scrollHeight;
  }, [messages, atTop]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => setAtTop(el.scrollTop < 8);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Only the notable lines; routine feedback stays in the map's strip.
  const entries = messages.flatMap((msg, i) => {
    const cat = notableCategory(msg, storyLines);
    const m = meta[i];
    return cat && m ? [{ msg, cat, at: m.at, seq: m.seq }] : [];
  });

  // Chime once per update that brings in new notable lines.
  const lastChimedSeq = useRef(-1);
  const newestSeq = entries.length > 0 ? entries[entries.length - 1].seq : -1;
  useEffect(() => {
    if (newestSeq < (mountSeq.current ?? 0)) return;
    if (newestSeq <= lastChimedSeq.current) return;
    lastChimedSeq.current = newestSeq;
    Sfx.play("log_chime");
  }, [newestSeq]);

  // Render newest first — a day heading leads each day's group, and
  // the most recent day comes first.
  const rows: ReactNode[] = [];
  let lastDay = "";
  [...entries].reverse().forEach(({ msg, cat, at: minutes, seq }, i) => {
    const at = { totalMinutes: minutes };
    const day = dateStr(at);
    if (day !== lastDay) {
      lastDay = day;
      rows.push(
        <div
          key={`day-${seq}`}
          className="sticky top-0 z-10 bg-ink/95 px-2 pb-0.5 pt-2 text-xs uppercase tracking-wide text-parchment/45"
        >
          {day}
        </div>,
      );
    }
    const newest = i === 0;
    const fresh = seq >= (mountSeq.current ?? 0);
    rows.push(
      <div
        key={seq}
        className={[
          "relative grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2 overflow-hidden border-b border-parchment/5 px-2 py-1",
          newest ? "bg-parchment/5 text-parchment" : "text-parchment/85",
          fresh ? "log-entry-new" : "",
        ].join(" ")}
      >
        {fresh ? (
          <>
            <span aria-hidden className="log-sparkle right-2 top-0 text-sm">✦</span>
            <span
              aria-hidden
              className="log-sparkle right-6 top-2 text-[10px]"
              style={{ animationDelay: "0.15s" }}
            >
              ✦
            </span>
            <span
              aria-hidden
              className="log-sparkle right-1 bottom-0 text-[9px]"
              style={{ animationDelay: "0.3s" }}
            >
              ✧
            </span>
          </>
        ) : null}
        <span className="font-mono text-xs leading-6 text-parchment/45">
          {timeStr(at)}
        </span>
        <span
          className={`inline-block h-2 w-2 -translate-y-px rounded-full ${CATEGORY_DOT[cat]}`}
          title={cat}
        />
        <span className={`text-[15px] leading-6 ${cat === "story" ? "italic" : ""}`}>
          {msg}
        </span>
      </div>,
    );
  });

  return (
    <PanelSection
      title="Log"
      grow
      aside={
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-parchment/45">{entries.length}</span>
          <button
            type="button"
            {...noFocus}
            onClick={onOpenFullLog}
            title="Open the full Adventure Log (L)"
            className="rounded border border-parchment/20 px-1.5 text-xs text-parchment/70 hover:bg-ink/40"
          >
            Expand
          </button>
        </span>
      }
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          className="absolute inset-0 overflow-y-auto"
          style={{ overflowAnchor: "none" }}
        >
          {entries.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-parchment/50">
              Nothing notable yet — XP, quests, finds, fights and traps
              will show up here.
            </p>
          ) : (
            rows
          )}
        </div>
        {!atTop ? (
          <button
            type="button"
            {...noFocus}
            onClick={() => setAtTop(true)}
            className="absolute right-3 top-2 z-20 rounded border border-parchment/30 bg-ink/95 px-2 py-0.5 text-xs text-parchment/85 shadow hover:bg-ink"
          >
            Latest ↑
          </button>
        ) : null}
      </div>
    </PanelSection>
  );
}
