/**
 * Keyboard navigation reducer for the Party Screen.
 *
 * The Party Screen is the one in-game inspector that's stayed in
 * React rather than migrating to a Phaser-painted version, because
 * the existing layout already reads well. What it needed was full
 * keyboard navigation — today only the stash supports Up/Down, the
 * Effects column is mouse-only, and the action submenu (Use / Send
 * / Examine) only responds to direct U/S/X hotkeys.
 *
 * This module owns the *logic* of that navigation as a pure reducer
 * so the React component doesn't have to grow another 200 lines of
 * tangled keydown handling, and so the rules are unit-testable
 * without jsdom or React Testing Library (neither of which the
 * project has wired up).
 *
 * Mental model:
 *
 *   ┌──────────────┐
 *   │   EFFECTS    │  ← Up/Down moves within the list
 *   │   (vertical) │     Down past last → focusZone="stash"
 *   ├──────────────┤
 *   │    STASH     │  ← Up/Down moves within the list
 *   │   (vertical) │     Up past first → focusZone="effects"
 *   │              │     Enter on row → focusZone="actions"
 *   │              │     U/S/X still work as direct accelerators
 *   ├──────────────┤
 *   │  ACTIONS     │  ← Left/Right (and Up/Down) cycle Use/Send/Examine
 *   │  (horizontal)│     Enter activates; Esc → back to "stash"
 *   ├──────────────┤
 *   │  SEND        │  ← Up/Down or 1-N pick a roster slot
 *   │  (vertical)  │     Enter commits; Esc → back to "actions"
 *   └──────────────┘
 *
 * The reducer doesn't *do* anything itself — it returns the next
 * state and an `action` describing what the caller should fire
 * (useStashItem, sendStashItem, toggleExamine, toggleEffect, close
 * the screen). The component layer translates those into existing
 * callback props so the reducer never imports React.
 */

/** Which list / submenu owns the keyboard cursor right now. */
export type PartyNavZone = "effects" | "stash" | "actions" | "send";

/** Cursor within the action submenu. Matches the painted order in
 *  the screen: 0 = Use, 1 = Send to…, 2 = Examine. */
export const ACTION_USE = 0;
export const ACTION_SEND = 1;
export const ACTION_EXAMINE = 2;

export interface PartyNavState {
  zone: PartyNavZone;
  /** Cursor in the effects list. Clamped to the current `effectCount`
   *  by the reducer on every reduce(); a list resize between key
   *  presses won't strand the cursor off the end. */
  effectIndex: number;
  /** Cursor in the stash list. Same clamp rule. `-1` when the stash
   *  is empty (no row to point at). */
  stashIndex: number;
  /** Cursor in the action submenu (0..2). Only meaningful when
   *  `zone === "actions"`, but kept resident so re-entering the
   *  submenu lands on the same row the player left it on. */
  actionIndex: number;
  /** Cursor in the send-to roster picker. Only meaningful when
   *  `zone === "send"`. Reset to 0 each time send opens. */
  sendIndex: number;
}

/** Pure context the reducer needs to decide what's valid. The
 *  caller computes this from its live props every reduce() so the
 *  reducer can stay stateless. */
export interface PartyNavContext {
  effectCount: number;
  stashCount: number;
  memberCount: number;
  /** Is "Use" enabled for the currently-selected stash item? */
  canUse: boolean;
  /** Is "Send to…" enabled for the currently-selected stash item? */
  canSend: boolean;
  /** Is the currently-selected effect row interactive (i.e., the
   *  roster unlocks it)? Available rows respond to Enter; locked
   *  rows just sit there. */
  effectAvailable: boolean;
}

/** Inputs the reducer accepts. `key` is the primary input —
 *  KeyboardEvent.key strings. The mouse-driven setters let the
 *  component sync state when the user clicks. */
export type PartyNavInput =
  | { kind: "key"; key: string }
  /** User clicked on an effects row at this index. Moves the cursor
   *  AND parks focus on the effects zone (the click is "I want to
   *  navigate this list now"). */
  | { kind: "set-effect"; index: number }
  /** Same for stash. */
  | { kind: "set-stash"; index: number }
  /** User clicked an action button (or its underlying control).
   *  Moves focus to actions and parks the cursor on that action. */
  | { kind: "set-action"; index: number }
  /** Reset state to its "screen just opened" shape — used when the
   *  parent overlay remounts the screen for a new context. */
  | { kind: "reset" };

/** Side effects the caller should fire. `consumed` tells the
 *  caller whether to `stopPropagation` + `preventDefault` on the
 *  underlying KeyboardEvent. */
export type PartyNavAction =
  | { kind: "none" }
  /** Trigger "Use" for the currently selected stash item. */
  | { kind: "use" }
  /** Send the currently selected stash item to `memberIndex`. */
  | { kind: "send"; memberIndex: number }
  /** Open / close the examine panel for the currently selected
   *  stash item. Caller toggles its own examine flag. */
  | { kind: "examine-toggle" }
  /** Toggle the currently selected effect's "active" state. */
  | { kind: "effect-toggle" }
  /** Bubble Esc to the overlay so it closes the whole screen. The
   *  reducer fires this when Esc would have nothing else to do. */
  | { kind: "close" };

export interface PartyNavResult {
  state: PartyNavState;
  action: PartyNavAction;
  /** True if the key was consumed and the caller should stop it
   *  propagating + prevent its default. Always false for unknown
   *  keys so the underlying overlay can still react (P closes the
   *  party screen, etc.). */
  consumed: boolean;
}

/** Construct an initial nav state. Caller usually starts with
 *  zone="effects" so the first arrow press navigates the leftmost
 *  list, matching the user's natural reading order. */
export function initialPartyNavState(
  ctx: PartyNavContext,
  opts?: { startEffectIndex?: number; startStashIndex?: number },
): PartyNavState {
  return {
    zone: "effects",
    effectIndex: clamp(opts?.startEffectIndex ?? 0, 0, ctx.effectCount - 1),
    stashIndex: ctx.stashCount > 0
      ? clamp(opts?.startStashIndex ?? 0, 0, ctx.stashCount - 1)
      : -1,
    actionIndex: ACTION_USE,
    sendIndex: 0,
  };
}

/** Drive the navigation state machine. Pure — produces a new state
 *  and an action describing what the caller should fire. */
export function reducePartyNav(
  state: PartyNavState,
  input: PartyNavInput,
  ctx: PartyNavContext,
): PartyNavResult {
  // Clamp on entry so we never operate on stale indices left over
  // from a previous render (a stash mutation could have shrunk the
  // list between the last reduce and this one).
  const s = clampState(state, ctx);

  if (input.kind === "reset") {
    return {
      state: initialPartyNavState(ctx),
      action: { kind: "none" },
      consumed: false,
    };
  }
  if (input.kind === "set-effect") {
    return {
      state: {
        ...s,
        zone: "effects",
        effectIndex: clamp(input.index, 0, Math.max(0, ctx.effectCount - 1)),
      },
      action: { kind: "none" },
      consumed: false,
    };
  }
  if (input.kind === "set-stash") {
    return {
      state: {
        ...s,
        zone: "stash",
        stashIndex: ctx.stashCount > 0
          ? clamp(input.index, 0, ctx.stashCount - 1)
          : -1,
      },
      action: { kind: "none" },
      consumed: false,
    };
  }
  if (input.kind === "set-action") {
    return {
      state: {
        ...s,
        zone: "actions",
        actionIndex: clamp(input.index, 0, 2),
      },
      action: { kind: "none" },
      consumed: false,
    };
  }

  // From here on out the input is a key press.
  const { key } = input;
  switch (s.zone) {
    case "effects":
      return reduceEffectsKey(s, key, ctx);
    case "stash":
      return reduceStashKey(s, key, ctx);
    case "actions":
      return reduceActionsKey(s, key, ctx);
    case "send":
      return reduceSendKey(s, key, ctx);
  }
}

// ── Per-zone reducers ──────────────────────────────────────────────

function reduceEffectsKey(
  s: PartyNavState,
  key: string,
  ctx: PartyNavContext,
): PartyNavResult {
  if (isDownKey(key)) {
    if (ctx.effectCount === 0) {
      // Empty effects list — Down jumps straight into the stash.
      return enterStash(s, ctx);
    }
    if (s.effectIndex >= ctx.effectCount - 1) {
      // Already on the last effect — Down spills into the stash.
      return enterStash(s, ctx);
    }
    return consumed({ ...s, effectIndex: s.effectIndex + 1 });
  }
  if (isUpKey(key)) {
    if (s.effectIndex <= 0) {
      // Top of the list — clamp (don't wrap up to the stash).
      return consumed(s);
    }
    return consumed({ ...s, effectIndex: s.effectIndex - 1 });
  }
  if (key === "Enter") {
    // Toggle the highlighted effect's active state. The "available"
    // check (roster unlocks this effect) is on the caller side —
    // we just emit the action.
    if (!ctx.effectAvailable) return consumed(s);
    return {
      state: s,
      action: { kind: "effect-toggle" },
      consumed: true,
    };
  }
  if (key === "Escape") {
    return { state: s, action: { kind: "close" }, consumed: false };
  }
  if (key === "Tab") {
    // Tab also walks into the stash for screen-reader users. Shift+Tab
    // is handled by the browser already since we don't intercept it.
    return enterStash(s, ctx);
  }
  return passthrough(s);
}

function reduceStashKey(
  s: PartyNavState,
  key: string,
  ctx: PartyNavContext,
): PartyNavResult {
  if (isDownKey(key)) {
    if (s.stashIndex < ctx.stashCount - 1) {
      return consumed({ ...s, stashIndex: s.stashIndex + 1 });
    }
    // Clamp at the bottom — Down at the last row stays put rather
    // than wrapping back to effects.
    return consumed(s);
  }
  if (isUpKey(key)) {
    if (s.stashIndex > 0) {
      return consumed({ ...s, stashIndex: s.stashIndex - 1 });
    }
    // Top of the stash — spill back into the effects list, landing
    // on the last effect (matches what feels like a single vertical
    // column to the player).
    return enterEffects(s, ctx, "last");
  }
  if (key === "Enter") {
    if (ctx.stashCount === 0 || s.stashIndex < 0) {
      return consumed(s);
    }
    // Open the actions submenu. Default to the first enabled
    // action so Enter twice doesn't bounce off a disabled Use.
    return consumed({
      ...s,
      zone: "actions",
      actionIndex: firstEnabledAction(ctx),
    });
  }
  // Direct accelerators — preserved from the original behavior so
  // power users don't lose their muscle memory.
  if (s.stashIndex >= 0) {
    if (key === "u" || key === "U") {
      if (!ctx.canUse) return consumed(s);
      return {
        state: s,
        action: { kind: "use" },
        consumed: true,
      };
    }
    if (key === "s" || key === "S") {
      if (!ctx.canSend) return consumed(s);
      return consumed({ ...s, zone: "send", sendIndex: 0 });
    }
    if (key === "x" || key === "X") {
      return {
        state: s,
        action: { kind: "examine-toggle" },
        consumed: true,
      };
    }
  }
  if (key === "Escape") {
    return { state: s, action: { kind: "close" }, consumed: false };
  }
  return passthrough(s);
}

function reduceActionsKey(
  s: PartyNavState,
  key: string,
  ctx: PartyNavContext,
): PartyNavResult {
  if (isRightKey(key) || isDownKey(key)) {
    // Cycle to the next enabled action. Disabled actions are skipped
    // so a player who can't Use the highlighted item can still tab to
    // Send / Examine without bouncing through dead entries.
    return consumed({
      ...s,
      actionIndex: nextEnabledAction(s.actionIndex, +1, ctx),
    });
  }
  if (isLeftKey(key) || isUpKey(key)) {
    return consumed({
      ...s,
      actionIndex: nextEnabledAction(s.actionIndex, -1, ctx),
    });
  }
  if (key === "Enter") {
    switch (s.actionIndex) {
      case ACTION_USE:
        if (!ctx.canUse) return consumed(s);
        return {
          state: { ...s, zone: "stash" },
          action: { kind: "use" },
          consumed: true,
        };
      case ACTION_SEND:
        if (!ctx.canSend) return consumed(s);
        return consumed({ ...s, zone: "send", sendIndex: 0 });
      case ACTION_EXAMINE:
        return {
          state: s,
          action: { kind: "examine-toggle" },
          consumed: true,
        };
    }
  }
  if (key === "Escape") {
    // Esc pops the submenu — back to the stash list.
    return consumed({ ...s, zone: "stash" });
  }
  // Direct hotkeys still work inside the action submenu.
  if (key === "u" || key === "U") {
    if (!ctx.canUse) return consumed(s);
    return {
      state: { ...s, zone: "stash" },
      action: { kind: "use" },
      consumed: true,
    };
  }
  if (key === "s" || key === "S") {
    if (!ctx.canSend) return consumed(s);
    return consumed({ ...s, zone: "send", sendIndex: 0 });
  }
  if (key === "x" || key === "X") {
    return {
      state: s,
      action: { kind: "examine-toggle" },
      consumed: true,
    };
  }
  return passthrough(s);
}

function reduceSendKey(
  s: PartyNavState,
  key: string,
  ctx: PartyNavContext,
): PartyNavResult {
  if (isDownKey(key)) {
    if (ctx.memberCount === 0) return consumed(s);
    return consumed({
      ...s,
      sendIndex: Math.min(ctx.memberCount - 1, s.sendIndex + 1),
    });
  }
  if (isUpKey(key)) {
    return consumed({ ...s, sendIndex: Math.max(0, s.sendIndex - 1) });
  }
  if (key === "Enter") {
    if (ctx.memberCount === 0) return consumed(s);
    const target = clamp(s.sendIndex, 0, ctx.memberCount - 1);
    return {
      state: { ...s, zone: "stash" },
      action: { kind: "send", memberIndex: target },
      consumed: true,
    };
  }
  if (key === "Escape") {
    return consumed({ ...s, zone: "actions" });
  }
  // Number-key shortcuts — 1..9 pick the matching roster slot
  // directly. Matches the original behavior so muscle memory is
  // preserved while also serving as a fast path for "I know exactly
  // who I want to send this to".
  const n = parseDigit(key);
  if (n != null && n >= 1 && n <= ctx.memberCount) {
    return {
      state: { ...s, zone: "stash" },
      action: { kind: "send", memberIndex: n - 1 },
      consumed: true,
    };
  }
  return passthrough(s);
}

// ── Helpers ────────────────────────────────────────────────────────

function consumed(state: PartyNavState): PartyNavResult {
  return { state, action: { kind: "none" }, consumed: true };
}
function passthrough(state: PartyNavState): PartyNavResult {
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

function parseDigit(key: string): number | null {
  if (key.length !== 1) return null;
  const c = key.charCodeAt(0);
  // ASCII '0'..'9'
  if (c >= 48 && c <= 57) return c - 48;
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function clampState(
  s: PartyNavState,
  ctx: PartyNavContext,
): PartyNavState {
  return {
    ...s,
    effectIndex: ctx.effectCount > 0
      ? clamp(s.effectIndex, 0, ctx.effectCount - 1)
      : 0,
    stashIndex: ctx.stashCount > 0
      ? clamp(s.stashIndex < 0 ? 0 : s.stashIndex, 0, ctx.stashCount - 1)
      : -1,
    actionIndex: clamp(s.actionIndex, 0, 2),
    sendIndex: ctx.memberCount > 0
      ? clamp(s.sendIndex, 0, ctx.memberCount - 1)
      : 0,
  };
}

/** Spill from the effects column into the stash column. Lands on
 *  whichever stash row the cursor last visited; on a fresh open
 *  that's row 0. When the stash is empty we stay put — Down at the
 *  last effect should NOT silently move focus into an empty list. */
function enterStash(s: PartyNavState, ctx: PartyNavContext): PartyNavResult {
  if (ctx.stashCount === 0) return consumed(s);
  const idx = s.stashIndex < 0 ? 0 : s.stashIndex;
  return consumed({ ...s, zone: "stash", stashIndex: idx });
}

/** Spill back into the effects column. `mode` lets the caller pick
 *  whether to land on the first row (a fresh entry) or the last row
 *  (the player just arrowed up from the stash and expects the cursor
 *  to land right above where they were). */
function enterEffects(
  s: PartyNavState,
  ctx: PartyNavContext,
  mode: "first" | "last",
): PartyNavResult {
  if (ctx.effectCount === 0) return consumed(s);
  const idx = mode === "last" ? ctx.effectCount - 1 : 0;
  return consumed({ ...s, zone: "effects", effectIndex: idx });
}

/** Pick the first action button that's currently enabled, falling
 *  back to Examine (always available) if neither Use nor Send is. */
function firstEnabledAction(ctx: PartyNavContext): number {
  if (ctx.canUse) return ACTION_USE;
  if (ctx.canSend) return ACTION_SEND;
  return ACTION_EXAMINE;
}

/** Step the action cursor by `delta` (+1 or -1), skipping over
 *  disabled entries. Examine is never disabled so the loop always
 *  finds a stopping place. */
function nextEnabledAction(
  cur: number,
  delta: number,
  ctx: PartyNavContext,
): number {
  let idx = cur;
  for (let i = 0; i < 3; i++) {
    idx = (idx + delta + 3) % 3;
    if (isActionEnabled(idx, ctx)) return idx;
  }
  return cur;
}

function isActionEnabled(idx: number, ctx: PartyNavContext): boolean {
  if (idx === ACTION_USE) return ctx.canUse;
  if (idx === ACTION_SEND) return ctx.canSend;
  return true; // Examine
}
