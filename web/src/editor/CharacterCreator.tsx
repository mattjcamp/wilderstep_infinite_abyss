"use client";

/**
 * CharacterCreator — a 6-step character-creation wizard, ported from
 * v1's `web/app/party/new/page.tsx`. Six steps:
 *
 *   1. Name           — text input
 *   2. Race + Gender  — race grid with stat-mod preview + lore card,
 *                       gender toggle
 *   3. Class          — class grid filtered by race-class gate
 *                       (Wizard only for magic-attuned races) + lore
 *   4. Sprite         — pick a person sprite from /sprites/person/
 *   5. Stats          — every attribute starts at the floor (8) and
 *                       the player distributes 15 bonus points up to
 *                       a per-stat ceiling of 18. Racial mods add on
 *                       top at runtime. Maxing one stat costs 10 of
 *                       the 15, forcing a real build trade-off.
 *   6. Confirm        — review + commit
 *
 * The component is self-contained: the host hands it the existing
 * id pool plus the races / classes / abilities catalogs (read from
 * whichever module's data is current), and the wizard hands back a
 * complete CharacterRecord on `onComplete`. Same component will be
 * reused by the future game-side character creator — the host just
 * persists the result differently (editor saves into the module's
 * characters.json draft; game appends to the runtime roster).
 */

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/util/basePath";
import {
  makeBlankCharacter,
  type CharacterRecord,
} from "./CharacterSheet";

// ── Tunable creator rules (mirror v1 — see header comment above) ───

/** Floor for every attribute — also the starting value, so the
 *  player allocates the full BONUS_POINTS pool from a clean slate. */
const STAT_MIN = 8;
/** Per-stat ceiling. */
const STAT_MAX = 18;
/** Bonus points the player has to allocate above the floor. Tight on
 *  purpose: maxing one stat costs 10 of these 15, so the player can't
 *  max both their primary AND a secondary — every build accepts a
 *  real weakness. */
const BONUS_POINTS = 15;
/** Total points across all five stats when the build is complete. */
const POINTS_TOTAL = STAT_MIN * 5 + BONUS_POINTS;

type StatKey =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom";
const STAT_KEYS: StatKey[] = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
];
const STAT_LABELS: Record<StatKey, string> = {
  strength: "STR",
  dexterity: "DEX",
  constitution: "CON",
  intelligence: "INT",
  wisdom: "WIS",
};

const GENDERS = ["Male", "Female"] as const;
type Gender = (typeof GENDERS)[number];

/** Wizards are restricted to magic-attuned races in v1; everyone else
 *  is open to all five races. v2's data doesn't model race-class gates
 *  yet, so this lives as a constant for now. Re-introduce a Race
 *  `allowed_classes` field when the gating semantics are settled. */
const WIZARD_RACES: ReadonlySet<string> = new Set([
  "human",
  "elf",
  "gnome",
]);

/** Per-class starting HP at level 1. Mirrors v1's `hp_per_level` from
 *  `data/classes/*.json`. v2 doesn't model HP per level yet (pruned
 *  during the class slim-down); when it returns, this table moves
 *  into character_classes.json and we read from there instead. */
const CLASS_HP: Record<string, number> = {
  fighter: 15,
  paladin: 12,
  ranger: 10,
  thief: 8,
  cleric: 8,
  druid: 8,
  alchemist: 6,
  wizard: 6,
};

/** Per-class starting MP at level 1. Non-caster classes are 0; the
 *  caller leaves their `mp`/`maxMp` at 0. */
const CLASS_MP: Record<string, number> = {
  fighter: 0,
  paladin: 5,
  ranger: 3,
  thief: 0,
  cleric: 10,
  druid: 8,
  alchemist: 8,
  wizard: 15,
};

/** Casting stat for each class — used to seed MP at creation. Druid
 *  averages INT + WIS (the only multi-stat class). */
const CLASS_MP_STAT: Record<string, StatKey | "druid_avg" | null> = {
  fighter: null,
  paladin: "wisdom",
  ranger: "wisdom",
  thief: null,
  cleric: "wisdom",
  druid: "druid_avg",
  alchemist: "intelligence",
  wizard: "intelligence",
};

// ── Types ─────────────────────────────────────────────────────────

export interface RaceRecord {
  id: string;
  name?: string;
  description?: string;
  stat_modifiers?: Partial<Record<StatKey, number>>;
  abilities?: string[];
}

export interface ClassRecord {
  id: string;
  name?: string;
  description?: string;
  abilities?: Array<{ ability_id: string; min_level?: number }>;
  /** Spell catalogs this class can draw from — `"sorcerer"`,
   *  `"priest"`, or `"none"`. Used by the character sheet's Spells
   *  section to filter castable spells. */
  casting_type?: string[];
}

export interface AbilityRecord {
  id: string;
  name?: string;
  description?: string;
  type?: string;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

// ── Helpers ───────────────────────────────────────────────────────

function statMod(value: number): number {
  return Math.floor((value - 10) / 2);
}

function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function startingMpFor(
  classId: string,
  effStats: Record<StatKey, number>,
): number {
  const perLevel = CLASS_MP[classId] ?? 0;
  if (perLevel <= 0) return 0;
  let mod = 0;
  const stat = CLASS_MP_STAT[classId];
  if (stat === "druid_avg") {
    const avg = Math.floor(
      (effStats.intelligence + effStats.wisdom) / 2,
    );
    mod = statMod(avg);
  } else if (stat) {
    mod = statMod(effStats[stat]);
  }
  return Math.max(0, perLevel + mod);
}

// ── Component ─────────────────────────────────────────────────────

export function CharacterCreator({
  existingIds,
  races,
  classes,
  abilities,
  onComplete,
  onCancel,
}: {
  existingIds: Set<string>;
  races: RaceRecord[];
  classes: ClassRecord[];
  abilities: AbilityRecord[];
  onComplete: (character: CharacterRecord) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [raceId, setRaceId] = useState<string>(races[0]?.id ?? "human");
  const [gender, setGender] = useState<Gender>("Male");
  const [classId, setClassId] = useState<string>(classes[0]?.id ?? "fighter");
  const [sprite, setSprite] = useState<string>("");
  const [spriteTouched, setSpriteTouched] = useState(false);
  const [stats, setStats] = useState<Record<StatKey, number>>(() => ({
    strength: STAT_MIN,
    dexterity: STAT_MIN,
    constitution: STAT_MIN,
    intelligence: STAT_MIN,
    wisdom: STAT_MIN,
  }));
  const [error, setError] = useState<string | null>(null);

  // Snap class to a valid choice when race changes. Only Wizard has a
  // race restriction today, so this almost never fires — but cheap.
  useEffect(() => {
    if (!isClassAllowedForRace(classId, raceId)) {
      const firstValid = classes.find((c) =>
        isClassAllowedForRace(c.id, raceId),
      );
      if (firstValid) setClassId(firstValid.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  // Suggest a class-matching sprite when class changes, unless the
  // player has explicitly chosen one.
  useEffect(() => {
    if (!spriteTouched) {
      setSprite(defaultSpriteFor(classId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const abilitiesById = useMemo(
    () => new Map(abilities.map((a) => [a.id, a])),
    [abilities],
  );
  const raceById = useMemo(
    () => new Map(races.map((r) => [r.id, r])),
    [races],
  );
  const classById = useMemo(
    () => new Map(classes.map((c) => [c.id, c])),
    [classes],
  );

  const pointsSpent = useMemo(
    () => STAT_KEYS.reduce((sum, k) => sum + stats[k], 0),
    [stats],
  );
  const pointsLeft = POINTS_TOTAL - pointsSpent;

  const adjust = (stat: StatKey, delta: number): void => {
    const nextVal = stats[stat] + delta;
    if (nextVal < STAT_MIN || nextVal > STAT_MAX) return;
    if (delta > 0 && pointsLeft < delta) return;
    setStats({ ...stats, [stat]: nextVal });
    setError(null);
  };

  const onNext = (): void => {
    if (step === 1) {
      const trimmed = name.trim();
      if (!trimmed) {
        setError("Enter a name.");
        return;
      }
      const id = slugify(trimmed);
      if (existingIds.has(id)) {
        setError(`A character with id "${id}" already exists.`);
        return;
      }
    }
    if (step === 5 && pointsLeft !== 0) {
      setError(
        `Distribute all ${BONUS_POINTS} bonus points (${
          BONUS_POINTS - pointsLeft
        } of ${BONUS_POINTS} so far).`,
      );
      return;
    }
    setError(null);
    setStep((s) => (s < 6 ? ((s + 1) as Step) : s));
  };

  const onBack = (): void => {
    setError(null);
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  };

  const onFinalize = (): void => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStep(1);
      setError("Enter a name.");
      return;
    }
    if (pointsLeft !== 0) {
      setStep(5);
      setError(
        `Distribute all ${BONUS_POINTS} bonus points first.`,
      );
      return;
    }
    const race = raceById.get(raceId);
    const mods = (race?.stat_modifiers ?? {}) as Record<StatKey, number>;
    const eff = {
      strength: stats.strength + (mods.strength ?? 0),
      dexterity: stats.dexterity + (mods.dexterity ?? 0),
      constitution: stats.constitution + (mods.constitution ?? 0),
      intelligence: stats.intelligence + (mods.intelligence ?? 0),
      wisdom: stats.wisdom + (mods.wisdom ?? 0),
    };
    const hp = Math.max(
      1,
      (CLASS_HP[classId] ?? 10) + statMod(eff.constitution),
    );
    const mp = startingMpFor(classId, eff);
    const id = slugify(trimmedName);
    const blank = makeBlankCharacter(id, trimmedName);
    const character: CharacterRecord = {
      ...blank,
      class: classId,
      race: raceId,
      gender,
      level: 1,
      exp: 0,
      hp,
      mp,
      strength: eff.strength,
      dexterity: eff.dexterity,
      constitution: eff.constitution,
      intelligence: eff.intelligence,
      wisdom: eff.wisdom,
      sprite,
    };
    onComplete(character);
  };

  // Which classes are valid for the currently-selected race?
  const allowedClassIds = useMemo(
    () =>
      new Set(
        classes
          .filter((c) => isClassAllowedForRace(c.id, raceId))
          .map((c) => c.id),
      ),
    [classes, raceId],
  );

  return (
    <div className="rounded-md border border-parchment/15 bg-ink/30 p-6">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-parchment/75 hover:text-parchment/90"
        >
          ← Cancel
        </button>
        <h2 className="font-display text-2xl text-parchment">
          New Character — Step {step} of 6
        </h2>
        <span className="w-16" />
      </header>

      {step === 1 ? (
        <Step1Name
          name={name}
          onNameChange={(v) => {
            setName(v);
            setError(null);
          }}
        />
      ) : null}

      {step === 2 ? (
        <Step2RaceGender
          races={races}
          raceId={raceId}
          onRaceChange={setRaceId}
          gender={gender}
          onGenderChange={setGender}
          abilitiesById={abilitiesById}
        />
      ) : null}

      {step === 3 ? (
        <Step3Class
          classes={classes}
          classId={classId}
          onClassChange={setClassId}
          allowedClassIds={allowedClassIds}
          abilitiesById={abilitiesById}
          raceById={raceById}
          raceId={raceId}
        />
      ) : null}

      {step === 4 ? (
        <Step4Sprite
          sprite={sprite}
          onSpriteChange={(v) => {
            setSprite(v);
            setSpriteTouched(true);
          }}
        />
      ) : null}

      {step === 5 ? (
        <Step5Stats
          stats={stats}
          raceMods={
            (raceById.get(raceId)?.stat_modifiers ?? {}) as Partial<
              Record<StatKey, number>
            >
          }
          pointsLeft={pointsLeft}
          onAdjust={adjust}
        />
      ) : null}

      {step === 6 ? (
        <Step6Confirm
          name={name}
          raceId={raceId}
          gender={gender}
          classId={classId}
          sprite={sprite}
          stats={stats}
          raceById={raceById}
          classById={classById}
          startingHp={Math.max(
            1,
            (CLASS_HP[classId] ?? 10) +
              statMod(
                stats.constitution +
                  ((raceById.get(raceId)?.stat_modifiers?.constitution ??
                    0) as number),
              ),
          )}
          startingMp={startingMpFor(
            classId,
            applyMods(stats, raceById.get(raceId)?.stat_modifiers),
          )}
        />
      ) : null}

      {error ? (
        <p className="mt-4 rounded border border-ember/40 bg-ember/15 p-2 text-sm text-ember/90">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center justify-between">
        {step > 1 ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
          >
            ← Back
          </button>
        ) : (
          <span />
        )}
        {step < 6 ? (
          <button
            type="button"
            onClick={onNext}
            className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={onFinalize}
            className="rounded border border-ember/60 bg-ember/40 px-3 py-1 text-sm text-parchment hover:bg-ember/60"
          >
            Create Character
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 1: Name ───────────────────────────────────────────────────

function Step1Name({
  name,
  onNameChange,
}: {
  name: string;
  onNameChange: (v: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] uppercase tracking-wide text-parchment/75">
        Name
      </h3>
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Aldric"
        autoFocus
        className="w-full rounded border border-parchment/20 bg-ink/50 px-3 py-2 text-lg text-parchment/95 placeholder:text-parchment/60 focus:border-parchment/60 focus:outline-none"
      />
      <p className="mt-2 text-[13px] text-parchment/65">
        The id is derived from the name (snake_case, e.g. "Aldric Bren" →{" "}
        <code>aldric_bren</code>). You can rename later in the
        character sheet.
      </p>
    </section>
  );
}

// ── Step 2: Race + Gender ──────────────────────────────────────────

function Step2RaceGender({
  races,
  raceId,
  onRaceChange,
  gender,
  onGenderChange,
  abilitiesById,
}: {
  races: RaceRecord[];
  raceId: string;
  onRaceChange: (id: string) => void;
  gender: Gender;
  onGenderChange: (g: Gender) => void;
  abilitiesById: Map<string, AbilityRecord>;
}) {
  const selected = races.find((r) => r.id === raceId);
  return (
    <section className="space-y-5">
      <div>
        <h3 className="mb-2 text-[13px] uppercase tracking-wide text-parchment/75">
          Race
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {races.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onRaceChange(r.id)}
              className={`rounded border px-3 py-2 text-sm transition ${
                r.id === raceId
                  ? "border-ember/60 bg-ember/20 text-parchment"
                  : "border-parchment/20 bg-ink/40 text-parchment/85 hover:border-parchment/40 hover:bg-ink/60"
              }`}
            >
              {r.name ?? r.id}
            </button>
          ))}
        </div>
        {/* Stat-mod preview row */}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {races.map((r) => (
            <div
              key={`${r.id}-mods`}
              className={`rounded border px-2 py-1 text-center text-xs ${
                r.id === raceId
                  ? "border-parchment/15 bg-ink/40 text-parchment/75"
                  : "border-parchment/10 bg-ink/30 text-parchment/60"
              }`}
            >
              <div className="font-mono text-sm leading-tight">
                {fmtModsLine(r.stat_modifiers)}
              </div>
              <div className="mt-0.5 uppercase tracking-wide text-parchment/60">
                STR · DEX · CON · INT · WIS
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected ? (
        <RaceLoreCard race={selected} abilitiesById={abilitiesById} />
      ) : null}

      <div>
        <h3 className="mb-2 text-[13px] uppercase tracking-wide text-parchment/75">
          Gender
        </h3>
        <div className="flex gap-2">
          {GENDERS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGenderChange(g)}
              className={`rounded border px-4 py-2 text-sm transition ${
                gender === g
                  ? "border-ember/60 bg-ember/20 text-parchment"
                  : "border-parchment/20 bg-ink/40 text-parchment/85 hover:border-parchment/40 hover:bg-ink/60"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function RaceLoreCard({
  race,
  abilitiesById,
}: {
  race: RaceRecord;
  abilitiesById: Map<string, AbilityRecord>;
}) {
  const abilityId = race.abilities?.[0];
  const ability = abilityId ? abilitiesById.get(abilityId) : undefined;
  return (
    <div className="rounded border border-parchment/15 bg-ink/40 p-3">
      <h4 className="font-display text-lg text-parchment">
        {race.name ?? race.id}
      </h4>
      {race.description ? (
        <p className="mt-1 italic text-parchment/85">{race.description}</p>
      ) : null}
      {ability ? (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-parchment/65">
            Innate Ability
          </p>
          <p className="mt-1 text-sm text-parchment/85">
            <span className="font-display text-ember">
              {ability.name ?? ability.id}
            </span>
            {ability.description ? (
              <span className="text-parchment/75"> — {ability.description}</span>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ── Step 3: Class ──────────────────────────────────────────────────

function Step3Class({
  classes,
  classId,
  onClassChange,
  allowedClassIds,
  abilitiesById,
  raceById,
  raceId,
}: {
  classes: ClassRecord[];
  classId: string;
  onClassChange: (id: string) => void;
  allowedClassIds: Set<string>;
  abilitiesById: Map<string, AbilityRecord>;
  raceById: Map<string, RaceRecord>;
  raceId: string;
}) {
  const selected = classes.find((c) => c.id === classId);
  const raceName = raceById.get(raceId)?.name ?? raceId;
  return (
    <section className="space-y-5">
      <div>
        <h3 className="mb-2 text-[13px] uppercase tracking-wide text-parchment/75">
          Class
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {classes.map((c) => {
            const allowed = allowedClassIds.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={!allowed}
                onClick={() => onClassChange(c.id)}
                title={
                  allowed
                    ? undefined
                    : `${c.name ?? c.id} isn't open to ${raceName}.`
                }
                className={`rounded border px-3 py-2 text-sm transition ${
                  c.id === classId
                    ? "border-ember/60 bg-ember/20 text-parchment"
                    : !allowed
                      ? "cursor-not-allowed border-parchment/10 bg-ink/30 text-parchment/50"
                      : "border-parchment/20 bg-ink/40 text-parchment/85 hover:border-parchment/40 hover:bg-ink/60"
                }`}
              >
                {c.name ?? c.id}
              </button>
            );
          })}
        </div>
      </div>
      {selected ? (
        <ClassLoreCard klass={selected} abilitiesById={abilitiesById} />
      ) : null}
    </section>
  );
}

function ClassLoreCard({
  klass,
  abilitiesById,
}: {
  klass: ClassRecord;
  abilitiesById: Map<string, AbilityRecord>;
}) {
  return (
    <div className="rounded border border-parchment/15 bg-ink/40 p-3">
      <h4 className="font-display text-lg text-parchment">
        {klass.name ?? klass.id}
      </h4>
      {klass.description ? (
        <p className="mt-1 italic text-parchment/85">{klass.description}</p>
      ) : null}
      {(klass.abilities ?? []).length > 0 ? (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-parchment/65">
            Class Abilities
          </p>
          <ul className="mt-1 space-y-1">
            {(klass.abilities ?? []).map((link) => {
              const ab = abilitiesById.get(link.ability_id);
              return (
                <li key={link.ability_id} className="text-sm text-parchment/85">
                  <span className="font-display text-ember">
                    {ab?.name ?? link.ability_id}
                  </span>
                  {link.min_level && link.min_level > 1 ? (
                    <span className="ml-1 text-[13px] text-parchment/75">
                      (Level {link.min_level}+)
                    </span>
                  ) : null}
                  {ab?.description ? (
                    <span className="text-parchment/75">
                      {" — "}
                      {ab.description}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-xs text-parchment/65">
          No class abilities — this class earns its keep through stats
          and equipment alone.
        </p>
      )}
    </div>
  );
}

// ── Step 4: Sprite ────────────────────────────────────────────────

interface SpriteIndex {
  categories: Record<string, string[]>;
}

function Step4Sprite({
  sprite,
  onSpriteChange,
}: {
  sprite: string;
  onSpriteChange: (path: string) => void;
}) {
  const [index, setIndex] = useState<SpriteIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(withBasePath("/sprites/index.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SpriteIndex>;
      })
      .then((idx) => setIndex(idx))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  const personSprites = useMemo(() => {
    const files = index?.categories?.person ?? [];
    return files.map((file) => ({
      file,
      path: `person/${file}`,
      stem: file.replace(/\.[a-z]+$/i, ""),
    }));
  }, [index]);

  return (
    <section>
      <h3 className="mb-2 text-[13px] uppercase tracking-wide text-parchment/75">
        Sprite
      </h3>
      {error ? (
        <p className="text-sm text-ember/80">
          Failed to load sprite index: {error}
        </p>
      ) : !index ? (
        <p className="text-sm text-parchment/75">Loading sprites…</p>
      ) : (
        <div className="max-h-96 overflow-auto rounded border border-parchment/15 bg-ink/30 p-3">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
            {personSprites.map((s) => {
              const selected = s.path === sprite;
              return (
                <li key={s.path}>
                  <button
                    type="button"
                    onClick={() => onSpriteChange(s.path)}
                    title={s.path}
                    className={`flex w-full flex-col items-center gap-1 rounded border p-2 transition ${
                      selected
                        ? "border-ember/60 bg-ember/15"
                        : "border-parchment/10 bg-ink/40 hover:border-parchment/40 hover:bg-ink/60"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={withBasePath(`/sprites/${s.path}`)}
                      alt={s.stem}
                      width={48}
                      height={48}
                      style={{ imageRendering: "pixelated" }}
                      className="h-12 w-12 object-contain"
                    />
                    <span className="w-full truncate text-xs text-parchment/80">
                      {s.stem}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {sprite ? (
        <p className="mt-2 text-[13px] text-parchment/75">
          Selected: <code className="font-mono">{sprite}</code>
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-parchment/65">
          Pick a sprite for your character (you can change it later).
        </p>
      )}
    </section>
  );
}

// ── Step 5: Stats ─────────────────────────────────────────────────

function Step5Stats({
  stats,
  raceMods,
  pointsLeft,
  onAdjust,
}: {
  stats: Record<StatKey, number>;
  raceMods: Partial<Record<StatKey, number>>;
  pointsLeft: number;
  onAdjust: (stat: StatKey, delta: number) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] uppercase tracking-wide text-parchment/75">
        Distribute Stats
      </h3>
      <p className="mb-3 text-sm text-parchment/75">
        Every attribute starts at <strong>{STAT_MIN}</strong>. You have{" "}
        <strong>{BONUS_POINTS}</strong> bonus points to distribute (max{" "}
        <strong>{STAT_MAX}</strong> per stat). Racial modifiers apply on
        top.
      </p>
      <p className="mb-4 text-sm">
        Points remaining:{" "}
        <span
          className={`font-mono text-lg ${
            pointsLeft === 0
              ? "text-parchment/95"
              : pointsLeft < 0
                ? "text-ember"
                : "text-ember/90"
          }`}
        >
          {pointsLeft}
        </span>
        <span className="ml-2 text-parchment/70">of {BONUS_POINTS}</span>
      </p>
      <ul className="space-y-2">
        {STAT_KEYS.map((k) => {
          const base = stats[k];
          const mod = raceMods[k] ?? 0;
          const total = base + mod;
          const canInc = base < STAT_MAX && pointsLeft > 0;
          const canDec = base > STAT_MIN;
          return (
            <li
              key={k}
              className="grid grid-cols-[80px_auto_60px_auto_120px] items-center gap-3 rounded border border-parchment/10 bg-ink/30 p-2"
            >
              <span className="text-sm font-mono uppercase text-parchment/80">
                {STAT_LABELS[k]}
              </span>
              <button
                type="button"
                disabled={!canDec}
                onClick={() => onAdjust(k, -1)}
                className="rounded border border-parchment/25 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/50 disabled:cursor-not-allowed disabled:opacity-30"
              >
                −
              </button>
              <span className="text-center font-mono text-2xl text-parchment">
                {base}
              </span>
              <button
                type="button"
                disabled={!canInc}
                onClick={() => onAdjust(k, +1)}
                className="rounded border border-parchment/25 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/50 disabled:cursor-not-allowed disabled:opacity-30"
              >
                +
              </button>
              <span className="text-right text-[13px] text-parchment/75">
                {mod !== 0 ? (
                  <>
                    + race {fmtMod(mod)} ={" "}
                    <span className="text-parchment/90">{total}</span>
                  </>
                ) : (
                  <span className="text-parchment/60">no racial mod</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-parchment/65">
        Tip: maxing one stat costs 10 points, leaving 5 to scatter. A
        flat spread of +3 per stat is the alternative — pick a real
        primary or a generalist, but not both.
      </p>
    </section>
  );
}

// ── Step 6: Confirm ───────────────────────────────────────────────

function Step6Confirm({
  name,
  raceId,
  gender,
  classId,
  sprite,
  stats,
  raceById,
  classById,
  startingHp,
  startingMp,
}: {
  name: string;
  raceId: string;
  gender: Gender;
  classId: string;
  sprite: string;
  stats: Record<StatKey, number>;
  raceById: Map<string, RaceRecord>;
  classById: Map<string, ClassRecord>;
  startingHp: number;
  startingMp: number;
}) {
  const race = raceById.get(raceId);
  const klass = classById.get(classId);
  const mods = (race?.stat_modifiers ?? {}) as Partial<Record<StatKey, number>>;
  return (
    <section className="space-y-4">
      <h3 className="mb-2 text-[13px] uppercase tracking-wide text-parchment/75">
        Confirm
      </h3>
      <div className="flex gap-4 rounded border border-parchment/15 bg-ink/40 p-4">
        <div className="shrink-0">
          {sprite ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={withBasePath(`/sprites/${sprite}`)}
              alt=""
              width={64}
              height={64}
              style={{ imageRendering: "pixelated" }}
              className="h-16 w-16 rounded border border-parchment/20 bg-ink/80 object-contain"
            />
          ) : (
            <div className="h-16 w-16 rounded border border-parchment/20 bg-ink/80" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl text-parchment">{name}</p>
          <p className="text-sm text-parchment/75">
            Level 1 {klass?.name ?? classId} · {race?.name ?? raceId} · {gender}
          </p>
          <p className="mt-1 font-mono text-[13px] text-parchment/75">
            id: <span className="text-parchment/80">{slugify(name)}</span>
          </p>
          <p className="mt-2 text-sm text-parchment/85">
            <span className="text-parchment/80">HP</span>{" "}
            <span className="font-mono">{startingHp}</span>
            <span className="ml-3 text-parchment/80">MP</span>{" "}
            <span className="font-mono">{startingMp}</span>
          </p>
        </div>
      </div>
      <div className="rounded border border-parchment/15 bg-ink/40 p-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-parchment/65">
          Final stats (base + racial mod)
        </p>
        <ul className="grid grid-cols-5 gap-2">
          {STAT_KEYS.map((k) => {
            const base = stats[k];
            const mod = mods[k] ?? 0;
            const total = base + mod;
            return (
              <li
                key={k}
                className="rounded border border-parchment/10 bg-ink/50 px-2 py-1 text-center"
              >
                <p className="text-xs uppercase tracking-wide text-parchment/75">
                  {STAT_LABELS[k]}
                </p>
                <p className="font-mono text-2xl text-parchment">{total}</p>
                <p className="text-xs text-parchment/65">
                  {base}
                  {mod !== 0 ? ` ${fmtMod(mod)}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ── Internal helpers ──────────────────────────────────────────────

function isClassAllowedForRace(classId: string, raceId: string): boolean {
  if (classId === "wizard") return WIZARD_RACES.has(raceId);
  return true;
}

function fmtModsLine(
  mods: Partial<Record<StatKey, number>> | undefined,
): string {
  if (!mods) return "— · — · — · — · —";
  return STAT_KEYS.map((k) => {
    const v = mods[k];
    if (v === undefined || v === 0) return "—";
    return v > 0 ? `+${v}` : String(v);
  }).join(" · ");
}

function applyMods(
  base: Record<StatKey, number>,
  mods: Partial<Record<StatKey, number>> | undefined,
): Record<StatKey, number> {
  return {
    strength: base.strength + (mods?.strength ?? 0),
    dexterity: base.dexterity + (mods?.dexterity ?? 0),
    constitution: base.constitution + (mods?.constitution ?? 0),
    intelligence: base.intelligence + (mods?.intelligence ?? 0),
    wisdom: base.wisdom + (mods?.wisdom ?? 0),
  };
}

/** Slugify a display name into a snake_case id. "Aldric Bren" →
 *  "aldric_bren". The same logic the editor's other browse views
 *  use, but tucked here to keep the wizard self-contained. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "character";
}

/** Default sprite suggestion for a freshly-picked class. Keys mirror
 *  v1's `defaultAvatarFor`. Authors can override on the sprite step. */
function defaultSpriteFor(classId: string): string {
  switch (classId) {
    case "fighter":
      return "person/fighter6.png";
    case "paladin":
      return "person/fighter1.png";
    case "ranger":
      return "person/ranger1.png";
    case "thief":
      return "person/thief1.png";
    case "cleric":
      return "person/cleric1.png";
    case "druid":
      return "person/druid1.png";
    case "wizard":
      return "person/wizard1.png";
    case "alchemist":
      return "person/wizard4.png";
    default:
      return "";
  }
}

