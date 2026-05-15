"use client";

/**
 * PartyScreen — reusable React port of v1's Party Inventory screen
 * (the one opened with the `P` key in the game). Two-pane layout:
 *
 *   ┌──────────────── PARTY ────────────────┐
 *   │ EFFECTS              │ PARTY [1-N]    │
 *   │ ▸ Detect Traps       │ ┌──┐ 1 Aldric  │
 *   │   Infravision REQ…   │ │  │ Fighter…  │
 *   │   Galadriel's Light  │ └──┘ HP ▓▓▓▓   │
 *   │ ──────               │ … per member   │
 *   │ CAST SPELL           │ ──────         │
 *   │ PICKPOCKET (race)    │ AVAILABLE      │
 *   │ ──────               │ EFFECT detail  │
 *   │ SHARED STASH (n)     │                │
 *   │   Torch (1)          │ GOLD: 50       │
 *   │   Rock (20)          │ STASH: 3       │
 *   ├──────────────────────┴────────────────┤
 *   │ [↑↓] select [Enter] action [1-N] char │
 *   └───────────────────────────────────────┘
 *
 * Scope intent — this is a PREVIEW component:
 *
 *   - Roster, stash, and gold are READ-ONLY. The component never
 *     mutates the Party record passed in.
 *   - The EFFECTS list IS interactive in the sense that the user can
 *     pick which available abilities are "active" for the preview
 *     (so encounter behavior or lighting checks could read off the
 *     set). Assignment state is held by the host as
 *     `activeEffectIds`; it's up to the host whether to persist it
 *     (today nobody does — the screen is showcase-only).
 *   - Effect availability is derived from the live roster: an ability
 *     is "available" iff some current member's class (with min_level
 *     met) or race grants it. Anything else shows REQ NOT MET.
 *
 * Reusable surface — same component will mount inside the Party editor
 * AND inside the Map editor's simulation mode (P key opens it as a
 * modal). Future game-side party screen can also mount it as the
 * non-keyboard fallback while the Phaser equivalent is built.
 */

import { useMemo, useState } from "react";
import {
  CharacterSheetSim,
  type SheetItemRef,
} from "./CharacterSheetSim";
import { resolveSpritePath } from "./spriteFields";

// ── Data shapes (loose by design — the host loads JSON, we render) ──

export interface PartyInventoryEntry {
  item: string;
  charges?: number;
  durability?: number;
}

export interface PartyRecord {
  gold?: number;
  roster?: string[];
  party_effects?: Record<string, string | null>;
  inventory?: PartyInventoryEntry[];
  torch_steps?: number;
  galadriels_light_steps?: number;
  [k: string]: unknown;
}

export interface PartyCharacterRef {
  id: string;
  name: string;
  class: string;
  race: string;
  gender?: string;
  level: number;
  exp?: number;
  hp: number;
  mp?: number;
  /** Ability scores. Default to 10 (the canonical "no modifier"
   *  value) when the source record omits them — keeps the sheet's
   *  stat math sane for partial drafts. */
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  /** Equipped slots — keyed by slot id ("hands", "body"). v2 uses
   *  Item ids; the sim resolves them against the items catalog. */
  equipped?: Record<string, string>;
  /** Personal-inventory bag carried by this character (separate from
   *  the party's shared stash). */
  inventory?: Array<Record<string, unknown>>;
  sprite?: string;
  [k: string]: unknown;
}

export interface PartyRaceRef {
  id: string;
  name?: string;
  abilities?: string[];
  exp_per_level?: number | null;
}

/** Class-abilities link in character_classes.json — the v2 schema
 *  uses `ability_id` (a foreign key into abilities.json) rather than
 *  a bare `id`. Keeping `id` as an optional fallback so legacy
 *  callers (e.g. a hand-built test fixture) don't have to migrate. */
export interface PartyClassAbilityRef {
  ability_id?: string;
  id?: string;
  min_level?: number;
}

export interface PartyClassRef {
  id: string;
  name?: string;
  abilities?: PartyClassAbilityRef[];
}

export interface PartyAbilityRef {
  id: string;
  name?: string;
  type?: "race" | "class" | "other" | string;
  description?: string;
  duration?: number | string | null;
}

export interface PartyItemRef {
  id: string;
  name?: string;
}

export interface PartySpellRef {
  id: string;
  name?: string;
}

const SPRITE_CONFIG = { category: "person", format: "path" } as const;

// ── Helpers ─────────────────────────────────────────────────────────

/** XP threshold to the NEXT level, falling back to the canonical
 *  human curve (1125). Mirrors v1's per-race override semantics. */
function xpForNextLevel(member: PartyCharacterRef, race?: PartyRaceRef): number {
  const base = race?.exp_per_level ?? 1500;
  return member.level * base;
}

/** Resolve the set of ability ids unlocked by `members`. An ability is
 *  unlocked when any active member has the granting class (with the
 *  ability's min_level met) or the granting race. */
function computeUnlockedAbilities(
  members: ReadonlyArray<PartyCharacterRef>,
  races: ReadonlyArray<PartyRaceRef>,
  classes: ReadonlyArray<PartyClassRef>,
): Set<string> {
  const raceById = new Map(races.map((r) => [r.id, r]));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const out = new Set<string>();
  for (const m of members) {
    const r = raceById.get(m.race);
    if (r?.abilities) for (const id of r.abilities) out.add(id);
    const k = classById.get(m.class);
    if (k?.abilities) {
      for (const a of k.abilities) {
        const abilityId = a.ability_id ?? a.id;
        if (!abilityId) continue;
        if ((a.min_level ?? 1) <= m.level) out.add(abilityId);
      }
    }
  }
  return out;
}

/** Pretty-print a duration value (number = turns, "permanent", etc.). */
function fmtDuration(d: number | string | null | undefined): string {
  if (d == null) return "—";
  if (typeof d === "number") {
    return `${d} ${d === 1 ? "turn" : "turns"}`;
  }
  return String(d);
}

/** Build a short "Requires: …" string for an ability — the union of
 *  races and class+minLevel combos that grant it. Powers the right-
 *  panel detail row + the REQ NOT MET hint. */
function requirementsFor(
  abilityId: string,
  races: ReadonlyArray<PartyRaceRef>,
  classes: ReadonlyArray<PartyClassRef>,
): string {
  const parts: string[] = [];
  for (const r of races) {
    if (r.abilities?.includes(abilityId)) {
      parts.push(r.name ?? r.id);
    }
  }
  for (const c of classes) {
    const a = c.abilities?.find(
      (x) => (x.ability_id ?? x.id) === abilityId,
    );
    if (a) {
      const lvl = a.min_level ?? 1;
      parts.push(`${c.name ?? c.id}${lvl > 1 ? ` (Lv ${lvl}+)` : ""}`);
    }
  }
  return parts.length === 0 ? "—" : parts.join(" or ");
}

// ── Row types for the left list ─────────────────────────────────────

type EffectRow = {
  kind: "effect";
  ability: PartyAbilityRef;
  /** True when at least one party member unlocks this ability. */
  available: boolean;
  /** True when the host has flagged it active in the preview set. */
  active: boolean;
};

type ActionRow =
  | { kind: "cast"; label: "CAST SPELL"; hint: string; enabled: boolean }
  | { kind: "pickpocket"; label: "PICKPOCKET"; hint: string; enabled: boolean }
  | { kind: "tinker"; label: "TINKER"; hint: string; enabled: boolean }
  | { kind: "brew"; label: "BREW POTION"; hint: string; enabled: boolean };

// ── Component ───────────────────────────────────────────────────────

export function PartyScreen({
  party,
  characters,
  races,
  classes,
  abilities,
  items,
  spells = [],
  activeEffectIds,
  onActiveEffectsChange,
}: {
  party: PartyRecord;
  /** Full character records for the party's roster ids. Missing ids
   *  are skipped — they render as gaps in the roster pane. */
  characters: ReadonlyArray<PartyCharacterRef>;
  races: ReadonlyArray<PartyRaceRef>;
  classes: ReadonlyArray<PartyClassRef>;
  abilities: ReadonlyArray<PartyAbilityRef>;
  items: ReadonlyArray<PartyItemRef>;
  /** Optional spell catalog — only used to enable/disable the CAST
   *  SPELL row's hint. The screen doesn't render the spell list yet
   *  (a future pass when targeting is wired up). */
  spells?: ReadonlyArray<PartySpellRef>;
  /** Which optional abilities are currently flagged as "active" for
   *  preview. The host owns this; the screen toggles via the
   *  onActiveEffectsChange callback. Passing an empty array shows
   *  nothing selected. */
  activeEffectIds: ReadonlyArray<string>;
  onActiveEffectsChange: (ids: ReadonlyArray<string>) => void;
}) {
  // ── Resolve roster ──────────────────────────────────────────────
  const members = useMemo(() => {
    const byId = new Map(characters.map((c) => [c.id, c]));
    return (party.roster ?? [])
      .map((id) => byId.get(id))
      .filter((m): m is PartyCharacterRef => Boolean(m));
  }, [party.roster, characters]);

  const raceById = useMemo(
    () => new Map(races.map((r) => [r.id, r])),
    [races],
  );
  const classById = useMemo(
    () => new Map(classes.map((c) => [c.id, c])),
    [classes],
  );
  const itemNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) m.set(it.id, it.name ?? it.id);
    return m;
  }, [items]);

  const unlocked = useMemo(
    () => computeUnlockedAbilities(members, races, classes),
    [members, races, classes],
  );

  // ── Build the EFFECTS list (race + class abilities only) ─────────
  const effectRows: EffectRow[] = useMemo(() => {
    const togglable = abilities.filter(
      (a) => a.type === "race" || a.type === "class",
    );
    return togglable.map((a) => ({
      kind: "effect" as const,
      ability: a,
      available: unlocked.has(a.id),
      active: activeEffectIds.includes(a.id),
    }));
  }, [abilities, unlocked, activeEffectIds]);

  // ── Build the conditional ACTION rows below the effects ──────────
  const hasRace = (raceId: string) => members.some((m) => m.race === raceId);
  const hasClass = (classId: string) =>
    members.some((m) => m.class === classId);
  const actionRows: ActionRow[] = useMemo(() => {
    const rows: ActionRow[] = [
      {
        kind: "cast",
        label: "CAST SPELL",
        hint: spells.length > 0 ? `${spells.length} known` : "no spells",
        enabled: spells.length > 0,
      },
    ];
    if (hasClass("alchemist")) {
      rows.push({
        kind: "brew",
        label: "BREW POTION",
        hint: "Alchemist",
        enabled: true,
      });
    }
    if (hasRace("halfling")) {
      rows.push({
        kind: "pickpocket",
        label: "PICKPOCKET",
        hint: "Halfling",
        enabled: true,
      });
    }
    if (hasRace("gnome")) {
      rows.push({
        kind: "tinker",
        label: "TINKER",
        hint: "Gnome",
        enabled: true,
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, spells.length]);

  // ── Selection state — which left-list row is highlighted ─────────
  // Default to the first available effect so the right pane shows
  // something useful on first render.
  const initialSelectedId = useMemo(() => {
    const firstAvail = effectRows.find((r) => r.available);
    return firstAvail?.ability.id ?? effectRows[0]?.ability.id ?? null;
  }, [effectRows]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  /** Drill-in: when set, the screen swaps its body for a
   *  CharacterSheetSim of this member. Clicking a roster card sets it;
   *  the sheet's Back button clears it. */
  const [focusedMemberId, setFocusedMemberId] = useState<string | null>(null);
  const focusedMember = focusedMemberId
    ? members.find((m) => m.id === focusedMemberId) ?? null
    : null;

  // Resync selection when the underlying list changes (e.g., roster
  // edit added a Halfling and unlocked Pickpocket).
  const selectedRow = effectRows.find((r) => r.ability.id === selectedId);

  // ── Toggle helper for the "active" preview set ───────────────────
  const toggleActive = (abilityId: string, available: boolean) => {
    if (!available) return;
    const present = activeEffectIds.includes(abilityId);
    if (present) {
      onActiveEffectsChange(activeEffectIds.filter((x) => x !== abilityId));
    } else {
      onActiveEffectsChange([...activeEffectIds, abilityId]);
    }
  };

  // ── Render ───────────────────────────────────────────────────────

  // Drill-in: focused member → CharacterSheetSim. The Back button on
  // the sheet clears the focus. The Party screen's own outer
  // container is preserved so the modal / inline host doesn't
  // re-layout when the body swaps.
  if (focusedMember) {
    return (
      <CharacterSheetSim
        character={focusedMember}
        classes={classes}
        races={races}
        // PartyItemRef ⊂ SheetItemRef; PartyScreen's items prop is the
        // narrow ref, but real callers pass the full item records which
        // carry power/evasion/etc. Cast through to surface those fields
        // to the sheet without forcing every host to import SheetItemRef.
        items={items as ReadonlyArray<SheetItemRef>}
        onBack={() => setFocusedMemberId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-parchment/15 bg-ink/40 p-3 text-parchment/90">
      {/* Title */}
      <div className="border-b border-parchment/15 pb-1 text-center font-display text-lg uppercase tracking-[0.3em] text-amber-300">
        Party
      </div>

      {/* Two-pane body */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Left: effects + actions + stash */}
        <div className="space-y-2">
          {/* EFFECTS list */}
          <section>
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Effects
            </h3>
            <ul className="mt-1 space-y-0.5">
              {effectRows.length === 0 ? (
                <li className="text-xs text-parchment/50">(no abilities)</li>
              ) : null}
              {effectRows.map((row) => {
                const isSel = row.ability.id === selectedId;
                return (
                  <li key={row.ability.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.ability.id)}
                      onDoubleClick={() =>
                        toggleActive(row.ability.id, row.available)
                      }
                      className={[
                        "flex w-full items-center justify-between gap-2 rounded border px-2 py-0.5 text-left text-sm",
                        isSel
                          ? "border-ember/60 bg-ember/15"
                          : "border-transparent hover:bg-ink/50",
                        row.available
                          ? "text-parchment/90"
                          : "text-parchment/40",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-2">
                        {row.active ? (
                          <span className="text-amber-300">●</span>
                        ) : row.available ? (
                          <span className="text-parchment/40">○</span>
                        ) : (
                          <span className="text-parchment/30">×</span>
                        )}
                        <span>{row.ability.name ?? row.ability.id}</span>
                      </span>
                      {!row.available ? (
                        <span className="text-[10px] uppercase tracking-wider text-parchment/40">
                          REQ NOT MET
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Actions — CAST SPELL + conditional rows */}
          <section>
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Actions
            </h3>
            <ul className="mt-1 space-y-0.5">
              {actionRows.map((row) => (
                <li
                  key={row.kind}
                  className={[
                    "flex items-center justify-between gap-2 rounded px-2 py-0.5 text-sm",
                    row.enabled
                      ? "text-parchment/85"
                      : "text-parchment/40",
                  ].join(" ")}
                >
                  <span>{row.label}</span>
                  <span className="text-[11px] text-parchment/55">
                    {row.hint}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* SHARED STASH */}
          <section>
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Shared Stash{" "}
              <span className="text-parchment/45">
                ({party.inventory?.length ?? 0} items)
              </span>
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm">
              {(party.inventory ?? []).length === 0 ? (
                <li className="text-xs text-parchment/45">(empty)</li>
              ) : null}
              {(party.inventory ?? []).map((entry, i) => {
                const label =
                  itemNameById.get(entry.item) ?? entry.item;
                return (
                  <li
                    key={`${entry.item}-${i}`}
                    className="flex items-center justify-between px-2 py-0.5 text-parchment/85"
                  >
                    <span>{label}</span>
                    <span className="text-xs text-parchment/55">
                      {entry.charges != null ? `(${entry.charges})` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* Right: roster + detail + gold */}
        <div className="space-y-2">
          {/* Roster */}
          <section>
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Party [1-{members.length}]
            </h3>
            <ul className="mt-1 space-y-1">
              {members.length === 0 ? (
                <li className="text-xs text-parchment/50">
                  (no roster — check party.json)
                </li>
              ) : null}
              {members.map((m, i) => (
                <RosterCard
                  key={m.id}
                  member={m}
                  slotNumber={i + 1}
                  className_={classById.get(m.class)?.name ?? m.class}
                  raceName={raceById.get(m.race)?.name ?? m.race}
                  xpNext={xpForNextLevel(m, raceById.get(m.race))}
                  onOpen={() => setFocusedMemberId(m.id)}
                />
              ))}
            </ul>
          </section>

          {/* AVAILABLE EFFECT — detail of the selected row */}
          <section className="rounded border border-parchment/15 bg-ink/30 p-2">
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Available Effect
            </h3>
            {selectedRow ? (
              <div className="mt-1 space-y-1 text-sm">
                <div className="font-display text-parchment">
                  {selectedRow.ability.name ?? selectedRow.ability.id}
                </div>
                <p className="text-xs text-parchment/75">
                  {selectedRow.ability.description ?? "(no description)"}
                </p>
                <div className="text-[11px] text-parchment/55">
                  Duration: {fmtDuration(selectedRow.ability.duration)}
                </div>
                <div className="text-[11px] text-parchment/55">
                  Requires:{" "}
                  {requirementsFor(
                    selectedRow.ability.id,
                    races,
                    classes,
                  )}
                </div>
                {selectedRow.available ? (
                  <button
                    type="button"
                    onClick={() =>
                      toggleActive(selectedRow.ability.id, true)
                    }
                    className="mt-1 rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-xs text-parchment hover:bg-ember/50"
                  >
                    {selectedRow.active
                      ? "Remove from active"
                      : "Add to active"}
                  </button>
                ) : (
                  <p className="mt-1 text-[11px] text-ember/70">
                    No qualifying party member.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-parchment/45">
                Select an effect on the left to see its details.
              </p>
            )}
          </section>

          {/* Gold + stash totals */}
          <section className="flex items-center justify-between rounded border border-parchment/15 bg-ink/30 px-2 py-1 text-sm">
            <span className="text-amber-300">GOLD: {party.gold ?? 0}</span>
            <span className="text-parchment/55">
              STASH: {party.inventory?.length ?? 0}
            </span>
          </section>
        </div>
      </div>

      {/* Bottom hint bar (purely cosmetic — keys aren't wired in this
          preview pass; click to select, double-click to toggle). */}
      <div className="border-t border-parchment/15 pt-1 text-center font-mono text-[10px] uppercase tracking-wider text-parchment/45">
        Click to select · Double-click to toggle active · ESC to close
      </div>
    </div>
  );
}

// ── Roster card ────────────────────────────────────────────────────

function RosterCard({
  member,
  slotNumber,
  className_,
  raceName,
  xpNext,
  onOpen,
}: {
  member: PartyCharacterRef;
  slotNumber: number;
  className_: string;
  raceName: string;
  xpNext: number;
  /** When provided, the whole card becomes a button that drills into
   *  the CharacterSheetSim for this member. The Party screen passes
   *  this; standalone uses can omit it. */
  onOpen?: () => void;
}) {
  const thumb = member.sprite
    ? resolveSpritePath(member.sprite, SPRITE_CONFIG)
    : null;
  const hp = member.hp ?? 0;
  const mp = member.mp ?? 0;
  const exp = member.exp ?? 0;
  // Treat the source hp/mp as both current and max for the preview —
  // characters.json doesn't carry "current" state separately yet.
  return (
    <li
      className={[
        "flex items-start gap-2 rounded border border-parchment/10 bg-ink/30 p-2",
        onOpen
          ? "cursor-pointer hover:border-amber-300/40 hover:bg-ink/50"
          : "",
      ].join(" ")}
      onClick={onOpen}
      title={onOpen ? `Open ${member.name}'s sheet` : undefined}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          width={32}
          height={32}
          style={{ imageRendering: "pixelated" }}
          className="h-8 w-8 shrink-0 rounded border border-parchment/20 bg-ink/80 object-contain"
        />
      ) : (
        <span className="h-8 w-8 shrink-0 rounded border border-parchment/20 bg-ink/80" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="text-amber-300">{slotNumber}</span>
          <span className="font-display text-parchment">{member.name}</span>
        </div>
        <div className="text-[11px] text-parchment/70">
          {className_} · {raceName}
          {member.gender ? ` · ${member.gender}` : ""}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[10px] text-parchment/65">
          <Bar
            label="HP"
            value={hp}
            max={hp || 1}
            color="bg-emerald-600/70"
          />
          <Bar
            label="MP"
            value={mp}
            max={mp || 1}
            color="bg-sky-600/70"
            empty={mp === 0}
          />
          <Bar
            label="XP"
            value={exp}
            max={xpNext}
            color="bg-amber-400/60"
          />
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-parchment/50">
          LVL {member.level} · HP {hp}/{hp} · MP {mp}/{mp} · XP {exp}/{xpNext}
        </div>
      </div>
    </li>
  );
}

function Bar({
  label,
  value,
  max,
  color,
  empty,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  empty?: boolean;
}) {
  const pct = empty ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex flex-col">
      <span className="text-parchment/45">{label}</span>
      <span className="h-1.5 w-full overflow-hidden rounded bg-ink/70">
        <span
          className={`block h-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
