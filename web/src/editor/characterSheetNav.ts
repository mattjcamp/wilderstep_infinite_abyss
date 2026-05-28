/**
 * Keyboard navigation reducer for the per-character sheet
 * (`CharacterSheetSim`). Same shape as `partyScreenNav` but for a
 * different layout:
 *
 *   ┌─────────── CHARACTER NAME ───────────┐
 *   │ portrait + stats │ EQUIPPED          │
 *   │                  │ Hands  Club        │
 *   │                  │ Body   Cloth       │
 *   │                  │                    │
 *   │                  │ PERSONAL ITEMS     │
 *   │                  │ Torch              │
 *   │                  │ Potion             │
 *   ├──────────────────┴────────────────────┤
 *   │ RACE ABILITIES    CLASS ABILITIES     │
 *   │ Infravision …     Smite Evil …        │
 *   ├───────────────────────────────────────┤
 *   │ SPELLS                                │
 *   │ Light                                 │
 *   └───────────────────────────────────────┘
 *
 * Vertical flow (Down): equipped → personal → race/class → spells.
 * Horizontal flow (Left/Right): swaps between Race and Class abilities,
 * which sit side-by-side in a two-column grid.
 *
 * Enter on a row emits a `trigger` action with the zone + index. The
 * component knows which catalog backs each zone and dispatches to the
 * right host callback (unequip slot, use ability, cast spell, etc.).
 *
 * Why a separate reducer (vs. inline in CharacterSheetSim):
 *   - Same testability win the Party screen got — unit-testable
 *     without jsdom, exhaustive over zone × key combinations.
 *   - Keeps the component focused on rendering + side-effects.
 *   - Makes the "Down from last X goes to Y" rules explicit, easy to
 *     scan, and easy to change as the sheet grows new sections.
 */

export type CharSheetZone =
  | "equipped"
  | "personal"
  | "race-abilities"
  | "class-abilities"
  | "spells";

/** Subset of zones that live in the abilities row (race vs. class
 *  side-by-side). Tracked separately on the state so Up from spells
 *  can return to whichever side the cursor came from. */
export type CharSheetAbilityZone =
  | "race-abilities"
  | "class-abilities";

export interface CharSheetNavState {
  zone: CharSheetZone;
  /** 0 = hands, 1 = body. Two-row list in the current sheet design;
   *  adding a third slot is a counts-only change here. */
  equippedIndex: number;
  /** Cursor in the personal-inventory list. `-1` when empty. */
  personalIndex: number;
  /** Cursor in the race-abilities list. */
  raceIndex: number;
  /** Cursor in the class-abilities list. */
  classIndex: number;
  /** Cursor in the known-spells list. */
  spellIndex: number;
  /** Which side of the abilities row was last visited. Up from
   *  spells returns here so the round-trip lands on the same column.
   *  Defaults to `race-abilities`. */
  lastAbilityZone: CharSheetAbilityZone;
}

export interface CharSheetNavContext {
  /** Number of equipped slots the sheet renders. The current layout
   *  has 2 (hands + body); the reducer doesn't hard-code that — pass
   *  whatever the sheet actually paints. */
  equippedCount: number;
  /** Length of the personal-items list. */
  personalCount: number;
  /** Length of race abilities. */
  raceCount: number;
  /** Length of class abilities. */
  classCount: number;
  /** Length of known spells. */
  spellCount: number;
  /** True iff Enter on the focused equipped slot has a host action
   *  to fire (host wired `onUnequipSlot` + the slot actually holds
   *  an item). When false, Enter on an equipped slot is a no-op. */
  canEquippedAct: boolean;
  /** True iff Enter on the focused personal item has at least one
   *  host action to fire (Use / Equip / Return). Component decides
   *  which one — reducer just needs to know whether Enter does
   *  anything at all. */
  canPersonalAct: boolean;
  /** True iff race abilities can be triggered (some are passives —
   *  the host gates further). Reducer treats abilities like rows. */
  canAbilityAct: boolean;
  /** True iff spells can be cast (handler wired + the row isn't a
   *  battle-only spell, etc.). The component handles the finer
   *  gates per-spell; the reducer just gates Enter. */
  canSpellAct: boolean;
}

export type CharSheetNavInput =
  | { kind: "key"; key: string }
  | { kind: "set-equipped"; index: number }
  | { kind: "set-personal"; index: number }
  | { kind: "set-race"; index: number }
  | { kind: "set-class"; index: number }
  | { kind: "set-spell"; index: number }
  | { kind: "reset" };

export type CharSheetNavAction =
  | { kind: "none" }
  /** Fire whichever host callback the zone maps to (unequip, use,
   *  cast). The component owns the dispatch table. */
  | { kind: "trigger"; zone: CharSheetZone; index: number };

export interface CharSheetNavResult {
  state: CharSheetNavState;
  action: CharSheetNavAction;
  consumed: boolean;
}

export function initialCharSheetNavState(
  ctx: CharSheetNavContext,
): CharSheetNavState {
  // Start on the equipped section — it's the topmost interactive
  // list and what a v1 player would have landed on. The cursor on
  // each list defaults to 0; -1 stash-style "empty list" sentinel
  // is reserved for personal which can actually be empty in early
  // game.
  return {
    zone: "equipped",
    equippedIndex: 0,
    personalIndex: ctx.personalCount > 0 ? 0 : -1,
    raceIndex: 0,
    classIndex: 0,
    spellIndex: 0,
    lastAbilityZone: "race-abilities",
  };
}

export function reduceCharSheetNav(
  state: CharSheetNavState,
  input: CharSheetNavInput,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  const s = clampState(state, ctx);

  switch (input.kind) {
    case "reset":
      return {
        state: initialCharSheetNavState(ctx),
        action: { kind: "none" },
        consumed: false,
      };
    case "set-equipped":
      return {
        state: {
          ...s,
          zone: "equipped",
          equippedIndex: clamp(input.index, 0, Math.max(0, ctx.equippedCount - 1)),
        },
        action: { kind: "none" },
        consumed: false,
      };
    case "set-personal":
      return {
        state: {
          ...s,
          zone: "personal",
          personalIndex: ctx.personalCount > 0
            ? clamp(input.index, 0, ctx.personalCount - 1)
            : -1,
        },
        action: { kind: "none" },
        consumed: false,
      };
    case "set-race":
      return {
        state: {
          ...s,
          zone: "race-abilities",
          raceIndex: clamp(input.index, 0, Math.max(0, ctx.raceCount - 1)),
          lastAbilityZone: "race-abilities",
        },
        action: { kind: "none" },
        consumed: false,
      };
    case "set-class":
      return {
        state: {
          ...s,
          zone: "class-abilities",
          classIndex: clamp(input.index, 0, Math.max(0, ctx.classCount - 1)),
          lastAbilityZone: "class-abilities",
        },
        action: { kind: "none" },
        consumed: false,
      };
    case "set-spell":
      return {
        state: {
          ...s,
          zone: "spells",
          spellIndex: clamp(input.index, 0, Math.max(0, ctx.spellCount - 1)),
        },
        action: { kind: "none" },
        consumed: false,
      };
  }

  const { key } = input;
  switch (s.zone) {
    case "equipped":
      return reduceEquippedKey(s, key, ctx);
    case "personal":
      return reducePersonalKey(s, key, ctx);
    case "race-abilities":
      return reduceRaceKey(s, key, ctx);
    case "class-abilities":
      return reduceClassKey(s, key, ctx);
    case "spells":
      return reduceSpellKey(s, key, ctx);
  }
}

// ── Per-zone reducers ──────────────────────────────────────────────

function reduceEquippedKey(
  s: CharSheetNavState,
  key: string,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (isDownKey(key)) {
    if (s.equippedIndex < ctx.equippedCount - 1) {
      return consumed({ ...s, equippedIndex: s.equippedIndex + 1 });
    }
    // Off the bottom of equipped — spill down through the layout.
    return spillDownFromEquipped(s, ctx);
  }
  if (isUpKey(key)) {
    if (s.equippedIndex > 0) {
      return consumed({ ...s, equippedIndex: s.equippedIndex - 1 });
    }
    return consumed(s); // top of the sheet
  }
  if (key === "Enter") {
    if (!ctx.canEquippedAct) return consumed(s);
    return {
      state: s,
      action: { kind: "trigger", zone: "equipped", index: s.equippedIndex },
      consumed: true,
    };
  }
  return passthrough(s);
}

function reducePersonalKey(
  s: CharSheetNavState,
  key: string,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (isDownKey(key)) {
    if (s.personalIndex < ctx.personalCount - 1) {
      return consumed({ ...s, personalIndex: s.personalIndex + 1 });
    }
    return spillDownFromPersonal(s, ctx);
  }
  if (isUpKey(key)) {
    if (s.personalIndex > 0) {
      return consumed({ ...s, personalIndex: s.personalIndex - 1 });
    }
    return spillUpToEquipped(s, ctx);
  }
  if (key === "Enter") {
    if (!ctx.canPersonalAct) return consumed(s);
    if (s.personalIndex < 0) return consumed(s);
    return {
      state: s,
      action: { kind: "trigger", zone: "personal", index: s.personalIndex },
      consumed: true,
    };
  }
  return passthrough(s);
}

function reduceRaceKey(
  s: CharSheetNavState,
  key: string,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (isDownKey(key)) {
    if (s.raceIndex < ctx.raceCount - 1) {
      return consumed({ ...s, raceIndex: s.raceIndex + 1 });
    }
    return spillDownFromAbilities(s, ctx);
  }
  if (isUpKey(key)) {
    if (s.raceIndex > 0) {
      return consumed({ ...s, raceIndex: s.raceIndex - 1 });
    }
    return spillUpFromAbilities(s, ctx);
  }
  if (isRightKey(key)) {
    return enterClassAbilities(s, ctx);
  }
  if (isLeftKey(key)) {
    return consumed(s); // already left column
  }
  if (key === "Enter") {
    if (!ctx.canAbilityAct || ctx.raceCount === 0) return consumed(s);
    return {
      state: s,
      action: {
        kind: "trigger",
        zone: "race-abilities",
        index: s.raceIndex,
      },
      consumed: true,
    };
  }
  return passthrough(s);
}

function reduceClassKey(
  s: CharSheetNavState,
  key: string,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (isDownKey(key)) {
    if (s.classIndex < ctx.classCount - 1) {
      return consumed({ ...s, classIndex: s.classIndex + 1 });
    }
    return spillDownFromAbilities(s, ctx);
  }
  if (isUpKey(key)) {
    if (s.classIndex > 0) {
      return consumed({ ...s, classIndex: s.classIndex - 1 });
    }
    return spillUpFromAbilities(s, ctx);
  }
  if (isLeftKey(key)) {
    return enterRaceAbilities(s, ctx);
  }
  if (isRightKey(key)) {
    return consumed(s); // already right column
  }
  if (key === "Enter") {
    if (!ctx.canAbilityAct || ctx.classCount === 0) return consumed(s);
    return {
      state: s,
      action: {
        kind: "trigger",
        zone: "class-abilities",
        index: s.classIndex,
      },
      consumed: true,
    };
  }
  return passthrough(s);
}

function reduceSpellKey(
  s: CharSheetNavState,
  key: string,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (isDownKey(key)) {
    if (s.spellIndex < ctx.spellCount - 1) {
      return consumed({ ...s, spellIndex: s.spellIndex + 1 });
    }
    return consumed(s); // bottom of the sheet
  }
  if (isUpKey(key)) {
    if (s.spellIndex > 0) {
      return consumed({ ...s, spellIndex: s.spellIndex - 1 });
    }
    return spillUpFromSpells(s, ctx);
  }
  if (key === "Enter") {
    if (!ctx.canSpellAct || ctx.spellCount === 0) return consumed(s);
    return {
      state: s,
      action: { kind: "trigger", zone: "spells", index: s.spellIndex },
      consumed: true,
    };
  }
  return passthrough(s);
}

// ── Cross-zone spill helpers ──────────────────────────────────────

function spillDownFromEquipped(
  s: CharSheetNavState,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (ctx.personalCount > 0) {
    return consumed({ ...s, zone: "personal", personalIndex: 0 });
  }
  return spillDownFromPersonal(s, ctx);
}

function spillDownFromPersonal(
  s: CharSheetNavState,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  // Prefer the side the player was last on if both are present.
  if (s.lastAbilityZone === "class-abilities" && ctx.classCount > 0) {
    return consumed({ ...s, zone: "class-abilities", classIndex: 0 });
  }
  if (ctx.raceCount > 0) {
    return consumed({
      ...s,
      zone: "race-abilities",
      raceIndex: 0,
      lastAbilityZone: "race-abilities",
    });
  }
  if (ctx.classCount > 0) {
    return consumed({
      ...s,
      zone: "class-abilities",
      classIndex: 0,
      lastAbilityZone: "class-abilities",
    });
  }
  if (ctx.spellCount > 0) {
    return consumed({ ...s, zone: "spells", spellIndex: 0 });
  }
  return consumed(s);
}

function spillDownFromAbilities(
  s: CharSheetNavState,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (ctx.spellCount > 0) {
    return consumed({ ...s, zone: "spells", spellIndex: 0 });
  }
  return consumed(s);
}

function spillUpToEquipped(
  s: CharSheetNavState,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (ctx.equippedCount === 0) return consumed(s);
  return consumed({
    ...s,
    zone: "equipped",
    equippedIndex: ctx.equippedCount - 1,
  });
}

function spillUpFromAbilities(
  s: CharSheetNavState,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (ctx.personalCount > 0) {
    return consumed({
      ...s,
      zone: "personal",
      personalIndex: ctx.personalCount - 1,
    });
  }
  if (ctx.equippedCount > 0) {
    return consumed({
      ...s,
      zone: "equipped",
      equippedIndex: ctx.equippedCount - 1,
    });
  }
  return consumed(s);
}

function spillUpFromSpells(
  s: CharSheetNavState,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (s.lastAbilityZone === "class-abilities" && ctx.classCount > 0) {
    return consumed({
      ...s,
      zone: "class-abilities",
      classIndex: ctx.classCount - 1,
    });
  }
  if (ctx.raceCount > 0) {
    return consumed({
      ...s,
      zone: "race-abilities",
      raceIndex: ctx.raceCount - 1,
      lastAbilityZone: "race-abilities",
    });
  }
  if (ctx.classCount > 0) {
    return consumed({
      ...s,
      zone: "class-abilities",
      classIndex: ctx.classCount - 1,
      lastAbilityZone: "class-abilities",
    });
  }
  if (ctx.personalCount > 0) {
    return consumed({
      ...s,
      zone: "personal",
      personalIndex: ctx.personalCount - 1,
    });
  }
  if (ctx.equippedCount > 0) {
    return consumed({
      ...s,
      zone: "equipped",
      equippedIndex: ctx.equippedCount - 1,
    });
  }
  return consumed(s);
}

function enterRaceAbilities(
  s: CharSheetNavState,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (ctx.raceCount === 0) return consumed(s);
  // Preserve the row index when crossing — Class row N → Race row N
  // when possible, otherwise clamp to the last race row.
  const idx = clamp(s.classIndex, 0, ctx.raceCount - 1);
  return consumed({
    ...s,
    zone: "race-abilities",
    raceIndex: idx,
    lastAbilityZone: "race-abilities",
  });
}

function enterClassAbilities(
  s: CharSheetNavState,
  ctx: CharSheetNavContext,
): CharSheetNavResult {
  if (ctx.classCount === 0) return consumed(s);
  const idx = clamp(s.raceIndex, 0, ctx.classCount - 1);
  return consumed({
    ...s,
    zone: "class-abilities",
    classIndex: idx,
    lastAbilityZone: "class-abilities",
  });
}

// ── Helpers ───────────────────────────────────────────────────────

function consumed(state: CharSheetNavState): CharSheetNavResult {
  return { state, action: { kind: "none" }, consumed: true };
}
function passthrough(state: CharSheetNavState): CharSheetNavResult {
  return { state, action: { kind: "none" }, consumed: false };
}

function isUpKey(key: string): boolean {
  return key === "ArrowUp" || key === "k" || key === "K";
}
function isDownKey(key: string): boolean {
  return key === "ArrowDown" || key === "j" || key === "J";
}
function isLeftKey(key: string): boolean {
  return key === "ArrowLeft" || key === "h";
}
function isRightKey(key: string): boolean {
  return key === "ArrowRight" || key === "l";
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function clampState(
  s: CharSheetNavState,
  ctx: CharSheetNavContext,
): CharSheetNavState {
  return {
    ...s,
    equippedIndex: ctx.equippedCount > 0
      ? clamp(s.equippedIndex, 0, ctx.equippedCount - 1)
      : 0,
    personalIndex: ctx.personalCount > 0
      ? clamp(s.personalIndex < 0 ? 0 : s.personalIndex, 0, ctx.personalCount - 1)
      : -1,
    raceIndex: ctx.raceCount > 0
      ? clamp(s.raceIndex, 0, ctx.raceCount - 1)
      : 0,
    classIndex: ctx.classCount > 0
      ? clamp(s.classIndex, 0, ctx.classCount - 1)
      : 0,
    spellIndex: ctx.spellCount > 0
      ? clamp(s.spellIndex, 0, ctx.spellCount - 1)
      : 0,
  };
}
