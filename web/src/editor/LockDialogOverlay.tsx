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
 * overlay shows the result for ~1.4s before auto-closing so the
 * player sees the roll math, then yields back to keyboard movement.
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

  // Auto-close after a successful attempt so the player isn't stuck
  // tapping Leave. Failures stay open so the player can read the
  // dice math and pick another option (or commit to Leave).
  useEffect(() => {
    if (!result || !result.success) return;
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
  }, [result, onClose]);

  // Pick Lock row gate — disabled with a tooltip-style reason when
  // either the party or the stash is missing the requirement.
  const pickRow = (() => {
    if (!options.picker) {
      return {
        label: "Pick Lock",
        reason: "Need a Thief or L3+ Ranger in the party.",
        disabled: true,
      };
    }
    if (options.lockpickCharges <= 0) {
      return {
        label: `Pick Lock — ${options.picker.name}`,
        reason: "Stash has no Lockpicks. Add one to the party inventory.",
        disabled: true,
      };
    }
    return {
      label: `Pick Lock — ${options.picker.name} (${options.lockpickCharges} pick${options.lockpickCharges === 1 ? "" : "s"})`,
      reason: null as string | null,
      disabled: false,
    };
  })();

  // Cast Knock row — only rendered when the module declares a Knock
  // spell. The simulator catalog's `knockSpell` is null when not
  // loaded; `knockMpCost === null` is the signal here.
  const knockRow = (() => {
    if (options.knockMpCost === null) return null;
    if (!options.knockCaster) {
      return {
        label: "Cast Knock",
        reason: "No eligible caster (needs a sorcerer-catalog class at or above the spell's min level).",
        disabled: true,
      };
    }
    const mp = options.knockCaster.mp ?? 0;
    if (mp < options.knockMpCost) {
      return {
        label: `Cast Knock — ${options.knockCaster.name}`,
        reason: `Insufficient MP (${mp}/${options.knockMpCost}).`,
        disabled: true,
      };
    }
    return {
      label: `Cast Knock — ${options.knockCaster.name} (${options.knockMpCost} MP)`,
      reason: null as string | null,
      disabled: false,
    };
  })();

  const handlePick = () => {
    const r = onPickLock();
    if (r) setResult(r);
  };
  const handleKnock = () => {
    const r = onCastKnock();
    if (r) setResult(r);
  };

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
            ({options.pos.col}, {options.pos.row})
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
            {result.message}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handlePick}
            disabled={pickRow.disabled || !!result}
            title={pickRow.reason ?? undefined}
            className="rounded border border-parchment/25 bg-ink/60 px-3 py-2 text-left text-sm hover:bg-ink/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="font-medium">{pickRow.label}</div>
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
              disabled={knockRow.disabled || !!result}
              title={knockRow.reason ?? undefined}
              className="rounded border border-parchment/25 bg-ink/60 px-3 py-2 text-left text-sm hover:bg-ink/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="font-medium">{knockRow.label}</div>
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
            disabled={!!result && result.success}
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
