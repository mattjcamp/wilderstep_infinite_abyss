"use client";

/**
 * SpawnPicker — graphical picker for a map cell's `spawn` (monster
 * lair), used by the Map editor's cell inspector. Same shape as the
 * EncounterPicker: a closed summary button that expands into a list.
 *
 * Each row shows the lair's marker sprite (the Spawn's `sprite`, which
 * is what gets drawn on the map cell), its name and id, the roamers it
 * sends out and the boss fight on the lair itself. Spawns are few, so
 * the list is flat (alphabetical) rather than grouped.
 *
 * Controlled: `value` is the selected spawn id ("" = none), `onChange`
 * reports the new id. The host passes the merged spawns.json records.
 */

import { useState } from "react";
import { spriteUrl } from "@/data_model/spriteUrl";

/** The slice of a Spawn the picker reads (extra fields ignored). */
export interface SpawnPickerEntry {
  id: string;
  name?: string;
  sprite?: unknown;
  spawn_monsters?: unknown;
  boss_monsters?: unknown;
  active_time_of_day?: unknown;
  active_moon_phases?: unknown;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** ["goblin","goblin","orc"] → "goblin ×2, orc". */
function summarizeRoster(v: unknown): string {
  const counts = new Map<string, number>();
  for (const id of strList(v)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .map(([id, n]) => (n > 1 ? `${id} ×${n}` : id))
    .join(", ");
}

function spriteOf(e: SpawnPickerEntry | null): string {
  const s = typeof e?.sprite === "string" ? e.sprite.trim() : "";
  return s.includes("/") ? s : "";
}

export function SpawnPicker({
  value,
  spawns,
  onChange,
}: {
  value: string;
  spawns: ReadonlyArray<SpawnPickerEntry>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = spawns.find((s) => s.id === value) ?? null;
  const sorted = [...spawns].sort((a, b) =>
    (a.name ?? a.id).localeCompare(b.name ?? b.id),
  );
  const summary = !value
    ? "(none)"
    : current
      ? (current.name ?? current.id)
      : `${value} ⚠`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-left text-sm text-parchment hover:bg-ink/60"
          aria-expanded={open}
        >
          <span className="text-parchment/60">{open ? "▾" : "▸"}</span>
          {value ? <LairThumb path={spriteOf(current)} alt={summary} /> : null}
          <span className="truncate">{summary}</span>
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/85 hover:bg-ink/40"
            title="Clear the spawn (this cell stops being a lair)."
          >
            ✕
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-1 max-h-72 overflow-auto rounded border border-parchment/15 bg-ink/60 p-2">
          {spawns.length === 0 ? (
            <p className="text-[13px] text-parchment/70">
              No spawns defined in this module.
            </p>
          ) : (
            <ul className="space-y-1">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition ${
                    value === ""
                      ? "bg-ember/30 text-parchment"
                      : "text-parchment/75 hover:bg-ink/40"
                  }`}
                >
                  <span className="inline-block h-8 w-8 shrink-0" />
                  <span className="font-mono text-parchment/70">(none)</span>
                </button>
              </li>
              {sorted.map((s) => {
                const isActive = s.id === value;
                const roamers = summarizeRoster(s.spawn_monsters);
                const boss = summarizeRoster(s.boss_monsters);
                const gates = [
                  ...strList(s.active_time_of_day),
                  ...strList(s.active_moon_phases).map((p) => p.replace(/_/g, " ")),
                ];
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(s.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-start gap-2 rounded px-2 py-1 text-left text-sm transition ${
                        isActive
                          ? "bg-ember/30 text-parchment"
                          : "text-parchment/85 hover:bg-ink/40"
                      }`}
                    >
                      <LairThumb path={spriteOf(s)} alt={s.name ?? s.id} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">{s.name ?? s.id}</span>
                          {gates.length > 0 ? (
                            <span className="shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-sky-300">
                              {gates.join(" · ")}
                            </span>
                          ) : null}
                        </span>
                        <span className="block font-mono text-xs text-parchment/55">
                          {s.id}
                        </span>
                        {roamers ? (
                          <span className="block text-xs text-parchment/65">
                            Roamers: {roamers}
                          </span>
                        ) : null}
                        {boss ? (
                          <span className="block text-xs text-parchment/65">
                            Boss: {boss}
                          </span>
                        ) : null}
                        {!spriteOf(s) ? (
                          <span className="block text-xs text-amber-300/80">
                            No lair sprite — set one on the Spawn to mark the
                            cell.
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 32×32 pixelated thumbnail of the lair marker (empty slot if none). */
function LairThumb({ path, alt }: { path: string; alt: string }) {
  if (!path) {
    return (
      <span className="inline-block h-8 w-8 shrink-0 rounded border border-dashed border-parchment/20 bg-ink/40" />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={spriteUrl(path)}
      alt={alt}
      width={32}
      height={32}
      style={{ imageRendering: "pixelated" }}
      className="h-8 w-8 shrink-0 rounded border border-parchment/15 bg-ink/40 object-contain"
    />
  );
}
