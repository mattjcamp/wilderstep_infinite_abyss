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
 *                       (required; the recommended sprite for the
 *                       race + gender + class is pre-selected)
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parsePersonSprite,
  recommendedPersonSprite,
  titleCase,
  type PersonSpriteInfo,
} from "./personSpriteLabels";
import {
  makeBlankCharacter,
  type CharacterRecord,
} from "./CharacterSheet";
import { spriteUrl, fetchSpriteCatalog } from "@/data_model/spriteUrl";
import { classStatWeights, keyStatsFor, rollStats } from "./statRoll";
import { keyToDir, pickSpatial } from "./spatialNav";

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
  /** Movement per combat turn — the stat roll treats a fast class as
   *  Dexterity-minded when it isn't one of the shipped classes. */
  range?: number;
  /** Portrait the creator pre-selects when this class is picked
   *  (e.g. "person/fighter.png"). Blank/absent = no suggestion. */
  default_sprite?: string;
}

export interface AbilityRecord {
  id: string;
  name?: string;
  description?: string;
  type?: string;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

/** Heading for each wizard step — says what the player is choosing
 *  rather than a generic "New Character". */
const STEP_TITLES: Record<Step, string> = {
  1: "Name Your Hero",
  2: "Choose Your Race",
  3: "Choose Your Class",
  4: "Choose a Portrait",
  5: "Roll Your Character",
  6: "Review Your Hero",
};

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
  showIdHint = false,
}: {
  existingIds: Set<string>;
  races: RaceRecord[];
  classes: ClassRecord[];
  abilities: AbilityRecord[];
  onComplete: (character: CharacterRecord) => void;
  onCancel: () => void;
  /** Show the authoring note about how the record id is derived from
   *  the name. On in the editor's Characters page (authors care);
   *  off for players forming a party, to whom ids mean nothing. */
  showIdHint?: boolean;
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

  // Person sprite file names (sprites/person/), loaded up front so the
  // recommended sprite is already selected when the player reaches the
  // Sprite step. null = still loading.
  const [personFiles, setPersonFiles] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSpriteCatalog()
      .then((idx) => {
        if (!cancelled) setPersonFiles(idx.categories?.person ?? []);
      })
      .catch(() => {
        if (!cancelled) setPersonFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  /** Best sprite for the current race + gender + class — pre-selected
   *  and badged "Suggested" on the Sprite step. */
  const recommendedSprite = useMemo(() => {
    const classDefault = classes.find((c) => c.id === classId)?.default_sprite;
    return recommendedPersonSprite(personFiles ?? [], {
      raceId,
      gender,
      classId,
      classDefault: typeof classDefault === "string" ? classDefault : "",
    });
  }, [personFiles, raceId, gender, classId, classes]);
  // Keep the selection on the recommendation as race / gender / class
  // change, until the player picks a sprite themselves.
  useEffect(() => {
    if (!spriteTouched) setSprite(recommendedSprite);
  }, [recommendedSprite, spriteTouched]);

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
    if (step === 4 && !sprite) {
      setError("Pick a sprite for your character.");
      return;
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
    if (!sprite) {
      setStep(4);
      setError("Pick a sprite for your character.");
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

  // ── Keyboard navigation ──────────────────────────────────────────
  // Arrow keys (and W/A/S/D outside the name field) move focus to the
  // nearest control in that direction — card rows, the portrait grid,
  // the stat −/+ rows, Back / Next — via spatialNav. Enter / Space
  // press the focused button natively (select a race, raise a stat,
  // Next…); Enter in the name field also means Next. Each new step
  // starts focused on its current choice (the Create button on the
  // final step).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusables = (): HTMLElement[] => {
    const root = rootRef.current;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
      ),
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  };
  /** Focus an element and keep it clear of the site's sticky header. */
  const focusEl = (el: HTMLElement) => {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
    const header = document.querySelector<HTMLElement>("header.sticky");
    const inset = (header?.getBoundingClientRect().bottom ?? 0) + 12;
    const top = el.getBoundingClientRect().top;
    if (top < inset) window.scrollBy({ top: top - inset });
  };
  /** Where focus lands on a step: the selected choice, else the first
   *  control after Cancel and the Back / Next row. */
  const focusStepStart = () => {
    const root = rootRef.current;
    if (!root) return;
    const sel = root.querySelector<HTMLElement>('[data-cc-selected="true"]');
    if (sel) return focusEl(sel);
    const list = focusables();
    // Skip Cancel and the Back / Next row (now above the step's
    // content) so a step without a selection starts on its first
    // real control — e.g. the name field.
    const nav = root.querySelector("[data-cc-nav]");
    const first = list.find(
      (el) => !el.hasAttribute("data-cc-cancel") && !nav?.contains(el),
    );
    if (first) focusEl(first);
  };
  useEffect(() => {
    // Wait a frame so the new step's DOM (and the sprite grid, which
    // loads its catalog) is in place.
    const t = setTimeout(focusStepStart, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && root.contains(active);
      // Only steer keys meant for the creator: focus is inside it, or
      // nowhere in particular (body) — never another page's field.
      if (!inside && active && active !== document.body) return;
      const typing =
        !!active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      const dir = keyToDir(e.key, !typing);
      if (!dir) return;
      // In the name field ←/→ move the caret as usual.
      if (typing && (dir === "left" || dir === "right")) return;
      e.preventDefault();
      if (!inside) {
        focusStepStart();
        return;
      }
      const list = focusables().filter((el) => el !== active);
      const i = pickSpatial(
        active!.getBoundingClientRect(),
        list.map((el) => el.getBoundingClientRect()),
        dir,
      );
      if (i >= 0) focusEl(list[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div
      ref={rootRef}
      data-cc-root
      className="rounded-md border border-parchment/15 bg-ink/30 p-6"
    >
      <style>{`
        [data-cc-root] button:focus-visible,
        [data-cc-root] input:focus-visible {
          outline: 2px solid #fcd34d;
          outline-offset: 2px;
        }
      `}</style>
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={onCancel}
          data-cc-cancel
          className="text-sm text-parchment/75 hover:text-parchment/90"
        >
          ← Cancel
        </button>
        <h2 className="font-display text-2xl text-parchment">
          {STEP_TITLES[step]} — Step {step} of 6
        </h2>
        <span className="w-16" />
      </header>

      {/* Back / Next sit at the top, right under the step title, so
          they're easy to find without scrolling past long card lists. */}
      <div data-cc-nav className="mb-4 flex items-center justify-between">
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
            data-cc-selected="true"
            className="rounded border border-ember/60 bg-ember/40 px-3 py-1 text-sm text-parchment hover:bg-ember/60"
          >
            Create Character
          </button>
        )}
      </div>
      {error ? (
        <p className="mb-4 rounded border border-ember/40 bg-ember/15 p-2 text-sm text-ember/90">
          {error}
        </p>
      ) : null}


      {step === 1 ? (
        <Step1Name
          showIdHint={showIdHint}
          onSubmit={onNext}
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
          raceId={raceId}
          gender={gender}
          classId={classId}
          races={races}
          sprite={sprite}
          recommended={recommendedSprite}
          onSpriteChange={(v) => {
            setSprite(v);
            // Picking the suggestion keeps it following race / gender /
            // class changes; any other pick sticks.
            setSpriteTouched(v !== recommendedSprite);
            setError(null);
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
          className={classById.get(classId)?.name ?? titleCase(classId)}
          keyStats={keyStatsFor(
            classStatWeights(classById.get(classId) ?? { id: classId }),
          )}
          onRoll={() => {
            setStats(
              rollStats(
                classStatWeights(classById.get(classId) ?? { id: classId }),
                { min: STAT_MIN, max: STAT_MAX, bonus: BONUS_POINTS },
              ),
            );
            setError(null);
          }}
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

    </div>
  );
}

// ── Step 1: Name ───────────────────────────────────────────────────

function Step1Name({
  name,
  onNameChange,
  onSubmit,
  showIdHint,
}: {
  name: string;
  onNameChange: (v: string) => void;
  /** Enter in the name field — same as pressing Next. */
  onSubmit: () => void;
  showIdHint: boolean;
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
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Aldric"
        autoFocus
        className="w-full rounded border border-parchment/20 bg-ink/50 px-3 py-2 text-lg text-parchment/95 placeholder:text-parchment/60 focus:border-parchment/60 focus:outline-none"
      />
      {showIdHint ? (
        <p className="mt-2 text-[13px] text-parchment/65">
          The id is derived from the name (snake_case, e.g. "Aldric Bren" →{" "}
          <code>aldric_bren</code>). You can rename later in the
          character sheet.
        </p>
      ) : null}
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
              aria-pressed={r.id === raceId}
              data-cc-selected={r.id === raceId ? "true" : undefined}
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
              aria-pressed={gender === g}
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
                aria-pressed={c.id === classId}
                data-cc-selected={c.id === classId ? "true" : undefined}
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

type SpriteTypeFilter = "all" | "class" | "townsfolk" | "animal";

function Step4Sprite({
  sprite,
  recommended,
  onSpriteChange,
  raceId,
  gender,
  classId,
  races,
}: {
  sprite: string;
  /** The recommended sprite path (pre-selected; badged "Suggested"). */
  recommended: string;
  onSpriteChange: (path: string) => void;
  /** Choices from steps 2–3 — the picker opens filtered to them and
   *  badges the exact race + gender + class match as "Suggested". */
  raceId: string;
  gender: string;
  classId: string;
  races: ReadonlyArray<RaceRecord>;
}) {
  const [index, setIndex] = useState<SpriteIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSpriteCatalog()
      .then((idx) => setIndex(idx))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  const raceName = useCallback(
    (id: string) => races.find((r) => r.id === id)?.name ?? titleCase(id),
    [races],
  );
  const all = useMemo(
    () =>
      (index?.categories?.person ?? []).map((f) =>
        parsePersonSprite(f, raceName),
      ),
    [index, raceName],
  );
  /** Races that actually have art, in the catalog's order. */
  const spriteRaces = useMemo(() => {
    const have = new Set(all.map((s) => s.race).filter(Boolean) as string[]);
    const ordered = races.map((r) => r.id).filter((id) => have.has(id));
    for (const id of have) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  }, [all, races]);

  const myGender = gender.toLowerCase();
  const [raceFilter, setRaceFilter] = useState<string>("mine");
  const [genderFilter, setGenderFilter] = useState<string>(myGender);
  const [typeFilter, setTypeFilter] = useState<SpriteTypeFilter>("all");
  // "mine" resolves to the character's race once we know art exists
  // for it; otherwise fall back to every race (e.g. no Elf sprites yet).
  const raceHasArt = spriteRaces.includes(raceId);
  const effectiveRace =
    raceFilter === "mine" ? (raceHasArt ? raceId : "all") : raceFilter;

  const isSuggested = (s: PersonSpriteInfo) => s.path === recommended;

  const KIND_ORDER: Record<string, number> = {
    class: 0,
    commoner: 1,
    villager: 2,
    musician: 3,
    animal: 4,
    other: 5,
  };
  const shown = useMemo(() => {
    const raceIdx = (r: string | null) =>
      r == null ? 999 : spriteRaces.indexOf(r);
    return all
      .filter((s) => {
        if (typeFilter === "animal") return s.kind === "animal";
        if (typeFilter === "class" && s.kind !== "class") return false;
        if (
          typeFilter === "townsfolk" &&
          !["commoner", "villager", "musician"].includes(s.kind)
        )
          return false;
        if (s.kind === "animal" || s.kind === "other") return typeFilter === "all";
        if (effectiveRace !== "all" && s.race !== effectiveRace) return false;
        if (genderFilter !== "any" && s.gender !== genderFilter) return false;
        return true;
      })
      .sort(
        (a, b) =>
          Number(isSuggested(b)) - Number(isSuggested(a)) ||
          raceIdx(a.race) - raceIdx(b.race) ||
          (a.gender ?? "").localeCompare(b.gender ?? "") ||
          KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
          a.label.localeCompare(b.label),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, typeFilter, effectiveRace, genderFilter, spriteRaces, recommended]);

  const selectedInfo = sprite
    ? all.find((s) => s.path === sprite) ??
      parsePersonSprite(sprite.replace(/^person\//, ""), raceName)
    : null;

  const chip = (active: boolean) =>
    [
      "rounded-full border px-2.5 py-0.5 text-xs transition",
      active
        ? "border-amber-300/70 bg-amber-300/15 text-amber-100"
        : "border-parchment/20 text-parchment/75 hover:border-parchment/45 hover:text-parchment",
    ].join(" ");

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
        <>
          <div className="mb-2 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-14 text-xs text-parchment/60">Race</span>
              <button
                type="button"
                className={chip(effectiveRace === "all")}
                aria-pressed={effectiveRace === "all"}
                onClick={() => setRaceFilter("all")}
              >
                All
              </button>
              {spriteRaces.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={chip(effectiveRace === r)}
                  aria-pressed={effectiveRace === r}
                  onClick={() => setRaceFilter(r)}
                >
                  {raceName(r)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-14 text-xs text-parchment/60">Gender</span>
              {(["any", "male", "female"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={chip(genderFilter === g)}
                  aria-pressed={genderFilter === g}
                  onClick={() => setGenderFilter(g)}
                >
                  {g === "any" ? "Any" : titleCase(g)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-14 text-xs text-parchment/60">Type</span>
              {(
                [
                  ["all", "All"],
                  ["class", "Classes"],
                  ["townsfolk", "Townsfolk"],
                  ["animal", "Animals"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={chip(typeFilter === v)}
                  aria-pressed={typeFilter === v}
                  onClick={() => setTypeFilter(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            {raceFilter === "mine" && !raceHasArt ? (
              <p className="text-xs text-parchment/60">
                No {raceName(raceId)} sprites yet — showing every race.
              </p>
            ) : null}
          </div>

          <div className="max-h-96 overflow-auto rounded border border-parchment/15 bg-ink/30 p-2">
            {shown.length === 0 ? (
              <p className="p-2 text-sm text-parchment/65">
                No sprites match these filters.
              </p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
                {shown.map((s) => {
                  const selected = s.path === sprite;
                  const suggested = isSuggested(s);
                  return (
                    <li key={s.path}>
                      <button
                        type="button"
                        onClick={() => onSpriteChange(s.path)}
                        aria-pressed={selected}
                        data-cc-selected={selected ? "true" : undefined}
                        title={`${s.label}${s.sublabel ? ` — ${s.sublabel}` : ""}\n${s.path}`}
                        className={`relative flex w-full flex-col items-center gap-1 rounded border px-1.5 pb-1.5 pt-2 text-center transition ${
                          selected
                            ? "border-ember/70 bg-ember/20"
                            : "border-parchment/10 bg-ink/40 hover:border-parchment/40 hover:bg-ink/60"
                        }`}
                      >
                        {suggested ? (
                          <span className="absolute left-1 top-1 rounded bg-amber-300/20 px-1 text-[10px] uppercase tracking-wide text-amber-200">
                            Suggested
                          </span>
                        ) : null}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={spriteUrl(s.path)}
                          alt={s.label}
                          width={56}
                          height={56}
                          style={{ imageRendering: "pixelated" }}
                          className="mt-1 h-14 w-14 object-contain"
                        />
                        <span className="w-full text-sm leading-tight text-parchment">
                          {s.label}
                        </span>
                        {s.sublabel ? (
                          <span className="w-full text-[11px] leading-tight text-parchment/65">
                            {s.sublabel}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
      {selectedInfo ? (
        <p className="mt-2 flex items-center gap-2 text-[13px] text-parchment/80">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={spriteUrl(selectedInfo.path)}
            alt=""
            width={24}
            height={24}
            style={{ imageRendering: "pixelated" }}
            className="h-6 w-6 object-contain"
          />
          Selected:{" "}
          <span className="text-parchment">
            {selectedInfo.label}
            {selectedInfo.sublabel ? ` — ${selectedInfo.sublabel}` : ""}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-amber-200/90">
          Pick a sprite for your character — one is required to continue.
        </p>
      )}
      {selectedInfo && recommended && sprite !== recommended ? (
        <button
          type="button"
          onClick={() => onSpriteChange(recommended)}
          className="mt-1 text-xs text-parchment/70 underline hover:text-parchment"
        >
          Use the suggested sprite
        </button>
      ) : null}
    </section>
  );
}

// ── Step 5: Stats ─────────────────────────────────────────────────

const STAT_FULL: Record<StatKey, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
};

/** Round "gem" stepper button. The glyph is drawn with bars rather
 *  than a text character so it sits dead-centre at any font size:
 *  − is a recessed steel button, + a raised ember-gold one. Both press
 *  in on click and glow on hover; disabled dims and goes flat. */
function StatStepButton({
  kind,
  disabled,
  onClick,
  label,
}: {
  kind: "dec" | "inc";
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  const inc = kind === "inc";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition duration-100",
        "active:translate-y-px active:scale-90 disabled:cursor-not-allowed disabled:opacity-25 disabled:shadow-none disabled:active:scale-100",
        inc
          ? "border-amber-300/70 bg-[radial-gradient(circle_at_35%_30%,#f2c46b,#c8553d_55%,#6e2418)] shadow-[0_2px_0_#3a120c,0_0_0_rgba(255,200,90,0)] hover:shadow-[0_2px_0_#3a120c,0_0_14px_rgba(255,200,90,0.55)] hover:brightness-110"
          : "border-parchment/35 bg-[radial-gradient(circle_at_35%_30%,#5a5f74,#2c2f40_60%,#1b1c28)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] hover:border-parchment/60 hover:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6),0_0_10px_rgba(220,220,240,0.25)]",
      ].join(" ")}
    >
      <span
        className={`absolute h-[3px] w-4 rounded-full ${
          inc ? "bg-ink shadow-[0_1px_0_rgba(255,230,170,0.6)]" : "bg-parchment/85"
        }`}
      />
      {inc ? (
        <span className="absolute h-4 w-[3px] rounded-full bg-ink shadow-[1px_0_0_rgba(255,230,170,0.6)]" />
      ) : null}
    </button>
  );
}

/** A small six-sided die, for the roll button. */
function DieIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-6 w-6 ${spinning ? "cc-die-spin" : ""}`}
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#f6efd6" stroke="#1a1a2e" strokeWidth="1.5" />
      {[
        [8, 8],
        [16, 8],
        [12, 12],
        [8, 16],
        [16, 16],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" fill="#6e2418" />
      ))}
    </svg>
  );
}

function Step5Stats({
  stats,
  raceMods,
  pointsLeft,
  onAdjust,
  onRoll,
  className,
  keyStats,
}: {
  stats: Record<StatKey, number>;
  raceMods: Partial<Record<StatKey, number>>;
  pointsLeft: number;
  onAdjust: (stat: StatKey, delta: number) => void;
  /** Fill the sheet with a class-weighted random build. */
  onRoll: () => void;
  /** Chosen class's display name, for the roll caption. */
  className: string;
  /** Stats that matter most to the chosen class — marked with a star. */
  keyStats: ReadonlyArray<StatKey>;
}) {
  // Bumped on every roll: re-keys the value cells so they replay the
  // pop animation, and spins the die.
  const [rollCount, setRollCount] = useState(0);
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (!spinning) return;
    const t = setTimeout(() => setSpinning(false), 600);
    return () => clearTimeout(t);
  }, [spinning]);
  const span = STAT_MAX - STAT_MIN;

  return (
    <section>
      <style>{`
        @keyframes cc-pop { 0% { transform: scale(1.35); color: #f2c46b } 100% { transform: scale(1) } }
        .cc-pop { animation: cc-pop 0.45s ease-out both; display: inline-block }
        @keyframes cc-die { 0% { transform: rotate(0) scale(1) } 50% { transform: rotate(200deg) scale(1.2) } 100% { transform: rotate(360deg) scale(1) } }
        .cc-die-spin { animation: cc-die 0.6s ease-out }
        @media (prefers-reduced-motion: reduce) { .cc-pop, .cc-die-spin { animation: none } }
      `}</style>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-parchment/75">
            These attributes determine how well your character performs in
            the adventure. Use the Roll button to get starting stats and then
            use the +/- buttons to fine tune your character.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <button
            type="button"
            onClick={() => {
              onRoll();
              setRollCount((n) => n + 1);
              setSpinning(true);
            }}
            className="flex items-center gap-2 rounded-lg border-2 border-amber-300/60 bg-gradient-to-b from-ember/70 to-ember/30 px-4 py-2 font-display text-base text-parchment shadow-[0_2px_0_#3a120c] transition hover:brightness-110 hover:shadow-[0_2px_0_#3a120c,0_0_16px_rgba(255,200,90,0.45)] active:translate-y-px"
          >
            <DieIcon spinning={spinning} />
            {rollCount > 0 ? "Roll again" : "Roll for me"}
          </button>
        </div>
      </div>

      {/* Points remaining — one gem per bonus point. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span>
          Points remaining:{" "}
          <span
            className={`font-mono text-lg ${
              pointsLeft === 0 ? "text-parchment/95" : "text-ember"
            }`}
          >
            {pointsLeft}
          </span>
          <span className="ml-1 text-parchment/70">of {BONUS_POINTS}</span>
        </span>
        <span className="flex flex-wrap gap-1" aria-hidden>
          {Array.from({ length: BONUS_POINTS }, (_, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rotate-45 rounded-[2px] border transition-colors duration-200 ${
                i < pointsLeft
                  ? "border-amber-200/80 bg-amber-300 shadow-[0_0_6px_rgba(255,200,90,0.6)]"
                  : "border-parchment/20 bg-transparent"
              }`}
            />
          ))}
        </span>
      </div>

      <ul className="space-y-2">
        {STAT_KEYS.map((k) => {
          const base = stats[k];
          const mod = raceMods[k] ?? 0;
          const total = base + mod;
          const canInc = base < STAT_MAX && pointsLeft > 0;
          const canDec = base > STAT_MIN;
          const key = keyStats.includes(k);
          return (
            <li
              key={k}
              className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3 ${
                key
                  ? "border-amber-300/30 bg-amber-300/[0.04]"
                  : "border-parchment/10 bg-ink/30"
              }`}
            >
              <div className="w-28 shrink-0">
                <div className="font-mono text-base uppercase text-parchment/90">
                  {STAT_LABELS[k]}
                  {key ? (
                    <span
                      className="ml-1.5 text-amber-300"
                      title={`A key stat for a ${className}`}
                    >
                      ★
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-parchment/60">{STAT_FULL[k]}</div>
              </div>
              <div className="flex flex-1 items-center gap-3">
                <StatStepButton
                  kind="dec"
                  disabled={!canDec}
                  onClick={() => onAdjust(k, -1)}
                  label={`Lower ${STAT_FULL[k]}`}
                />
                <div className="flex min-w-[7rem] flex-1 flex-col items-center gap-1">
                  <span
                    key={`${k}-${rollCount}`}
                    className={`font-mono text-3xl leading-none text-parchment ${
                      rollCount > 0 ? "cc-pop" : ""
                    }`}
                  >
                    {base}
                  </span>
                  {/* Meter: one segment per point above the floor. */}
                  <span className="flex w-full max-w-[12rem] gap-0.5" aria-hidden>
                    {Array.from({ length: span }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-sm transition-colors duration-200 ${
                          i < base - STAT_MIN
                            ? i >= span - 3
                              ? "bg-amber-300"
                              : "bg-ember"
                            : "bg-parchment/10"
                        }`}
                      />
                    ))}
                  </span>
                </div>
                <StatStepButton
                  kind="inc"
                  disabled={!canInc}
                  onClick={() => onAdjust(k, +1)}
                  label={`Raise ${STAT_FULL[k]}`}
                />
              </div>
              <span className="w-full text-right text-[13px] text-parchment/75 sm:w-36">
                {mod !== 0 ? (
                  <>
                    race {fmtMod(mod)} →{" "}
                    <span className="font-mono text-base text-parchment/95">
                      {total}
                    </span>
                  </>
                ) : (
                  <span className="text-parchment/60">no racial mod</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
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
              src={spriteUrl(sprite)}
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

