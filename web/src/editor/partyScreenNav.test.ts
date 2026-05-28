import { describe, it, expect } from "vitest";
import {
  initialPartyNavState,
  reducePartyNav,
  ACTION_USE,
  ACTION_SEND,
  ACTION_EXAMINE,
  type PartyNavContext,
  type PartyNavState,
} from "./partyScreenNav";

/** Standard context for the bulk of these tests — 3 effects, 5
 *  stash items, 4 members, every action enabled. Individual cases
 *  override the fields they care about. */
function ctx(over?: Partial<PartyNavContext>): PartyNavContext {
  return {
    effectCount: 3,
    stashCount: 5,
    memberCount: 4,
    canUse: true,
    canSend: true,
    effectAvailable: true,
    ...over,
  };
}

function key(state: PartyNavState, k: string, c: PartyNavContext) {
  return reducePartyNav(state, { kind: "key", key: k }, c);
}

describe("initialPartyNavState", () => {
  it("starts on the effects zone", () => {
    const s = initialPartyNavState(ctx());
    expect(s.zone).toBe("effects");
    expect(s.effectIndex).toBe(0);
    expect(s.stashIndex).toBe(0);
  });

  it("reports -1 stash index when the stash is empty", () => {
    const s = initialPartyNavState(ctx({ stashCount: 0 }));
    expect(s.stashIndex).toBe(-1);
  });

  it("clamps effectIndex when no effects exist", () => {
    const s = initialPartyNavState(ctx({ effectCount: 0 }));
    expect(s.effectIndex).toBe(0); // floor — empty list, doesn't matter
  });
});

describe("Effects zone navigation", () => {
  it("ArrowDown moves to the next effect", () => {
    const s = initialPartyNavState(ctx());
    const r = key(s, "ArrowDown", ctx());
    expect(r.state.effectIndex).toBe(1);
    expect(r.consumed).toBe(true);
  });

  it("ArrowUp at the top of the effects clamps (does not wrap)", () => {
    const s = initialPartyNavState(ctx());
    const r = key(s, "ArrowUp", ctx());
    expect(r.state.zone).toBe("effects");
    expect(r.state.effectIndex).toBe(0);
  });

  it("ArrowDown at the last effect spills into the stash", () => {
    const s = { ...initialPartyNavState(ctx()), effectIndex: 2 };
    const r = key(s, "ArrowDown", ctx());
    expect(r.state.zone).toBe("stash");
    expect(r.state.stashIndex).toBe(0);
    expect(r.consumed).toBe(true);
  });

  it("ArrowDown when the effects list is empty also spills into stash", () => {
    const s = initialPartyNavState(ctx({ effectCount: 0 }));
    const r = key(s, "ArrowDown", ctx({ effectCount: 0 }));
    expect(r.state.zone).toBe("stash");
  });

  it("ArrowDown when both lists are empty stays put", () => {
    const c = ctx({ effectCount: 0, stashCount: 0 });
    const s = initialPartyNavState(c);
    const r = key(s, "ArrowDown", c);
    expect(r.state.zone).toBe("effects");
    expect(r.consumed).toBe(true);
  });

  it("Enter on an available effect emits effect-toggle", () => {
    const s = initialPartyNavState(ctx());
    const r = key(s, "Enter", ctx());
    expect(r.action).toEqual({ kind: "effect-toggle" });
    expect(r.consumed).toBe(true);
  });

  it("Enter on a locked effect does nothing", () => {
    const s = initialPartyNavState(ctx());
    const r = key(s, "Enter", ctx({ effectAvailable: false }));
    expect(r.action).toEqual({ kind: "none" });
  });

  it("Escape bubbles (close action, not consumed)", () => {
    const s = initialPartyNavState(ctx());
    const r = key(s, "Escape", ctx());
    expect(r.action).toEqual({ kind: "close" });
    expect(r.consumed).toBe(false);
  });

  it("Tab also walks into the stash (a11y path)", () => {
    const s = initialPartyNavState(ctx());
    const r = key(s, "Tab", ctx());
    expect(r.state.zone).toBe("stash");
  });
});

describe("Stash zone navigation", () => {
  function stashState(): PartyNavState {
    return { ...initialPartyNavState(ctx()), zone: "stash" };
  }

  it("ArrowDown moves the stash cursor down", () => {
    const r = key(stashState(), "ArrowDown", ctx());
    expect(r.state.stashIndex).toBe(1);
    expect(r.consumed).toBe(true);
  });

  it("ArrowDown at the last stash row clamps", () => {
    const s = { ...stashState(), stashIndex: 4 };
    const r = key(s, "ArrowDown", ctx());
    expect(r.state.stashIndex).toBe(4);
  });

  it("ArrowUp from the first stash row jumps back to the last effect", () => {
    const r = key(stashState(), "ArrowUp", ctx());
    expect(r.state.zone).toBe("effects");
    expect(r.state.effectIndex).toBe(2); // last effect, not first
  });

  it("ArrowUp from the first stash row when no effects exist clamps stash", () => {
    const c = ctx({ effectCount: 0 });
    const r = key(stashState(), "ArrowUp", c);
    expect(r.state.zone).toBe("stash");
    expect(r.state.stashIndex).toBe(0);
  });

  it("Enter opens the actions submenu, defaulting to Use", () => {
    const r = key(stashState(), "Enter", ctx());
    expect(r.state.zone).toBe("actions");
    expect(r.state.actionIndex).toBe(ACTION_USE);
  });

  it("Enter on a non-usable item defaults to Send (next enabled)", () => {
    const r = key(stashState(), "Enter", ctx({ canUse: false }));
    expect(r.state.actionIndex).toBe(ACTION_SEND);
  });

  it("Enter on a non-sendable, non-usable item defaults to Examine", () => {
    const r = key(stashState(), "Enter", ctx({ canUse: false, canSend: false }));
    expect(r.state.actionIndex).toBe(ACTION_EXAMINE);
  });

  it("U accelerator emits use without going through the submenu", () => {
    const r = key(stashState(), "u", ctx());
    expect(r.action).toEqual({ kind: "use" });
    expect(r.state.zone).toBe("stash"); // stays put
  });

  it("S accelerator opens send mode directly", () => {
    const r = key(stashState(), "S", ctx());
    expect(r.state.zone).toBe("send");
    expect(r.state.sendIndex).toBe(0);
  });

  it("X accelerator toggles examine", () => {
    const r = key(stashState(), "x", ctx());
    expect(r.action).toEqual({ kind: "examine-toggle" });
  });

  it("U on a non-usable item is a no-op", () => {
    const r = key(stashState(), "u", ctx({ canUse: false }));
    expect(r.action).toEqual({ kind: "none" });
  });
});

describe("Actions submenu", () => {
  function actionsState(actionIndex = ACTION_USE): PartyNavState {
    return { ...initialPartyNavState(ctx()), zone: "actions", actionIndex };
  }

  it("ArrowRight cycles forward through enabled actions", () => {
    const r = key(actionsState(ACTION_USE), "ArrowRight", ctx());
    expect(r.state.actionIndex).toBe(ACTION_SEND);
  });

  it("ArrowRight wraps around at the end", () => {
    const r = key(actionsState(ACTION_EXAMINE), "ArrowRight", ctx());
    expect(r.state.actionIndex).toBe(ACTION_USE);
  });

  it("ArrowLeft cycles backward", () => {
    const r = key(actionsState(ACTION_USE), "ArrowLeft", ctx());
    expect(r.state.actionIndex).toBe(ACTION_EXAMINE);
  });

  it("ArrowDown also cycles forward (vertical nav works too)", () => {
    const r = key(actionsState(ACTION_USE), "ArrowDown", ctx());
    expect(r.state.actionIndex).toBe(ACTION_SEND);
  });

  it("ArrowRight skips over a disabled Send", () => {
    const c = ctx({ canSend: false });
    const r = key(actionsState(ACTION_USE), "ArrowRight", c);
    expect(r.state.actionIndex).toBe(ACTION_EXAMINE);
  });

  it("Enter on Use emits use and returns to stash", () => {
    const r = key(actionsState(ACTION_USE), "Enter", ctx());
    expect(r.action).toEqual({ kind: "use" });
    expect(r.state.zone).toBe("stash");
  });

  it("Enter on Send opens send mode", () => {
    const r = key(actionsState(ACTION_SEND), "Enter", ctx());
    expect(r.state.zone).toBe("send");
    expect(r.state.sendIndex).toBe(0);
  });

  it("Enter on Examine toggles examine and stays on the submenu", () => {
    const r = key(actionsState(ACTION_EXAMINE), "Enter", ctx());
    expect(r.action).toEqual({ kind: "examine-toggle" });
    expect(r.state.zone).toBe("actions");
  });

  it("Enter on a disabled Use is a no-op (doesn't fire use)", () => {
    const c = ctx({ canUse: false });
    const r = key(actionsState(ACTION_USE), "Enter", c);
    expect(r.action).toEqual({ kind: "none" });
  });

  it("Escape pops back to the stash list", () => {
    const r = key(actionsState(ACTION_SEND), "Escape", ctx());
    expect(r.state.zone).toBe("stash");
    expect(r.consumed).toBe(true);
  });

  it("S accelerator inside actions still opens send mode", () => {
    const r = key(actionsState(ACTION_USE), "s", ctx());
    expect(r.state.zone).toBe("send");
  });
});

describe("Send-to picker", () => {
  function sendState(sendIndex = 0): PartyNavState {
    return { ...initialPartyNavState(ctx()), zone: "send", sendIndex };
  }

  it("ArrowDown advances the roster cursor", () => {
    const r = key(sendState(0), "ArrowDown", ctx());
    expect(r.state.sendIndex).toBe(1);
  });

  it("ArrowDown clamps at the last member", () => {
    const r = key(sendState(3), "ArrowDown", ctx());
    expect(r.state.sendIndex).toBe(3);
  });

  it("ArrowUp clamps at the first member", () => {
    const r = key(sendState(0), "ArrowUp", ctx());
    expect(r.state.sendIndex).toBe(0);
  });

  it("Enter commits the send and returns to the stash zone", () => {
    const r = key(sendState(2), "Enter", ctx());
    expect(r.action).toEqual({ kind: "send", memberIndex: 2 });
    expect(r.state.zone).toBe("stash");
  });

  it("Digit 1..N picks the matching slot directly", () => {
    const r = key(sendState(0), "3", ctx());
    expect(r.action).toEqual({ kind: "send", memberIndex: 2 });
    expect(r.state.zone).toBe("stash");
  });

  it("Digit out of range (e.g. 5 when memberCount=4) is ignored", () => {
    const r = key(sendState(0), "5", ctx());
    expect(r.action).toEqual({ kind: "none" });
    expect(r.consumed).toBe(false);
  });

  it("Escape cancels send and returns to actions submenu", () => {
    const r = key(sendState(1), "Escape", ctx());
    expect(r.state.zone).toBe("actions");
  });

  it("Empty roster — Enter does nothing", () => {
    const c = ctx({ memberCount: 0 });
    const r = key(sendState(0), "Enter", c);
    expect(r.action).toEqual({ kind: "none" });
  });
});

describe("Mouse-driven setters", () => {
  it("set-effect parks focus on effects with the given index", () => {
    const s = { ...initialPartyNavState(ctx()), zone: "stash" as const };
    const r = reducePartyNav(s, { kind: "set-effect", index: 2 }, ctx());
    expect(r.state.zone).toBe("effects");
    expect(r.state.effectIndex).toBe(2);
  });

  it("set-stash parks focus on the stash", () => {
    const s = initialPartyNavState(ctx());
    const r = reducePartyNav(s, { kind: "set-stash", index: 3 }, ctx());
    expect(r.state.zone).toBe("stash");
    expect(r.state.stashIndex).toBe(3);
  });

  it("set-stash clamps to the actual stash count", () => {
    const r = reducePartyNav(
      initialPartyNavState(ctx()),
      { kind: "set-stash", index: 99 },
      ctx(),
    );
    expect(r.state.stashIndex).toBe(4); // last valid index
  });

  it("set-action moves focus to actions with the given button", () => {
    const r = reducePartyNav(
      initialPartyNavState(ctx()),
      { kind: "set-action", index: ACTION_EXAMINE },
      ctx(),
    );
    expect(r.state.zone).toBe("actions");
    expect(r.state.actionIndex).toBe(ACTION_EXAMINE);
  });

  it("reset returns to a fresh state", () => {
    const s: PartyNavState = {
      zone: "send",
      effectIndex: 1,
      stashIndex: 3,
      actionIndex: ACTION_SEND,
      sendIndex: 2,
    };
    const r = reducePartyNav(s, { kind: "reset" }, ctx());
    expect(r.state.zone).toBe("effects");
    expect(r.state.effectIndex).toBe(0);
    expect(r.state.stashIndex).toBe(0);
    expect(r.state.sendIndex).toBe(0);
  });
});

describe("Index clamping on stale state", () => {
  // The component will keep calling the reducer with the live ctx
  // even if the underlying lists changed between renders. The
  // reducer should silently clamp rather than crash.

  it("clamps stashIndex when the stash shrinks", () => {
    const s = { ...initialPartyNavState(ctx()), zone: "stash" as const, stashIndex: 4 };
    const r = key(s, "ArrowDown", ctx({ stashCount: 2 }));
    // After clamp, stashIndex=1 (last valid), Down stays at 1.
    expect(r.state.stashIndex).toBe(1);
  });

  it("clamps effectIndex when the effects list shrinks", () => {
    const s = { ...initialPartyNavState(ctx()), effectIndex: 2 };
    const r = key(s, "ArrowUp", ctx({ effectCount: 1 }));
    // After clamp, effectIndex=0 (only valid), Up clamps to 0.
    expect(r.state.effectIndex).toBe(0);
  });
});
