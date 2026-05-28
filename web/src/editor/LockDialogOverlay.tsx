"use client";

/**
 * Modal overlay that opens when the simulator party bumps a locked
 * cell. Mounted by MapEditor on the sim's `lock_encountered` event.
 *
 * Three action rows, mirroring `Lock.ts.buildLockOptions`:
 *
 *   - Pick Lock — enabled when an alive Thief (or L3+ Ranger) is in
 *                 the party AND the stash holds at least one
 *                 Lockpick. Disabled rows show the gating reason so
 *                 designers know what to add to test the path.
 *   - Cast Knock — enabled when an alive caster eligible for the
 *                 Knock spell's casting catalog (sorcerer) sits at or
 *                 above its `min_level` AND has enough MP. Suppressed
 *                 entirely when the module hasn't defined a Knock
 *                 spell.
 *   - Leave     — close the dialog with no effect.
 *
 * Each attempt clicks back into the simulator via the passed
 * callbacks; the simulator owns the dice rolls + grid mutation. This
 * overlay shows the result inline.
 *
 * **Retry behaviour.** A failed attempt keeps the dialog open with
 * the failure message above the action rows, and the action buttons
 * stay clickable — the player can pop another lockpick or burn more
 * MP without walking away and re-bumping the cell. The kernel's
 * `attemptPickLock` / `attemptKnock` retain the pending lock on
 * failure (it only clears on success or `dismissLock`), so subsequent
 * clicks land on the same door. Local mirrors of `lockpickCharges`
 * and `knockCaster.mp` decrement on every attempt so the row gates
 * collapse to disabled when the budget runs out. A successful attempt
 * auto-closes the dialog after a short beat so the player sees the
 * roll math and isn't left tapping Leave.
 */

import { useEffect, useMemo, useState } from "react";
import type {
  LockAttemptResult,
  LockEncounterOptions,
} from "@/sim/MapSimulation";

interface Props {
  options: LockEncounterOptions;
  onPickLock: () => LockAttemptResult | null;
  onCastKnock: () => LockAttemptResult | null;
  onClose: () => void;
}

export function LockDialogOverlay({
  options,
  onPickLock,
  onCastKnock,
  onClose,
}: Props) {
  const [result, setResult] = useState<LockAttemptResult | null>(null);
  // Local mirror of the encounter options so the row gates can react
  // to in-dialog attempts without waiting for the parent to re-fetch
  // the post-attempt sim state. Each failed attempt decrements either
  // `lockpickCharges` or the caster's `mp` here; the parent's
  // `options` prop is only the *initial* snapshot the kernel emitted
  // on the lock_encountered event. The component remounts when the
  // host opens a new lock dialog (the lockEncounter state nulls out
  // and then resets), so useState's initialiser captures fresh
  // values each time without an extra useEffect.
  const [liveOpts, setLiveOpts] = useState<LockEncounterOptions>(options);

  // Auto-close after a successful attempt so the player isn't stuck
  // tapping Leave. Failures stay open so the player can read the
  // dice math and pick another option (or commit to Leave).
  useEffect(() => {
    if (!result || !result.success) return;
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
  }, [result, onClose]);

  // Pick Lock row gate — disabled with a tooltip-style reason when
  // either the party or the stash is missing the requirement. Reads
  // off `liveOpts` so a depleted Lockpick stash mid-dialog collapses
  // the row to disabled on the next render.
  const pickRow = (() => {
    if (!liveOpts.picker) {
      return {
        label: "Pick Lock",
        reason: "Need a Thief or L3+ Ranger in the party.",
        disabled: true,
      };
    }
    if (liveOpts.lockpickCharges <= 0) {
      return {
        label: `Pick Lock — ${liveOpts.picker.name}`,
        reason: "Stash has no Lockpicks. Add one to the party inventory.",
        disabled: true,
      };
    }
    return {
      label: `Pick Lock — ${liveOpts.picker.name} (${liveOpts.lockpickCharges} pick${liveOpts.lockpickCharges === 1 ? "" : "s"})`,
      reason: null as string | null,
      disabled: false,
    };
  })();

  // Cast Knock row — only rendered when the module declares a Knock
  // spell. The simulator catalog's `knockSpell` is null when not
  // loaded; `knockMpCost === null` is the signal here. Reads off
  // `liveOpts` so a caster who burns down to 0 MP mid-dialog sees
  // the row disable with the Insufficient MP reason.
  const knockRow = (() => {
    if (liveOpts.knockMpCost === null) return null;
    if (!liveOpts.knockCaster) {
      return {
        label: "Cast Knock",
        reason: "No eligible caster (needs a sorcerer-catalog class at or above the spell's min level).",
        disabled: true,
      };
    }
    const mp = liveOpts.knockCaster.mp ?? 0;
    if (mp < liveOpts.knockMpCost) {
      return {
        label: `Cast Knock — ${liveOpts.knockCaster.name}`,
        reason: `Insufficient MP (${mp}/${liveOpts.knockMpCost}).`,
        disabled: true,
      };
    }
    return {
      label: `Cast Knock — ${liveOpts.knockCaster.name} (${liveOpts.knockMpCost} MP)`,
      reason: null as string | null,
      disabled: false,
    };
  })();

  const handlePick = () => {
    const r = onPickLock();
    if (!r) return;
    setResult(r);
    // Decrement the local lockpick mirror so the row reflects the
    // spent charge on the next render. The kernel's
    // `consumeLockpick` already removed one from the stash; we
    // mirror that here so the row gate doesn't lag behind reality.
    // Done on success too — harmless because the dialog auto-closes
    // before the value matters again.
    setLiveOpts((prev) => ({
      ...prev,
      lockpickCharges: Math.max(0, prev.lockpickCharges - 1),
    }));
  };
  const handleKnock = () => {
    const r = onCastKnock();
    if (!r) return;
    setResult(r);
    // Decrement the local MP mirror by the spell's cost. Same
    // rationale as the lockpick decrement above.
    setLiveOpts((prev) => {
      const cost = prev.knockMpCost ?? 0;
      if (!prev.knockCaster) return prev;
      return {
        ...prev,
        knockCaster: {
          ...prev.knockCaster,
          mp: Math.max(0, (prev.knockCaster.mp ?? 0) - cost),
        },
      };
    });
  };

  // Action buttons disable only on a *successful* result — the
  // dialog is about to auto-close at that point so further clicks
  // would race. Failed results leave the buttons enabled so the
  // player can retry without re-bumping the lock cell.
  const lockedByResult = !!result && result.success;

  // ── Keyboard navigation ─────────────────────────────────────────
  // Build the action list dynamically so the cursor walks the same
  // set the player sees: Pick Lock → (Cast Knock when the module
  // declares it) → Leave. Each entry carries its current disabled
  // state so Enter can no-op on a disabled row, but arrow keys
  // still let the player navigate to it (the disabled body text
  // explains why — handy for "what do I need" debugging).
  type ActionKind = "pick" | "knock" | "leave";
  interface Action {
    kind: ActionKind;
    disabled: boolean;
  }
  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [];
    list.push({ kind: "pick", disabled: pickRow.disabled });
    if (knockRow) list.push({ kind: "knock", disabled: knockRow.disabled });
    list.push({ kind: "leave", disabled: false });
    return list;
  }, [pickRow.disabled, knockRow]);

  // Initial cursor lands on the first enabled action. A locked door
  // the party can pick (Pick Lock enabled) lands on Pick → Enter
  // immediately attempts the pick. A door the party can't pick or
  // knock falls through to Leave so Enter is a clean cancel rather
  // than a confusing no-op on a disabled top row.
  const initialFocusIdx = useMemo(() => {
    const i = actions.findIndex((a) => !a.disabled);
    return i < 0 ? actions.length - 1 : i;
  }, [actions]);
  const [focusIdx, setFocusIdx] = useState(initialFocusIdx);

  // After a *failed* attempt the kernel retains the pending lock,
  // the row's label flips to "Try Again — …", and the action row is
  // still enabled. Refocus the failed action so a second Enter is
  // an immediate retry rather than a hop to Leave. Skip when the
  // failed row collapsed to disabled (no more lockpicks, no more
  // MP) — better to leave the cursor where it is so the player
  // sees the disable.
  useEffect(() => {
    if (!result || result.success) return;
    const i = actions.findIndex((a) => a.kind === result.kind);
    if (i >= 0 && !actions[i].disabled) setFocusIdx(i);
  }, [result, actions]);

  // Esc closes; Up/Down cycle the action list (wraps at both ends);
  // Enter fires whichever row the cursor is on, gated on the action
  // not being disabled and the dialog not being locked-by-success.
  // Capture-phase so the underlying sim's movement keys don't fire
  // under the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        if (!lockedByResult) onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.stopPropagation();
        e.preventDefault();
        if (lockedByResult) return;
        setFocusIdx((i) => (i + 1) % actions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.stopPropagation();
        e.preventDefault();
        if (lockedByResult) return;
        setFocusIdx(
          (i) => (i - 1 + actions.length) % actions.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.stopPropagation();
        e.preventDefault();
        if (lockedByResult) return;
        const a = actions[focusIdx];
        if (!a || a.disabled) return;
        if (a.kind === "pick") handlePick();
        else if (a.kind === "knock") handleKnock();
        else if (a.kind === "leave") onClose();
        return;
      }
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "w" ||
        e.key === "a" ||
        e.key === "s" ||
        e.key === "d" ||
        e.key === "W" ||
        e.key === "A" ||
        e.key === "S" ||
        e.key === "D"
      ) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [
    actions,
    focusIdx,
    lockedByResult,
    onClose,
    handlePick,
    handleKnock,
  ]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label="Locked door"
    >
      <div className="w-[420px] rounded-lg border border-parchment/25 bg-ink/95 p-4 text-parchment shadow-xl">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">Locked Door</h2>
          <span className="font-mono text-[11px] text-parchment/45">
            ({liveOpts.pos.col}, {liveOpts.pos.row})
          </span>
        </header>

        <p className="mb-3 text-sm text-parchment/75">
          The door blocks the way. The party needs to pick the lock or
          cast Knock to get through.
        </p>

        {result ? (
          <div
            className={`mb-3 rounded border px-3 py-2 text-sm ${
              result.success
                ? "border-emerald-500/40 bg-emerald-700/20 text-emerald-100"
                : "border-rust/50 bg-rust/15 text-parchment"
            }`}
          >
            <div>{result.message}</div>
            {!result.success ? (
              <div className="mt-1 text-[11px] text-parchment/65">
                Try again, switch tactics, or leave the door for later.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {(() => {
            // Resolve each action's slot in `actions` once so the
            // amber outline + click→focus sync stay correct as the
            // visible button set shifts (Cast Knock dropping out
            // when the module has no Knock spell, etc.).
            const focusRing =
              "outline outline-2 outline-amber-200 outline-offset-1";
            const pickIdx = actions.findIndex((a) => a.kind === "pick");
            const knockIdx = actions.findIndex((a) => a.kind === "knock");
            const leaveIdx = actions.findIndex((a) => a.kind === "leave");
            return (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setFocusIdx(pickIdx);
                    handlePick();
                  }}
                  disabled={pickRow.disabled || lockedByResult}
                  title={pickRow.reason ?? undefined}
                  className={[
                    "rounded border border-parchment/25 bg-ink/60 px-3 py-2 text-left text-sm hover:bg-ink/80 disabled:cursor-not-allowed disabled:opacity-50",
                    focusIdx === pickIdx ? focusRing : "",
                  ].join(" ")}
                >
                  <div className="font-medium">
                    {result && !result.success && result.kind === "pick"
                      ? `Try Again — ${pickRow.label}`
                      : pickRow.label}
                  </div>
                  {pickRow.reason ? (
                    <div className="text-[11px] text-parchment/55">
                      {pickRow.reason}
                    </div>
                  ) : (
                    <div className="text-[11px] text-parchment/55">
                      d20 + DEX vs DC 12 (consumes one Lockpick).
                    </div>
                  )}
                </button>

                {knockRow ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFocusIdx(knockIdx);
                      handleKnock();
                    }}
                    disabled={knockRow.disabled || lockedByResult}
                    title={knockRow.reason ?? undefined}
                    className={[
                      "rounded border border-parchment/25 bg-ink/60 px-3 py-2 text-left text-sm hover:bg-ink/80 disabled:cursor-not-allowed disabled:opacity-50",
                      focusIdx === knockIdx ? focusRing : "",
                    ].join(" ")}
                  >
                    <div className="font-medium">
                      {result && !result.success && result.kind === "knock"
                        ? `Try Again — ${knockRow.label}`
                        : knockRow.label}
                    </div>
                    {knockRow.reason ? (
                      <div className="text-[11px] text-parchment/55">
                        {knockRow.reason}
                      </div>
                    ) : (
                      <div className="text-[11px] text-parchment/55">
                        d20 + INT vs DC 12 (MP deducted on attempt).
                      </div>
                    )}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    setFocusIdx(leaveIdx);
                    onClose();
                  }}
                  disabled={lockedByResult}
                  className={[
                    "rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm hover:bg-ink/60 disabled:opacity-50",
                    focusIdx === leaveIdx ? focusRing : "",
                  ].join(" ")}
                >
                  <div className="font-medium">Leave</div>
                  <div className="text-[11px] text-parchment/55">
                    Step back; the door stays locked.
                  </div>
                </button>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
