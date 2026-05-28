import { describe, it, expect } from "vitest";
import {
  initialCharSheetNavState,
  reduceCharSheetNav,
  type CharSheetNavContext,
  type CharSheetNavState,
} from "./characterSheetNav";

/** Stand-in for a fully-loaded character with everything wired:
 *  2 equipped slots, 3 personal items, 2 race abilities, 3 class
 *  abilities, 4 known spells. Tests override what they care about. */
function ctx(over?: Partial<CharSheetNavContext>): CharSheetNavContext {
  return {
    equippedCount: 2,
    personalCount: 3,
    raceCount: 2,
    classCount: 3,
    spellCount: 4,
    canEquippedAct: true,
    canPersonalAct: true,
    canAbilityAct: true,
    canSpellAct: true,
    ...over,
  };
}

function key(state: CharSheetNavState, k: string, c: CharSheetNavContext) {
  return reduceCharSheetNav(state, { kind: "key", key: k }, c);
}

describe("initialCharSheetNavState", () => {
  it("starts on equipped, index 0", () => {
    const s = initialCharSheetNavState(ctx());
    expect(s.zone).toBe("equipped");
    expect(s.equippedIndex).toBe(0);
  });

  it("personalIndex is -1 when the personal list is empty", () => {
    const s = initialCharSheetNavState(ctx({ personalCount: 0 }));
    expect(s.personalIndex).toBe(-1);
  });

  it("lastAbilityZone defaults to race-abilities", () => {
    const s = initialCharSheetNavState(ctx());
    expect(s.lastAbilityZone).toBe("race-abilities");
  });
});

describe("Equipped zone", () => {
  it("ArrowDown moves within the slot list", () => {
    const r = key(initialCharSheetNavState(ctx()), "ArrowDown", ctx());
    expect(r.state.equippedIndex).toBe(1);
    expect(r.consumed).toBe(true);
  });

  it("ArrowDown at the last slot spills into personal", () => {
    const s = { ...initialCharSheetNavState(ctx()), equippedIndex: 1 };
    const r = key(s, "ArrowDown", ctx());
    expect(r.state.zone).toBe("personal");
    expect(r.state.personalIndex).toBe(0);
  });

  it("ArrowDown skips personal when empty, lands on abilities", () => {
    const c = ctx({ personalCount: 0 });
    const s = { ...initialCharSheetNavState(c), equippedIndex: 1 };
    const r = key(s, "ArrowDown", c);
    expect(r.state.zone).toBe("race-abilities");
    expect(r.state.raceIndex).toBe(0);
  });

  it("ArrowUp at index 0 clamps (top of sheet)", () => {
    const r = key(initialCharSheetNavState(ctx()), "ArrowUp", ctx());
    expect(r.state.zone).toBe("equipped");
    expect(r.state.equippedIndex).toBe(0);
  });

  it("Enter emits trigger when the slot is actionable", () => {
    const r = key(initialCharSheetNavState(ctx()), "Enter", ctx());
    expect(r.action).toEqual({
      kind: "trigger",
      zone: "equipped",
      index: 0,
    });
    expect(r.consumed).toBe(true);
  });

  it("Enter is a no-op when no host action is wired for equipped", () => {
    const r = key(
      initialCharSheetNavState(ctx()),
      "Enter",
      ctx({ canEquippedAct: false }),
    );
    expect(r.action).toEqual({ kind: "none" });
  });
});

describe("Personal zone", () => {
  function personalState(idx = 0): CharSheetNavState {
    return {
      ...initialCharSheetNavState(ctx()),
      zone: "personal",
      personalIndex: idx,
    };
  }

  it("ArrowDown moves within the inventory", () => {
    const r = key(personalState(0), "ArrowDown", ctx());
    expect(r.state.personalIndex).toBe(1);
  });

  it("ArrowDown at the last item spills into race abilities", () => {
    const r = key(personalState(2), "ArrowDown", ctx());
    expect(r.state.zone).toBe("race-abilities");
    expect(r.state.raceIndex).toBe(0);
  });

  it("ArrowDown prefers class abilities when lastAbilityZone is class", () => {
    const s = {
      ...personalState(2),
      lastAbilityZone: "class-abilities" as const,
    };
    const r = key(s, "ArrowDown", ctx());
    expect(r.state.zone).toBe("class-abilities");
    expect(r.state.classIndex).toBe(0);
  });

  it("ArrowDown falls through to spells when no abilities exist", () => {
    const c = ctx({ raceCount: 0, classCount: 0 });
    const s = { ...personalState(2) };
    const r = key(s, "ArrowDown", c);
    expect(r.state.zone).toBe("spells");
  });

  it("ArrowUp at index 0 spills back to equipped (last slot)", () => {
    const r = key(personalState(0), "ArrowUp", ctx());
    expect(r.state.zone).toBe("equipped");
    expect(r.state.equippedIndex).toBe(1); // last slot
  });

  it("Enter emits trigger with the personal index", () => {
    const r = key(personalState(1), "Enter", ctx());
    expect(r.action).toEqual({
      kind: "trigger",
      zone: "personal",
      index: 1,
    });
  });

  it("Enter no-ops on an empty list", () => {
    const c = ctx({ personalCount: 0 });
    const s = { ...personalState(-1) };
    const r = key(s, "Enter", c);
    expect(r.action).toEqual({ kind: "none" });
  });
});

describe("Race-abilities zone", () => {
  function raceState(idx = 0): CharSheetNavState {
    return {
      ...initialCharSheetNavState(ctx()),
      zone: "race-abilities",
      raceIndex: idx,
      lastAbilityZone: "race-abilities",
    };
  }

  it("ArrowDown moves within race abilities", () => {
    const r = key(raceState(0), "ArrowDown", ctx());
    expect(r.state.raceIndex).toBe(1);
  });

  it("ArrowDown at the last race row spills into spells", () => {
    const r = key(raceState(1), "ArrowDown", ctx());
    expect(r.state.zone).toBe("spells");
    expect(r.state.spellIndex).toBe(0);
  });

  it("ArrowUp at index 0 spills back to personal (last item)", () => {
    const r = key(raceState(0), "ArrowUp", ctx());
    expect(r.state.zone).toBe("personal");
    expect(r.state.personalIndex).toBe(2);
  });

  it("ArrowUp lands on equipped when personal is empty", () => {
    const c = ctx({ personalCount: 0 });
    const r = key(raceState(0), "ArrowUp", c);
    expect(r.state.zone).toBe("equipped");
    expect(r.state.equippedIndex).toBe(1);
  });

  it("ArrowRight moves to class abilities, preserving row index", () => {
    const r = key(raceState(1), "ArrowRight", ctx());
    expect(r.state.zone).toBe("class-abilities");
    expect(r.state.classIndex).toBe(1);
    expect(r.state.lastAbilityZone).toBe("class-abilities");
  });

  it("ArrowRight clamps row index when class has fewer rows", () => {
    const c = ctx({ classCount: 1 });
    const r = key(raceState(1), "ArrowRight", c);
    expect(r.state.classIndex).toBe(0);
  });

  it("ArrowLeft on race is a clamp (already left column)", () => {
    const r = key(raceState(0), "ArrowLeft", ctx());
    expect(r.state.zone).toBe("race-abilities");
  });

  it("Enter emits trigger with the race index", () => {
    const r = key(raceState(1), "Enter", ctx());
    expect(r.action).toEqual({
      kind: "trigger",
      zone: "race-abilities",
      index: 1,
    });
  });

  it("ArrowRight no-ops when there are no class abilities", () => {
    const c = ctx({ classCount: 0 });
    const r = key(raceState(0), "ArrowRight", c);
    expect(r.state.zone).toBe("race-abilities");
  });
});

describe("Class-abilities zone", () => {
  function classState(idx = 0): CharSheetNavState {
    return {
      ...initialCharSheetNavState(ctx()),
      zone: "class-abilities",
      classIndex: idx,
      lastAbilityZone: "class-abilities",
    };
  }

  it("ArrowLeft moves back to race abilities, preserving row index", () => {
    const r = key(classState(1), "ArrowLeft", ctx());
    expect(r.state.zone).toBe("race-abilities");
    expect(r.state.raceIndex).toBe(1);
  });

  it("ArrowLeft clamps row index when race has fewer rows", () => {
    const c = ctx({ raceCount: 1 });
    const r = key(classState(2), "ArrowLeft", c);
    expect(r.state.raceIndex).toBe(0);
  });

  it("Enter emits trigger with the class index", () => {
    const r = key(classState(2), "Enter", ctx());
    expect(r.action).toEqual({
      kind: "trigger",
      zone: "class-abilities",
      index: 2,
    });
  });

  it("ArrowDown at the last row spills into spells", () => {
    const r = key(classState(2), "ArrowDown", ctx());
    expect(r.state.zone).toBe("spells");
  });
});

describe("Spells zone", () => {
  function spellState(idx = 0): CharSheetNavState {
    return {
      ...initialCharSheetNavState(ctx()),
      zone: "spells",
      spellIndex: idx,
    };
  }

  it("ArrowDown moves within spells", () => {
    const r = key(spellState(0), "ArrowDown", ctx());
    expect(r.state.spellIndex).toBe(1);
  });

  it("ArrowDown at the last spell clamps (bottom of sheet)", () => {
    const r = key(spellState(3), "ArrowDown", ctx());
    expect(r.state.spellIndex).toBe(3);
  });

  it("ArrowUp at index 0 spills to abilities, lastAbilityZone aware (race)", () => {
    const r = key(spellState(0), "ArrowUp", ctx());
    expect(r.state.zone).toBe("race-abilities");
    expect(r.state.raceIndex).toBe(1); // last race row
  });

  it("ArrowUp at index 0 spills to class when lastAbilityZone was class", () => {
    const s = { ...spellState(0), lastAbilityZone: "class-abilities" as const };
    const r = key(s, "ArrowUp", ctx());
    expect(r.state.zone).toBe("class-abilities");
    expect(r.state.classIndex).toBe(2); // last class row
  });

  it("ArrowUp falls through to personal when no abilities", () => {
    const c = ctx({ raceCount: 0, classCount: 0 });
    const r = key(spellState(0), "ArrowUp", c);
    expect(r.state.zone).toBe("personal");
  });

  it("Enter emits trigger with the spell index", () => {
    const r = key(spellState(2), "Enter", ctx());
    expect(r.action).toEqual({
      kind: "trigger",
      zone: "spells",
      index: 2,
    });
  });

  it("Enter is a no-op when no spells are castable from this screen", () => {
    const r = key(spellState(0), "Enter", ctx({ canSpellAct: false }));
    expect(r.action).toEqual({ kind: "none" });
  });
});

describe("Mouse setters", () => {
  it("set-equipped parks focus on the slot", () => {
    const s = initialCharSheetNavState(ctx());
    const r = reduceCharSheetNav(s, { kind: "set-equipped", index: 1 }, ctx());
    expect(r.state.zone).toBe("equipped");
    expect(r.state.equippedIndex).toBe(1);
  });

  it("set-personal parks focus on the inventory row", () => {
    const r = reduceCharSheetNav(
      initialCharSheetNavState(ctx()),
      { kind: "set-personal", index: 2 },
      ctx(),
    );
    expect(r.state.zone).toBe("personal");
    expect(r.state.personalIndex).toBe(2);
  });

  it("set-race updates lastAbilityZone to race", () => {
    const r = reduceCharSheetNav(
      initialCharSheetNavState(ctx()),
      { kind: "set-race", index: 0 },
      ctx(),
    );
    expect(r.state.lastAbilityZone).toBe("race-abilities");
  });

  it("set-class updates lastAbilityZone to class", () => {
    const r = reduceCharSheetNav(
      initialCharSheetNavState(ctx()),
      { kind: "set-class", index: 1 },
      ctx(),
    );
    expect(r.state.lastAbilityZone).toBe("class-abilities");
  });

  it("set-spell parks focus on the spell row", () => {
    const r = reduceCharSheetNav(
      initialCharSheetNavState(ctx()),
      { kind: "set-spell", index: 3 },
      ctx(),
    );
    expect(r.state.zone).toBe("spells");
    expect(r.state.spellIndex).toBe(3);
  });

  it("reset returns a fresh state", () => {
    const s: CharSheetNavState = {
      zone: "spells",
      equippedIndex: 1,
      personalIndex: 2,
      raceIndex: 1,
      classIndex: 2,
      spellIndex: 3,
      lastAbilityZone: "class-abilities",
    };
    const r = reduceCharSheetNav(s, { kind: "reset" }, ctx());
    expect(r.state.zone).toBe("equipped");
    expect(r.state.equippedIndex).toBe(0);
    expect(r.state.lastAbilityZone).toBe("race-abilities");
  });
});

describe("End-to-end round trips", () => {
  it("can walk equipped → personal → race → class → spells with Down + Right", () => {
    let s = initialCharSheetNavState(ctx());
    s = key(s, "ArrowDown", ctx()).state; // equipped[1]
    s = key(s, "ArrowDown", ctx()).state; // personal[0]
    expect(s.zone).toBe("personal");
    s = key(s, "ArrowDown", ctx()).state;
    s = key(s, "ArrowDown", ctx()).state;
    s = key(s, "ArrowDown", ctx()).state; // race-abilities[0]
    expect(s.zone).toBe("race-abilities");
    s = key(s, "ArrowRight", ctx()).state; // class-abilities[0]
    expect(s.zone).toBe("class-abilities");
    s = key(s, "ArrowDown", ctx()).state;
    s = key(s, "ArrowDown", ctx()).state;
    s = key(s, "ArrowDown", ctx()).state; // spells[0]
    expect(s.zone).toBe("spells");
  });

  it("spills cleanly when intermediate sections are empty", () => {
    const c = ctx({ personalCount: 0, raceCount: 0 });
    let s = initialCharSheetNavState(c);
    s = key(s, "ArrowDown", c).state; // equipped[1]
    s = key(s, "ArrowDown", c).state; // straight to class (personal + race both empty)
    expect(s.zone).toBe("class-abilities");
  });
});
