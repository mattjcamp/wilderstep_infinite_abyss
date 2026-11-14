"use client";

/**
 * Party Attributes — the editable form for the Party singleton's
 * scalar fields, shown under the in-game Party Screen preview in the
 * Party editor. Roster and inventory are edited directly in the
 * preview; everything else that seeds a new game lives here:
 *
 *   - Start position (map + cell), with an out-of-bounds warning
 *   - Overworld avatar sprite
 *   - Starting gold
 *   - Torch / Galadriel's Light steps already lit at the start
 *   - Party effects active from the start (abilities flagged
 *     `party_effect: true`)
 *
 * In a module that extends another, each field shows whether it is
 * inherited or set here, and fields set here offer "Use inherited" to
 * drop the override. The host owns persistence (draft) — this
 * component only calls `onSet` / `onReset`.
 */

import { useEffect, useState, type ReactNode } from "react";
import { SpritePicker } from "./SpritePicker";
import { MapPickerField } from "./MapPickerDialog";
import type { PartyAbilityRef, PartyRecord } from "./PartyScreen";

export interface PartyMapRef {
  id: string;
  name?: string;
  tags?: string[];
  width?: number;
  height?: number;
  description?: string;
}

interface StartPosition {
  map_id?: string;
  col?: number;
  row?: number;
}

const AVATAR_CONFIG = { category: "person", format: "path" } as const;

export function PartyAttributesEditor({
  party,
  ownKeys,
  hasParent,
  maps,
  mapTagOrder,
  abilities,
  onSet,
  onReset,
}: {
  /** Effective (merged) party record. */
  party: PartyRecord;
  /** Keys the module's own party file sets (vs inherits). */
  ownKeys: ReadonlySet<string>;
  /** True when the module extends another — enables the
   *  inherited / overridden badges and "Use inherited". */
  hasParent: boolean;
  maps: ReadonlyArray<PartyMapRef>;
  /** maps.json tag order — pinned tag groups first in the picker. */
  mapTagOrder?: ReadonlyArray<string>;
  abilities: ReadonlyArray<PartyAbilityRef>;
  onSet: (key: string, value: unknown) => void;
  onReset: (key: string) => void;
}) {
  const start = (party.start_position ?? {}) as StartPosition;
  const startMap = maps.find((m) => m.id === start.map_id);
  const col = start.col ?? 0;
  const row = start.row ?? 0;
  const outOfBounds =
    !!startMap &&
    typeof startMap.width === "number" &&
    typeof startMap.height === "number" &&
    (col < 0 || row < 0 || col >= startMap.width || row >= startMap.height);
  const setStart = (patch: StartPosition) =>
    onSet("start_position", { map_id: "", col: 0, row: 0, ...start, ...patch });

  const effectAbilities = abilities.filter(
    (a) => (a as { party_effect?: boolean }).party_effect === true,
  );
  const activeEffects = new Set(party.party_effects ?? []);

  const field = (key: string, label: string, body: ReactNode, hint?: ReactNode) => (
    <FieldRow
      label={label}
      hint={hint}
      inherited={hasParent && !ownKeys.has(key)}
      onReset={hasParent && ownKeys.has(key) ? () => onReset(key) : undefined}
    >
      {body}
    </FieldRow>
  );

  return (
    <section className="rounded border border-parchment/15 bg-ink/30 p-3">
      <h3 className="mb-2 text-[13px] uppercase tracking-wide text-amber-300">
        Party Attributes
      </h3>
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        {field(
          "start_position",
          "Start position",
          <div className="flex flex-wrap items-center gap-1">
            <MapPickerField
              className="min-w-0 flex-1"
              title="Party start map"
              value={start.map_id ?? ""}
              maps={maps}
              tagOrder={mapTagOrder}
              onChange={(id) => setStart({ map_id: id })}
            />
            <NumberInput
              label="Start column"
              placeholder="col"
              value={col}
              min={0}
              onCommit={(n) => setStart({ col: n })}
            />
            <NumberInput
              label="Start row"
              placeholder="row"
              value={row}
              min={0}
              onCommit={(n) => setStart({ row: n })}
            />
          </div>,
          start.map_id && !startMap ? (
            <span className="text-amber-200/90">
              Unknown map id — not present in maps.json.
            </span>
          ) : outOfBounds ? (
            <span className="text-amber-200/90">
              ({col}, {row}) is outside {startMap?.name ?? start.map_id} (
              {startMap?.width}×{startMap?.height}).
            </span>
          ) : startMap?.width ? (
            <>Map is {startMap.width}×{startMap.height}. Where a new game begins.</>
          ) : (
            <>Where a new game begins.</>
          ),
        )}

        {field(
          "avatar",
          "Overworld avatar",
          <SpritePicker
            value={typeof party.avatar === "string" ? party.avatar : ""}
            config={AVATAR_CONFIG}
            onChange={(v) => onSet("avatar", v)}
          />,
          <>The sprite drawn for the whole party on the map.</>,
        )}

        {field(
          "gold",
          "Starting gold",
          <NumberInput
            label="Starting gold"
            value={party.gold ?? 0}
            min={0}
            wide
            onCommit={(n) => onSet("gold", n)}
          />,
        )}

        {field(
          "torch_steps",
          "Torch steps lit",
          <NumberInput
            label="Torch steps lit at start"
            value={party.torch_steps ?? 0}
            min={0}
            wide
            onCommit={(n) => onSet("torch_steps", n)}
          />,
          <>Steps of torchlight already burning when the game starts.</>,
        )}

        {field(
          "galadriels_light_steps",
          "Elven Light steps",
          <NumberInput
            label="Elven Light steps at start"
            value={
              typeof party.galadriels_light_steps === "number"
                ? party.galadriels_light_steps
                : 0
            }
            min={0}
            wide
            onCommit={(n) => onSet("galadriels_light_steps", n)}
          />,
        )}

        {field(
          "party_effects",
          "Effects active at start",
          effectAbilities.length === 0 ? (
            <p className="text-xs text-parchment/55">
              No abilities are flagged as party effects.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {effectAbilities.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-1.5 text-[13px] text-parchment/85"
                >
                  <input
                    type="checkbox"
                    checked={activeEffects.has(a.id)}
                    onChange={(e) => {
                      const next = new Set(activeEffects);
                      if (e.target.checked) next.add(a.id);
                      else next.delete(a.id);
                      onSet(
                        "party_effects",
                        effectAbilities.map((x) => x.id).filter((id) => next.has(id)),
                      );
                    }}
                  />
                  {a.name ?? a.id}
                </label>
              ))}
            </div>
          ),
          <>Party-wide abilities switched on for a new game.</>,
        )}
      </div>
    </section>
  );
}

function FieldRow({
  label,
  hint,
  inherited,
  onReset,
  children,
}: {
  label: string;
  hint?: ReactNode;
  inherited: boolean;
  onReset?: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-parchment/70">
          {label}
        </span>
        {inherited ? (
          <span
            className="rounded border border-parchment/20 px-1.5 text-[10px] uppercase tracking-wide text-parchment/50"
            title="Not set in this module — inherited from the module it extends. Editing it sets it here."
          >
            inherited
          </span>
        ) : null}
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] text-parchment/55 underline decoration-dotted hover:text-parchment"
            title="Drop this module's value and inherit it again."
          >
            Use inherited
          </button>
        ) : null}
      </div>
      {children}
      {hint ? <p className="mt-0.5 text-xs text-parchment/55">{hint}</p> : null}
    </div>
  );
}

/** Integer field that commits on blur / Enter, so typing "120" doesn't
 *  write 1, 12, 120 to the draft. */
function NumberInput({
  label,
  value,
  min,
  placeholder,
  wide = false,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  placeholder?: string;
  wide?: boolean;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    let n = Math.floor(Number(text));
    if (!Number.isFinite(n)) n = value;
    if (typeof min === "number") n = Math.max(min, n);
    setText(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      min={min}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      title={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      className={[
        "rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90",
        wide ? "w-32" : "w-16",
      ].join(" ")}
    />
  );
}
