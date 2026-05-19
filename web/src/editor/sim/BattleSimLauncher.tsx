"use client";

/**
 * BattleSimLauncher — visual-test launcher for CombatScene. Loads the
 * module's encounter + monster catalogs so the picker can render each
 * encounter's lead-monster sprite alongside the name. Party comes from
 * `modules/<id>/party.json` (see BattleSimMount + the live loadParty
 * path in CombatScene).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BattleSimMount } from "./BattleSimMount";
import { loadAllEncounters, _clearEncountersCache, type EncounterTemplate } from "@/battle/world/Encounters";
import { loadMonsters, _clearMonstersCache, type MonsterSpec } from "@/battle/data/monsters";
import { loadArenaMaps, _clearMapsCache, type ArenaCellInfo, type ArenaMap } from "@/battle/world/Maps";
import { setActiveModule, withBase } from "@/battle/world/Module";
import { ARENA_COLS, ARENA_ROWS } from "@/battle/combat/Arena";

export function BattleSimLauncher({ moduleId }: { moduleId: string }) {
  const [started, setStarted] = useState(false);
  const [encounters, setEncounters] = useState<EncounterTemplate[]>([]);
  const [monsters, setMonsters] = useState<Map<string, MonsterSpec>>(
    () => new Map(),
  );
  const [arenaMaps, setArenaMaps] = useState<ArenaMap[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  /** Empty string = "no map, use the default dark-fill arena". Any
   *  non-empty value is an `ArenaMap.id`. */
  const [selectedMapId, setSelectedMapId] = useState<string>("");
  /** Darkness toggle — when on, CombatScene paints a dark overlay over
   *  the arena and only cells with a `light_source` (plus a small pool
   *  around the active party member) read as lit. Off by default so
   *  existing arenas keep their fully-bright look. */
  const [darkness, setDarkness] = useState<boolean>(false);
  /** Infravision toggle — opt-in switch matching the dungeon
   *  simulator. When on (and `darkness` is on), in-LOS dark cells
   *  in the arena render as red overlays and become targetable.
   *  Off keeps the legacy combat behaviour. Restarts the in-flight
   *  fight on change, same as `darkness`. */
  const [partyInfravisionActive, setPartyInfravisionActive] =
    useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pin loaders to the picked module + reset all three caches when
  // switching modules so the pickers show the right catalog. The
  // caches are also reset in case the user navigates between modules
  // without a full page reload.
  useEffect(() => {
    setActiveModule(moduleId);
    _clearEncountersCache();
    _clearMonstersCache();
    _clearMapsCache();
    let cancelled = false;
    (async () => {
      try {
        // Three catalogs in parallel — encounters, monsters (so the
        // picker rows can render lead-monster sprites), and arena
        // maps (so the Map picker has options the moment it renders).
        const [list, mons, maps] = await Promise.all([
          loadAllEncounters(),
          loadMonsters(),
          loadArenaMaps(),
        ]);
        if (cancelled) return;
        setEncounters(list);
        setMonsters(mons);
        setArenaMaps(maps);
        // Default to the first eligible entry so Start Battle works
        // without an extra click. Empty catalog → keep selectedId empty
        // and the Start button disables itself below.
        setSelectedId((prev) => {
          const next = prev || list[0]?.id || "";
          // Apply encounter-declared defaults (arena_id, darkness)
          // exactly once per module load — only when there was no
          // prior selection to preserve, so re-mounting doesn't
          // clobber a manual map / darkness override the user made
          // before navigating away and back.
          if (!prev && next) {
            const first = list.find((e) => e.id === next);
            if (first) applyEncounterDefaults(first, maps);
          }
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [moduleId]);

  // Group encounters by area for the popover sections. Memoised so
  // the picker doesn't rebuild on every selection change.
  const grouped = useMemo(() => {
    const byArea = new Map<string, EncounterTemplate[]>();
    for (const e of encounters) {
      const arr = byArea.get(e.area) ?? [];
      arr.push(e);
      byArea.set(e.area, arr);
    }
    // Stable area order: dungeon first (most encounters), then
    // overworld, then anything else in alpha order.
    const sortAreas = (a: string, b: string): number => {
      const order = (s: string): number =>
        s === "dungeon" ? 0 : s === "overworld" ? 1 : 2;
      const oa = order(a);
      const ob = order(b);
      return oa !== ob ? oa - ob : a.localeCompare(b);
    };
    return [...byArea.entries()]
      .sort(([a], [b]) => sortAreas(a, b))
      .map(([area, list]) => ({
        area,
        encounters: list.slice().sort(
          (x, y) => x.level - y.level || x.name.localeCompare(y.name),
        ),
      }));
  }, [encounters]);

  const selected = useMemo(
    () => encounters.find((e) => e.id === selectedId) ?? null,
    [encounters, selectedId],
  );

  const selectedMap = useMemo(
    () => arenaMaps.find((m) => m.id === selectedMapId) ?? null,
    [arenaMaps, selectedMapId],
  );

  // Resolve the picked map's grid into a per-cell info matrix the
  // CombatScene can preload, render, and consult for walkability /
  // line-of-sight. `sprite` is normalised to a base-prefixed
  // `/sprites/...` URL (or null for the default fill); `walkable`
  // and `obstructs` default to "open ground" when the cell is
  // missing or malformed, so a partial map degrades gracefully.
  const arenaCells = useMemo(() => {
    if (!selectedMap) return undefined;
    const matrix: (ArenaCellInfo | null)[][] = [];
    for (let r = 0; r < ARENA_ROWS; r++) {
      const row: (ArenaCellInfo | null)[] = [];
      const sourceRow = selectedMap.grid[r];
      for (let c = 0; c < ARENA_COLS; c++) {
        const cell = sourceRow?.[c];
        if (!cell) {
          row.push(null);
          continue;
        }
        const spritePath = cell.sprite;
        const sprite =
          typeof spritePath === "string" && spritePath.length > 0
            ? withBase(`/sprites/${spritePath}`)
            : null;
        // Lighting fields ride through the ArenaMapCell index
        // signature — the map editor saves them as `light_source` /
        // `light_range`. Normalise to the typed ArenaCellInfo shape
        // (camelCase, numeric range). The CombatScene only consults
        // these when the launcher's Darkness toggle is on.
        const rawLight = cell.light_source;
        const lightSource = rawLight === true
          || (typeof rawLight === "string" && rawLight.toLowerCase() === "true");
        const rawRange = cell.light_range;
        const lightRange = typeof rawRange === "number"
          ? rawRange
          : typeof rawRange === "string" && rawRange.trim() !== ""
            ? Number(rawRange)
            : undefined;
        // Per-cell animation key — torch/fire/fairy/smoke. Passed
        // through so CombatScene can mount the matching particle
        // emitter on top of the cell sprite. "none" or absent →
        // skipped (the scene treats undefined as "no emitter").
        const rawAnim = cell.animation;
        const animation =
          typeof rawAnim === "string" && rawAnim !== "none" && rawAnim !== ""
            ? rawAnim
            : undefined;
        row.push({
          sprite,
          walkable: cell.walkable !== false,
          obstructs: cell.obstructs === true,
          lightSource: lightSource || undefined,
          lightRange: Number.isFinite(lightRange) ? lightRange : undefined,
          animation,
        });
      }
      matrix.push(row);
    }
    return matrix;
  }, [selectedMap]);

  // Hot-swap the in-flight battle on encounter OR map change so the
  // user doesn't have to remember to press Restart Battle.
  const restartIfRunning = () => {
    if (!started) return;
    setStarted(false);
    setTimeout(() => setStarted(true), 0);
  };
  /**
   * Apply an encounter's authored defaults (`arena_id`, `darkness`) to
   * the launcher's map / darkness state. Idempotent — if the encounter
   * doesn't declare a field, the existing value stays. Unknown arena
   * ids fall back to the default arena (empty string) so a typo
   * doesn't strand the user on a broken map. Called from
   * `pickEncounter` and from the initial-load seed above.
   */
  const applyEncounterDefaults = (
    enc: EncounterTemplate,
    mapList: ArenaMap[],
  ) => {
    if (typeof enc.arenaId === "string") {
      const known = mapList.some((m) => m.id === enc.arenaId);
      setSelectedMapId(known ? enc.arenaId : "");
    }
    if (typeof enc.darkness === "boolean") {
      setDarkness(enc.darkness);
    }
  };
  const pickEncounter = (id: string) => {
    setSelectedId(id);
    const enc = encounters.find((e) => e.id === id) ?? null;
    if (enc) applyEncounterDefaults(enc, arenaMaps);
    restartIfRunning();
  };
  const pickMap = (id: string) => {
    setSelectedMapId(id);
    restartIfRunning();
  };
  const toggleDarkness = (next: boolean) => {
    setDarkness(next);
    // Darkness is a scene-level switch — the overlay is built in
    // create(), not driven by a per-frame prop. Restart so the change
    // takes effect immediately instead of "next battle".
    restartIfRunning();
  };

  // The Start button has caused at least one "battle just disappears"
  // bug in the past — when it kept focus, an Enter/Space pressed
  // inside the canvas bubbled back to it and re-toggled `started`,
  // unmounting the scene. Capture the ref so we can blur() after
  // every click.
  const startBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="p-4">
      <header className="mb-4">
        <h1 className="font-display text-3xl text-parchment">
          Battle Simulator
        </h1>
        <p className="mt-1 text-sm text-parchment/55">
          Visual test of v1&apos;s ported CombatScene driving the v2
          data model end-to-end. Party comes from{" "}
          <span className="font-mono">modules/{moduleId}/party.json</span>;
          pick an encounter below to choose the fight.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-parchment/45">
            Encounter
          </span>
          <EncounterPicker
            selected={selected}
            grouped={grouped}
            monsters={monsters}
            onPick={pickEncounter}
            disabled={encounters.length === 0}
            placeholder={
              encounters.length === 0
                ? loadError
                  ? "(failed to load)"
                  : "(loading…)"
                : "Pick an encounter…"
            }
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-parchment/45">
            Arena Map
          </span>
          <select
            value={selectedMapId}
            onChange={(e) => pickMap(e.target.value)}
            className="min-w-[200px] rounded border border-parchment/30 bg-ink/60 px-2 py-1 text-sm text-parchment focus:border-parchment/60 focus:outline-none"
            title={
              arenaMaps.length === 0
                ? `No maps tagged "battle_screen_arena" in this module.`
                : undefined
            }
          >
            <option value="">(default arena)</option>
            {arenaMaps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <label
          className="mt-[18px] flex cursor-pointer items-center gap-2 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment/80 hover:bg-ink/60"
          title="Paint a darkness overlay over the arena. Cells flagged light_source in the map editor (plus a small pool around the active party member) read as lit."
        >
          <input
            type="checkbox"
            checked={darkness}
            onChange={(e) => toggleDarkness(e.target.checked)}
            className="accent-ember"
          />
          Darkness
        </label>

        <label
          className="mt-[18px] flex cursor-pointer items-center gap-2 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment/80 hover:bg-ink/60"
          title="Engage the party's infravision ability in the arena. Only matters when Darkness is on: dark cells the party has line-of-sight to are highlighted in red and become targetable. Has no effect when no party member has the ability."
        >
          <input
            type="checkbox"
            checked={partyInfravisionActive}
            onChange={(e) => {
              setPartyInfravisionActive(e.target.checked);
              restartIfRunning();
            }}
            className="accent-ember"
          />
          Infravision
        </label>

        <button
          ref={startBtnRef}
          type="button"
          onClick={() => {
            setStarted((v) => !v);
            startBtnRef.current?.blur();
          }}
          disabled={!selected}
          className="mt-[18px] rounded border border-ember/60 bg-ember/30 px-4 py-1 text-sm text-parchment hover:bg-ember/50 disabled:opacity-50"
        >
          {started ? "Restart Battle" : "Start Battle"}
        </button>

        {selected && (
          <div className="mt-[18px] flex items-center gap-3">
            <p className="text-xs text-parchment/55">
              {selected.area} · lvl {selected.level} ·{" "}
              {selected.monsters.length} monster
              {selected.monsters.length === 1 ? "" : "s"}
            </p>
            <MonsterRoster
              monsterIds={selected.monsters}
              monsters={monsters}
            />
          </div>
        )}
      </section>

      {loadError && (
        <p className="mb-3 text-xs text-rust">
          Couldn&apos;t load encounters.json: {loadError}
        </p>
      )}

      {started && selected ? (
        // Remount on every Start press, encounter swap, OR map swap
        // so each run starts from a fresh scene with the right
        // arena. `selectedMap?.id ?? ""` keeps the key stable when no
        // map is picked.
        <BattleSimMount
          key={`${started}:${selected.id}:${selectedMap?.id ?? ""}:${darkness ? "dark" : "light"}:${partyInfravisionActive ? "ir" : "noir"}`}
          moduleId={moduleId}
          monsterIds={selected.monsters}
          arenaCells={arenaCells}
          darkness={darkness}
          partyInfravisionActive={partyInfravisionActive}
        />
      ) : (
        <p className="text-sm text-parchment/45">
          Press <em>Start Battle</em> to mount the v1 combat scene with
          the picked encounter.
        </p>
      )}
    </div>
  );
}

/**
 * Resolve the sprite the picker should show for a given encounter.
 * Prefers the looked-up monster's `sprite` (a pre-resolved
 * `/sprites/...` URL) when the catalog has it; falls back to the raw
 * `monster_party_tile` path so the row still renders something useful
 * before monsters.json finishes loading.
 */
function leadSpriteFor(
  encounter: EncounterTemplate,
  monsters: ReadonlyMap<string, MonsterSpec>,
): string | null {
  const leadId = encounter.monsters[0] ?? encounter.monsterPartyTile;
  const spec = leadId ? monsters.get(leadId) : null;
  return spec?.sprite ?? null;
}

/**
 * Button + popover encounter picker. Native <select>/<option>
 * elements can't render images, so we replace the dropdown with a
 * custom listbox that has the lead-monster sprite at the front of
 * every row, grouped by area. Click outside or press ESC to close.
 */
function EncounterPicker({
  selected,
  grouped,
  monsters,
  onPick,
  disabled,
  placeholder,
}: {
  selected: EncounterTemplate | null;
  grouped: Array<{ area: string; encounters: EncounterTemplate[] }>;
  monsters: ReadonlyMap<string, MonsterSpec>;
  onPick: (id: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside-click + ESC. Mirrors the SpritePicker pattern so
  // the two pickers feel consistent.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedSprite = selected ? leadSpriteFor(selected, monsters) : null;
  const selectedLabel = selected
    ? `${selected.name} (lvl ${selected.level})`
    : placeholder;

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="flex min-w-[280px] items-center gap-2 rounded border border-parchment/30 bg-ink/60 px-2 py-1 text-left text-sm text-parchment hover:border-parchment/60 disabled:opacity-50"
      >
        <div className="h-8 w-8 shrink-0 rounded border border-parchment/15 bg-ink/80">
          {selectedSprite ? (
            <img
              src={selectedSprite}
              alt=""
              width={32}
              height={32}
              style={{ imageRendering: "pixelated" }}
              className="h-full w-full object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility =
                  "hidden";
              }}
            />
          ) : null}
        </div>
        <span className="flex-1 truncate">{selectedLabel}</span>
        <span className="text-xs text-parchment/45" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 max-h-[420px] w-[420px] overflow-auto rounded border border-parchment/25 bg-ink/95 p-2 shadow-xl"
        >
          {grouped.map((g) => (
            <section key={g.area} className="mb-2 last:mb-0">
              <h3 className="mb-1 px-1 text-[10px] uppercase tracking-wide text-parchment/45">
                {g.area} · {g.encounters.length}
              </h3>
              <ul className="space-y-0.5">
                {g.encounters.map((e) => {
                  const isCurrent = selected?.id === e.id;
                  const sprite = leadSpriteFor(e, monsters);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onPick(e.id);
                          setOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs transition ${
                          isCurrent
                            ? "border-ember/60 bg-ember/20 text-parchment"
                            : "border-transparent text-parchment/85 hover:border-parchment/30 hover:bg-ink/60"
                        }`}
                      >
                        <div className="h-7 w-7 shrink-0 rounded border border-parchment/15 bg-ink/80">
                          {sprite ? (
                            <img
                              src={sprite}
                              alt=""
                              width={28}
                              height={28}
                              style={{ imageRendering: "pixelated" }}
                              className="h-full w-full object-contain"
                              onError={(ev) => {
                                (ev.currentTarget as HTMLImageElement).style.visibility =
                                  "hidden";
                              }}
                            />
                          ) : null}
                        </div>
                        <span className="min-w-0 flex-1 truncate">
                          {e.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-parchment/55">
                          lvl {e.level} · {e.monsters.length}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Render one 32×32 sprite per monster in the encounter, in roster
 * order. Duplicates stay (an encounter with two goblins shows two
 * goblin sprites) so the player gets a visual sense of how many
 * enemies are coming. Each thumbnail's title is the monster id +
 * display name, which doubles as a fallback when the sprite 404s.
 */
function MonsterRoster({
  monsterIds,
  monsters,
}: {
  monsterIds: ReadonlyArray<string>;
  monsters: ReadonlyMap<string, MonsterSpec>;
}) {
  if (monsterIds.length === 0) return null;
  return (
    <ul className="flex items-center gap-1">
      {monsterIds.map((id, i) => {
        const spec = monsters.get(id) ?? null;
        const src = spec?.sprite ?? null;
        const title = spec?.name ? `${spec.name} (${id})` : id;
        return (
          <li
            key={`${id}-${i}`}
            className="h-8 w-8 shrink-0 rounded border border-parchment/20 bg-ink/80"
            title={title}
          >
            {src ? (
              <img
                src={src}
                alt={title}
                width={32}
                height={32}
                style={{ imageRendering: "pixelated" }}
                className="h-full w-full object-contain"
                onError={(e) => {
                  // Sprite missing on disk — hide the broken-image
                  // glyph but keep the slot itself so the count of
                  // monsters in the encounter stays accurate.
                  (e.currentTarget as HTMLImageElement).style.visibility =
                    "hidden";
                }}
              />
            ) : (
              <span className="block truncate px-1 text-[9px] text-parchment/55">
                {id}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
