"use client";

/**
 * Monster abilities editor — structured editor for a monster's
 * `abilities` list (links into monster_abilities.json), replacing the
 * raw JSON textarea.
 *
 * Layout, per row:
 *
 *   Ability Name (id)   [cast 25] %   [overrides {…}]   ✕
 *
 * plus "+ Add ability…", which opens the shared filterable catalog
 * panel. Row order matters — the combat AI walks the list top to
 * bottom — so rows can be moved up and down.
 *
 * Overrides are any extra keys on the link (`damage_bonus`, `save_dc`,
 * `name`, …) that replace the catalog record's value for this monster
 * only. They're edited as a small JSON object; invalid JSON is kept in
 * the input (red) and not written until it parses. Abilities the
 * catalog no longer carries render in warning colour but are kept.
 */

import { useMemo, useState } from "react";
import { IdOptionPanel, useIdOptions, type IdListOption } from "./IdListPicker";
import type { IdListSource } from "./idListFields";

export interface MonsterAbilityLink {
  ability_id: string;
  cast_chance?: number;
  [override: string]: unknown;
}

const SOURCE: IdListSource = { kind: "catalog", model: "monster_abilities" };

/** True when `v` is an array of `{ ability_id: string }` objects. */
export function isAbilityLinkList(v: unknown): v is MonsterAbilityLink[] {
  return (
    Array.isArray(v) &&
    v.every(
      (x) => !!x && typeof x === "object" && typeof (x as MonsterAbilityLink).ability_id === "string",
    )
  );
}

function overridesOf(link: MonsterAbilityLink): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ability_id, cast_chance, ...rest } = link;
  return rest;
}

export function MonsterAbilitiesEditor({
  value,
  onChange,
  moduleId = "default",
}: {
  value: ReadonlyArray<MonsterAbilityLink>;
  onChange: (next: MonsterAbilityLink[]) => void;
  moduleId?: string;
}) {
  const [open, setOpen] = useState(false);
  const state = useIdOptions(moduleId, SOURCE);
  const optionById = useMemo(() => {
    const m = new Map<string, IdListOption>();
    if (state.kind === "ok") for (const o of state.options) m.set(o.id, o);
    return m;
  }, [state]);

  const setAt = (idx: number, next: MonsterAbilityLink) =>
    onChange(value.map((e, i) => (i === idx ? next : e)));
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  return (
    <div className="flex-1">
      <div className="space-y-1">
        {value.length === 0 ? (
          <p className="text-sm text-parchment/55">(no special abilities — melee only)</p>
        ) : null}
        {value.map((link, idx) => {
          const opt = optionById.get(link.ability_id);
          const unknown = state.kind === "ok" && !opt;
          const label = opt?.label ?? link.ability_id;
          return (
            <div key={`${link.ability_id}-${idx}`} className="flex flex-wrap items-center gap-2">
              <span className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  title="Move up (the AI tries abilities top to bottom)"
                  className="text-[10px] leading-none text-parchment/60 hover:text-parchment disabled:opacity-25"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, 1)}
                  disabled={idx === value.length - 1}
                  title="Move down"
                  className="text-[10px] leading-none text-parchment/60 hover:text-parchment disabled:opacity-25"
                >
                  ▼
                </button>
              </span>
              <span
                className={`min-w-[10rem] flex-1 truncate text-sm ${
                  unknown ? "text-ember/90" : "text-parchment/85"
                }`}
                title={unknown ? `"${link.ability_id}" isn't a known monster ability — kept as-is.` : link.ability_id}
              >
                {label}
                {label !== link.ability_id ? (
                  <span className="ml-1 font-mono text-parchment/55">({link.ability_id})</span>
                ) : null}
              </span>
              <label className="flex shrink-0 items-center gap-1 text-xs text-parchment/60">
                cast
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={typeof link.cast_chance === "number" ? link.cast_chance : 0}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    setAt(idx, {
                      ...link,
                      cast_chance: Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0,
                    });
                  }}
                  title="Chance (0–100) the monster uses this on its turn"
                  className="w-16 rounded border border-parchment/20 bg-ink/50 px-2 py-0.5 text-sm text-parchment/90 focus:border-parchment/60 focus:outline-none"
                />
                %
              </label>
              <OverridesInput
                value={overridesOf(link)}
                onChange={(ov) =>
                  setAt(idx, { ability_id: link.ability_id, cast_chance: link.cast_chance, ...ov })
                }
              />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== idx))}
                title="Remove ability"
                className="shrink-0 rounded border border-parchment/20 px-1.5 text-parchment/70 hover:bg-ink/50 hover:text-parchment"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/85 hover:bg-ink/50"
        >
          {open ? "Done" : "+ Add ability…"}
        </button>
        {open ? (
          <IdOptionPanel
            state={state}
            onPick={(id) => onChange([...value, { ability_id: id, cast_chance: 20 }])}
          />
        ) : null}
      </div>
      <p className="mt-1 text-xs text-parchment/60">
        Abilities come from Monster Abilities. Cast % is rolled each turn, top to bottom.
        Overrides replace the ability&apos;s values for this monster only, e.g.{" "}
        <span className="font-mono">{`{"damage_bonus": 2}`}</span>.
      </p>
    </div>
  );
}

function OverridesInput({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const text = Object.keys(value).length ? JSON.stringify(value) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? text;
  let valid = true;
  if (draft !== null && draft.trim() !== "") {
    try {
      const p = JSON.parse(draft);
      valid = !!p && typeof p === "object" && !Array.isArray(p);
    } catch {
      valid = false;
    }
  }
  return (
    <input
      type="text"
      value={shown}
      placeholder="overrides {…}"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        if (draft.trim() === "") {
          onChange({});
          setDraft(null);
        } else if (valid) {
          onChange(JSON.parse(draft) as Record<string, unknown>);
          setDraft(null);
        }
      }}
      title="Per-monster overrides (JSON object). Applied when you leave the field."
      className={`w-48 shrink-0 rounded border bg-ink/50 px-2 py-0.5 font-mono text-xs text-parchment/90 focus:outline-none ${
        valid ? "border-parchment/20 focus:border-parchment/60" : "border-ember/70"
      }`}
    />
  );
}
