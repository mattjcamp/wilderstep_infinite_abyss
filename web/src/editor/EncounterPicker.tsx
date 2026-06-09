"use client";

/**
 * EncounterPicker — the shared graphical encounter picker used by BOTH
 * the Quest editor's "kill" step row AND the Map editor's cell
 * inspector. A single component so the two surfaces behave identically.
 *
 * Each row shows the encounter's lead-monster sprite
 * (`monster_party_tile`), name, id, roster, and a highlighted
 * DIFFICULTY badge (derived from the encounter's level). The list is
 * grouped by THEME (devil, undead, …); theme groups start COLLAPSED so
 * the picker opens as a compact index — click a theme to expand it.
 * Within a theme, encounters order by difficulty (level, easiest
 * first).
 *
 * Layout:
 *   [ ▸ Encounter name (Hard) ]  [ ✕ clear ]
 *   (expands) ┌─ collapsible theme headers → encounter rows ─┐
 *
 * Controlled component: `value` is the selected encounter id ("" =
 * none), `onChange` reports the new id. The host passes the already-
 * merged `encounters` list (per-module + inherited encounters are
 * respected — the picker doesn't fetch a hardcoded catalog).
 */

import { useState } from "react";
import { withBasePath } from "@/util/basePath";

/** The slice of an encounter the picker reads. Hosts pass their merged
 *  encounters.json records (extra fields are ignored). */
export interface EncounterPickerEntry {
  id: string;
  name?: string;
  area?: string;
  /** Encounter level — drives both the difficulty badge and the
   *  difficulty ordering within a theme. */
  level?: number;
  weight?: number;
  /** Organizational theme (devil, undead, elemental, …) — drives the
   *  grouped headers. */
  theme?: string;
  /** Sprite path for the lead monster (`monster/goblin.png` etc.).
   *  Empty / missing renders as a placeholder square. */
  monster_party_tile?: string;
  monsters?: string[];
}

/** Difficulty tier derived from encounter level — mirrors the
 *  Easy/Normal/Hard/Deadly bands the monster catalog + spawn sampler
 *  use (1–2 easy, 3–4 normal, 5–6 hard, 7+ deadly). Returns a label +
 *  the Tailwind classes for its highlight chip. `null` level → no
 *  badge. */
function difficultyFor(
  level: number | undefined,
): { label: string; cls: string } | null {
  if (typeof level !== "number") return null;
  if (level <= 2) return { label: "Easy", cls: "bg-emerald-500/20 text-emerald-300" };
  if (level <= 4) return { label: "Normal", cls: "bg-sky-500/20 text-sky-300" };
  if (level <= 6) return { label: "Hard", cls: "bg-amber-500/25 text-amber-300" };
  return { label: "Deadly", cls: "bg-ember/30 text-parchment" };
}

/** Small highlighted difficulty chip. */
function DifficultyBadge({ level }: { level: number | undefined }) {
  const d = difficultyFor(level);
  if (!d) return null;
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${d.cls}`}
      title={typeof level === "number" ? `Level ${level}` : undefined}
    >
      {d.label}
    </span>
  );
}

const UNTHEMED = "(other)";

/** "devil" → "Devil", "house_basement" → "House Basement". */
function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Group encounters by `theme`, ordered alphabetically (untheme'd last);
 * within each theme order by DIFFICULTY — encounter level ascending
 * (unleveled last), then display name.
 */
function groupByThemeThenDifficulty(
  encounters: ReadonlyArray<EncounterPickerEntry>,
): Array<{ theme: string; label: string; items: EncounterPickerEntry[] }> {
  const groups = new Map<string, EncounterPickerEntry[]>();
  for (const e of encounters) {
    const theme = e.theme && e.theme.trim() ? e.theme.trim() : "";
    if (!groups.has(theme)) groups.set(theme, []);
    groups.get(theme)!.push(e);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return a.localeCompare(b);
  });
  return keys.map((theme) => ({
    theme,
    label: theme ? titleCase(theme) : UNTHEMED,
    items: groups
      .get(theme)!
      .slice()
      .sort((a, b) => {
        const la = typeof a.level === "number" ? a.level : Infinity;
        const lb = typeof b.level === "number" ? b.level : Infinity;
        if (la !== lb) return la - lb;
        return (a.name ?? a.id).localeCompare(b.name ?? b.id);
      }),
  }));
}

export function EncounterPicker({
  value,
  encounters,
  onChange,
}: {
  value: string;
  encounters: ReadonlyArray<EncounterPickerEntry>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const current = encounters.find((e) => e.id === value) ?? null;

  // Theme groups start collapsed — but the group holding the current
  // selection opens by default so an existing pick is visible without
  // hunting for it. Stored as the set of EXPANDED themes.
  const [openThemes, setOpenThemes] = useState<Set<string>>(() => {
    const t = current?.theme?.trim();
    return new Set(t ? [t] : []);
  });
  const toggleTheme = (theme: string) =>
    setOpenThemes((prev) => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return next;
    });

  const summary = (() => {
    if (!value) return "(none)";
    if (!current) {
      // Value points at an encounter the list doesn't recognize —
      // surface with a warning marker so the designer notices.
      return `${value} ⚠`;
    }
    const d = difficultyFor(current.level);
    const name = current.name ?? current.id;
    return d ? `${name} (${d.label})` : name;
  })();

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
          {current?.monster_party_tile ? (
            <SpriteThumb
              path={current.monster_party_tile}
              alt={current.name ?? current.id}
            />
          ) : null}
          <span className="truncate">{summary}</span>
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/85 hover:bg-ink/40"
            title="Clear the encounter selection."
          >
            ✕
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-1 max-h-64 overflow-auto rounded border border-parchment/15 bg-ink/60 p-2">
          {encounters.length === 0 ? (
            <p className="text-[13px] text-parchment/70">
              No encounters defined in this module.
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
                  <span className="inline-block h-6 w-6 shrink-0" />
                  <span className="font-mono text-parchment/70">(none)</span>
                </button>
              </li>
              {groupByThemeThenDifficulty(encounters).map((group) => {
                const expanded = openThemes.has(group.theme);
                return (
                  <li key={`theme:${group.theme}`}>
                    {/* Collapsible theme header — collapsed by default so
                        the picker opens as a short index. */}
                    <button
                      type="button"
                      onClick={() => toggleTheme(group.theme)}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs uppercase tracking-wide text-parchment/65 hover:bg-ink/40 hover:text-parchment/85"
                      aria-expanded={expanded}
                    >
                      <span className="flex items-center gap-1">
                        <span className="text-parchment/60">
                          {expanded ? "▾" : "▸"}
                        </span>
                        {group.label}
                      </span>
                      <span className="normal-case tracking-normal text-parchment/45">
                        {group.items.length}
                      </span>
                    </button>
                    {expanded ? (
                      <ul className="mt-1 space-y-1">
                        {group.items.map((e) => {
                          const isActive = e.id === value;
                          return (
                            <li key={e.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  onChange(e.id);
                                  setOpen(false);
                                }}
                                className={`flex w-full items-start gap-2 rounded px-2 py-1 text-left text-sm transition ${
                                  isActive
                                    ? "bg-ember/30 text-parchment"
                                    : "text-parchment/85 hover:bg-ink/40"
                                }`}
                              >
                                {e.monster_party_tile ? (
                                  <SpriteThumb
                                    path={e.monster_party_tile}
                                    alt={e.name ?? e.id}
                                  />
                                ) : (
                                  <span className="inline-block h-6 w-6 shrink-0 rounded border border-parchment/15 bg-ink/40" />
                                )}
                                <span className="flex-1">
                                  <span className="flex items-baseline justify-between gap-2">
                                    <span className="font-medium">
                                      {e.name ?? e.id}
                                    </span>
                                    <DifficultyBadge level={e.level} />
                                  </span>
                                  <span className="block font-mono text-xs text-parchment/55">
                                    {e.id}
                                  </span>
                                  {e.monsters && e.monsters.length > 0 ? (
                                    <span className="block font-mono text-xs text-parchment/65">
                                      {e.monsters.join(", ")}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
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

/** Small 24×24 sprite thumbnail rendered with pixelated nearest-
 *  neighbour scaling so the source art's hard edges survive. Used
 *  on both the closed picker (one sprite) and each list row. */
function SpriteThumb({ path, alt }: { path: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={withBasePath(`/sprites/${path}`)}
      alt={alt}
      width={24}
      height={24}
      style={{ imageRendering: "pixelated" }}
      className="h-6 w-6 shrink-0 rounded border border-parchment/15 bg-ink/40 object-contain"
    />
  );
}
