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

import { useEffect, useState } from "react";
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
          <button
            type="button"
            onClick={handlePick}
            disabled={pickRow.disabled || lockedByResult}
            title={pickRow.reason ?? undefined}
            className="rounded border border-parchment/25 bg-ink/60 px-3 py-2 text-left text-sm hover:bg-ink/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="font-medium">
              {result && !result.success && result.kind === "pick"
                ? `Try Again — ${pickRow.label}`
                : pickRow.label}
            </div>
            {pickRow.reason ? (
              <div className="text-[11px] text-parchment/55">{pickRow.reason}</div>
            ) : (
              <div className="text-[11px] text-parchment/55">
                d20 + DEX vs DC 12 (consumes one Lockpick).
              </div>
            )}
          </button>

          {knockRow ? (
            <button
              type="button"
              onClick={handleKnock}
              disabled={knockRow.disabled || lockedByResult}
              title={knockRow.reason ?? undefined}
              className="rounded border border-parchment/25 bg-ink/60 px-3 py-2 text-left text-sm hover:bg-ink/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="font-medium">
                {result && !result.success && result.kind === "knock"
                  ? `Try Again — ${knockRow.label}`
                  : knockRow.label}
              </div>
              {knockRow.reason ? (
                <div className="text-[11px] text-parchment/55">{knockRow.reason}</div>
              ) : (
                <div className="text-[11px] text-parchment/55">
                  d20 + INT vs DC 12 (MP deducted on attempt).
                </div>
              )}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            disabled={lockedByResult}
            className="rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm hover:bg-ink/60 disabled:opacity-50"
          >
            <div className="font-medium">Leave</div>
            <div className="text-[11px] text-parchment/55">
              Step back; the door stays locked.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
