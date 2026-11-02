"use client";

/**
 * Encounter screen — shown when the party runs into enemies (a
 * roamer catches them, a placed encounter ambushes them, or they
 * approach a lair). Shows each enemy's portrait, name, count and the
 * description authored in the editor, plus the encounter's own
 * description, then offers:
 *
 *   - Fight — straight into combat.
 *   - Run   — group Dexterity saving throw (see encounterChoices).
 *             Withdrawing from a lair needs no roll.
 *   - Talk  — humanoids only; a small chance to talk your way out.
 *
 * A failed Run / Talk shows the dice and then drops into combat.
 * The screen can't be dismissed without choosing — ESC does nothing.
 * Keys: F / R / T, or arrows + Enter.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { spriteUrl } from "@/data_model/spriteUrl";
import type { SpawnEncounterOptions } from "@/sim/MapSimulation";
import {
  canTalk,
  rollRun,
  rollTalk,
  runDc,
  talkChance,
  type EncounterRoller,
  type RosterEntry,
  type RunResult,
  type TalkResult,
} from "@/play/encounterChoices";

type Outcome =
  | { kind: "run"; result: RunResult }
  | { kind: "talk"; result: TalkResult };

export function PlayEncounterOverlay({
  options,
  roster,
  members,
  onFight,
  onEscape,
}: {
  options: SpawnEncounterOptions;
  roster: ReadonlyArray<RosterEntry>;
  /** Alive party members (ability scores for the rolls). */
  members: ReadonlyArray<EncounterRoller>;
  /** Start combat. `note` is a log line to record first (e.g. a
   *  failed escape), when there is one. */
  onFight: (note?: string) => void;
  /** Leave the encounter without fighting. */
  onEscape: (how: "run" | "talk", message: string) => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const talkable = canTalk(roster);
  const isLair = options.kind === "boss";

  const title =
    options.kind === "boss"
      ? `Lair: ${options.name}`
      : options.kind === "roamer"
        ? "Ambush!"
        : options.name;
  const kicker =
    options.kind === "boss"
      ? "You approach a monster lair"
      : options.kind === "roamer"
        ? `Something from ${options.name} has found you`
        : "Enemies block your path";
  const total = roster.reduce((n, r) => n + r.count, 0);

  const doRun = useCallback(() => {
    if (outcome) return;
    setOutcome({ kind: "run", result: rollRun(members, roster, options.kind) });
  }, [outcome, members, roster, options.kind]);
  const doTalk = useCallback(() => {
    if (outcome || !talkable) return;
    setOutcome({ kind: "talk", result: rollTalk(members, roster, options.kind) });
  }, [outcome, talkable, members, roster, options.kind]);
  const doFight = useCallback(() => onFight(), [onFight]);
  const doContinue = useCallback(() => {
    if (!outcome) return;
    if (outcome.result.success) onEscape(outcome.kind, outcome.result.message);
    else onFight(outcome.result.message);
  }, [outcome, onEscape, onFight]);

  interface Action {
    key: "fight" | "run" | "talk" | "continue";
    label: string;
    hint: string;
    enabled: boolean;
    onClick: () => void;
  }
  const actions = useMemo<Action[]>(() => {
    if (outcome) {
      return [
        {
          key: "continue",
          label: outcome.result.success ? "Continue" : "To battle!",
          hint: "",
          enabled: true,
          onClick: doContinue,
        },
      ];
    }
    const { chance } = talkChance(members, options.kind);
    return [
      {
        key: "fight",
        label: "Fight",
        hint: isLair ? "Assault the lair." : "Draw steel and engage.",
        enabled: true,
        onClick: doFight,
      },
      {
        key: "run",
        label: isLair ? "Withdraw" : "Run",
        hint: isLair
          ? "Back away — the lair stays."
          : `Dexterity save, DC ${runDc(roster)}. Half the party must pass.`,
        enabled: true,
        onClick: doRun,
      },
      {
        key: "talk",
        label: "Talk",
        hint: talkable
          ? `Try to talk your way out (~${Math.round(chance * 100)}%).`
          : "Only works on humanoids.",
        enabled: talkable,
        onClick: doTalk,
      },
    ];
  }, [outcome, members, options.kind, isLair, roster, talkable, doContinue, doFight, doRun, doTalk]);

  const [cursor, setCursor] = useState(0);
  useEffect(() => setCursor(0), [outcome]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const swallow = () => {
        e.stopPropagation();
        e.preventDefault();
      };
      if (["arrowleft", "arrowup", "arrowright", "arrowdown"].includes(k)) {
        swallow();
        const dir = k === "arrowleft" || k === "arrowup" ? -1 : 1;
        setCursor((c) => {
          let n = c;
          for (let i = 0; i < actions.length; i++) {
            n = (n + dir + actions.length) % actions.length;
            if (actions[n].enabled) return n;
          }
          return c;
        });
        return;
      }
      if (k === "enter" || k === " ") {
        swallow();
        const a = actions[cursor];
        if (a?.enabled) a.onClick();
        return;
      }
      if (!outcome && (k === "f" || k === "r" || k === "t")) {
        swallow();
        if (k === "f") doFight();
        else if (k === "r") doRun();
        else doTalk();
        return;
      }
      // Swallow everything else (movement, inspector hotkeys, ESC)
      // so the world underneath stays frozen until the player picks.
      if (k.length === 1 || k === "escape") swallow();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [actions, cursor, outcome, doFight, doRun, doTalk]);

  const focusRing = "outline outline-2 outline-amber-200 outline-offset-1";
  const lead = roster[0];

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Enemy encounter"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-ember/40 bg-ink/95 shadow-2xl">
        <header className="flex items-center gap-4 border-b border-parchment/15 px-4 py-3">
          {lead?.sprite ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={spriteUrl(lead.sprite)}
              alt=""
              width={96}
              height={96}
              style={{ imageRendering: "pixelated" }}
              className="h-24 w-24 shrink-0 rounded border border-ember/40 bg-black/40 object-contain"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-ember">
              {kicker}
            </p>
            <h2 className="font-display text-2xl text-parchment">{title}</h2>
            <p className="text-xs text-parchment/60">
              {total} {total === 1 ? "foe" : "foes"}
            </p>
          </div>
        </header>

        {options.description?.trim() ? (
          // The encounter's authored description is the scene-setting
          // narration — read first, before the roster.
          <div className="border-b border-parchment/15 bg-black/20 px-4 py-3">
            <p className="whitespace-pre-line font-display text-[15px] italic leading-relaxed text-parchment/90">
              {options.description.trim()}
            </p>
          </div>
        ) : null}

        <ul className="flex-1 space-y-2 overflow-auto px-4 py-3">
          {roster.map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-3 rounded border border-parchment/15 bg-black/25 p-2"
            >
              {r.sprite ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={spriteUrl(r.sprite)}
                  alt=""
                  width={64}
                  height={64}
                  style={{ imageRendering: "pixelated" }}
                  className="h-16 w-16 shrink-0 rounded border border-parchment/20 bg-ink/60 object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
              ) : (
                <span className="h-16 w-16 shrink-0 rounded border border-parchment/15 bg-ink/40" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-display text-base text-parchment">
                  {r.name}
                  {r.count > 1 ? (
                    <span className="ml-2 font-mono text-sm text-amber-300">×{r.count}</span>
                  ) : null}
                </p>
                <p className="whitespace-pre-line text-sm leading-snug text-parchment/75">
                  {r.description ?? (r.humanoid ? "A hostile figure eyes your party." : "A hostile creature bars the way.")}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {outcome ? (
          <div
            className={[
              "mx-4 mb-3 rounded border px-3 py-2 text-sm",
              outcome.result.success
                ? "border-emerald-500/40 bg-emerald-700/20 text-emerald-100"
                : "border-red-500/40 bg-red-800/25 text-red-100",
            ].join(" ")}
          >
            <p className="font-medium">{outcome.result.message}</p>
            {outcome.kind === "run" && outcome.result.rolls.length > 0 ? (
              <ul className="mt-1 font-mono text-xs opacity-90">
                {outcome.result.rolls.map((r, i) => (
                  <li key={i}>
                    {r.name}: d20 {r.roll} {r.mod >= 0 ? "+" : "−"} {Math.abs(r.mod)} = {r.total} vs DC{" "}
                    {outcome.result.dc} — {r.success ? "pass" : "fail"}
                  </li>
                ))}
                <li className="mt-0.5">
                  {outcome.result.passed}/{outcome.result.rolls.length} passed (needed {outcome.result.needed})
                </li>
              </ul>
            ) : null}
            {outcome.kind === "talk" ? (
              <p className="mt-1 font-mono text-xs opacity-90">
                {outcome.result.speaker} speaks for the party ({Math.round(outcome.result.chance * 100)}% chance)
              </p>
            ) : null}
          </div>
        ) : null}

        <footer className="flex flex-wrap items-stretch justify-end gap-2 border-t border-parchment/15 px-4 py-3">
          {actions.map((a, i) => (
            <button
              key={a.key}
              type="button"
              disabled={!a.enabled}
              onClick={() => {
                setCursor(i);
                a.onClick();
              }}
              title={a.hint}
              className={[
                "min-w-[8rem] rounded border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40",
                a.key === "fight" || (a.key === "continue" && !outcome?.result.success)
                  ? "border-ember/60 bg-ember/30 text-parchment hover:bg-ember/50"
                  : "border-parchment/25 bg-ink/40 text-parchment/90 hover:bg-ink/60",
                cursor === i && a.enabled ? focusRing : "",
              ].join(" ")}
            >
              <div className="font-medium">
                {a.key !== "continue" ? (
                  <span className="mr-1 font-mono text-xs text-amber-300">
                    [{a.key === "fight" ? "F" : a.key === "run" ? "R" : "T"}]
                  </span>
                ) : null}
                {a.label}
              </div>
              {a.hint ? <div className="text-[11px] text-parchment/60">{a.hint}</div> : null}
            </button>
          ))}
        </footer>
      </div>
    </div>
  );
}
