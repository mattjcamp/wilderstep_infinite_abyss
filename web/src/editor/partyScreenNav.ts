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
export type PartyNavZone =
  | "effects"
  | "stash"
  | "actions"
  | "send"
  | "roster";

/** Zones that live in the left-hand column of the screen. Tracked
 *  on the nav state as `lastLeftZone` so ArrowLeft out of the
 *  roster returns to whichever left-column list the cursor came
 *  from (effects vs. stash vs. the actions submenu). */
export type PartyNavLeftZone = "effects" | "stash" | "actions";

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
  /** Cursor in the roster (right-hand column) when the player has
   *  arrowed right out of the left column. Distinct from `sendIndex`
   *  — the roster zone is for opening a character sheet, send mode
   *  is for delivering a stash item to a character. */
  rosterIndex: number;
  /** Which left-column zone to fall back to when the cursor exits
   *  the roster via ArrowLeft. Updated whenever the cursor enters
   *  the roster so the back-trip lands on whichever list (effects,
   *  stash, or the actions submenu) the player came from. */
  lastLeftZone: PartyNavLeftZone;
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
  /** User clicked a roster card. Moves focus to the roster zone and
   *  parks the cursor on that card. Distinct from `set-send-target`
   *  (which would be the send-mode equivalent) — clicks during send
   *  mode are still routed through the existing onSendStashItem
   *  callback path, the reducer doesn't see them. */
  | { kind: "set-roster"; index: number }
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
  /** Drill into the focused roster member's character sheet. The
   *  component translates this into `setFocusedMemberId(m.id)`,
   *  which is what RosterCard.onOpen invokes today on click. */
  | { kind: "roster-drill-in"; memberIndex: number }
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
    rosterIndex: 0,
    lastLeftZone: "effects",
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
  if (input.kind === "set-roster") {
    return {
      state: {
        ...s,
        zone: "roster",
        rosterIndex: ctx.memberCount > 0
          ? clamp(input.index, 0, ctx.memberCount - 1)
          : 0,
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
    case "roster":
      return reduceRosterKey(s, key, ctx);
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
    // Enter on an effect row is a passthrough — we deliberately do
    // NOT consume the key. The component drives DOM focus onto the
    // selected effect's <button> whenever the effects zone owns the
    // cursor, so the browser's native "Enter on a focused button
    // dispatches click" behavior fires the button's onClick, which
    // toggles the effect via `toggleActive`. We tried emitting an
    // `effect-toggle` action here and calling preventDefault, but
    // that path proved brittle: focused-button click was preempted
    // by the preventDefault, the reducer-driven dispatch had a
    // closure / dep-array hole that sometimes fired stale state,
    // and the symptom was "press Return — nothing happens." Routing
    // through the native click path is a single source of truth
    // and gives us screen-reader + a11y semantics for free.
    return passthrough(s);
  }
  if (key === "Escape") {
    return { state: s, action: { kind: "close" }, consumed: false };
  }
  if (isRightKey(key)) {
    // Cross-column hop into the roster — remember we came from the
    // effects column so ArrowLeft will round-trip back here.
    return enterRoster(s, ctx, "effects");
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
  if (isRightKey(key)) {
    // Cross-column hop from the stash list into the roster. Same
    // round-trip semantics as the effects branch above.
    return enterRoster(s, ctx, "stash");
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
  if (isDownKey(key)) {
    // Cycle to the next enabled action. Disabled actions are skipped
    // so a player who can't Use the highlighted item can still tab to
    // Send / Examine without bouncing through dead entries.
    return consumed({
      ...s,
      actionIndex: nextEnabledAction(s.actionIndex, +1, ctx),
    });
  }
  if (isUpKey(key)) {
    return consumed({
      ...s,
      actionIndex: nextEnabledAction(s.actionIndex, -1, ctx),
    });
  }
  if (isRightKey(key)) {
    // Cross-column hop from the action submenu into the roster.
    // Mirrors the same behavior in effects + stash so Left/Right is
    // consistently "switch column" everywhere in the left pane. The
    // submenu's own up/down arrows handle cycling between actions.
    return enterRoster(s, ctx, "actions");
  }
  if (isLeftKey(key)) {
    // ArrowLeft from the submenu pops back out to the stash list —
    // gives the player a way to walk back up without pressing Esc.
    return consumed({ ...s, zone: "stash" });
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

function reduceRosterKey(
  s: PartyNavState,
  key: string,
  ctx: PartyNavContext,
): PartyNavResult {
  if (isDownKey(key)) {
    if (ctx.memberCount === 0) return consumed(s);
    return consumed({
      ...s,
      rosterIndex: Math.min(ctx.memberCount - 1, s.rosterIndex + 1),
    });
  }
  if (isUpKey(key)) {
    return consumed({
      ...s,
      rosterIndex: Math.max(0, s.rosterIndex - 1),
    });
  }
  if (isLeftKey(key)) {
    // Round-trip back to whichever left-column zone the cursor came
    // from. `lastLeftZone` was stamped when we entered the roster
    // (see `enterRoster`). The cursors in those zones haven't been
    // touched, so the player lands exactly where they left off.
    return consumed({ ...s, zone: s.lastLeftZone });
  }
  if (key === "Enter") {
    if (ctx.memberCount === 0) return consumed(s);
    const target = clamp(s.rosterIndex, 0, ctx.memberCount - 1);
    return {
      state: s,
      action: { kind: "roster-drill-in", memberIndex: target },
      consumed: true,
    };
  }
  if (key === "Escape") {
    // Esc bubbles out of the screen entirely — same as in the
    // effects/stash zones. We don't pop back to lastLeftZone on Esc
    // because the player's intent there is "close this view".
    return { state: s, action: { kind: "close" }, consumed: false };
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
    rosterIndex: ctx.memberCount > 0
      ? clamp(s.rosterIndex, 0, ctx.memberCount - 1)
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

/** Cross-column hop from a left-pane zone into the roster.
 *  `from` is stamped on `lastLeftZone` so ArrowLeft out of the
 *  roster lands back on the same zone. The rosterIndex is kept
 *  (clamped) so repeated round-trips don't reset the player's
 *  position in the right pane. */
function enterRoster(
  s: PartyNavState,
  ctx: PartyNavContext,
  from: PartyNavLeftZone,
): PartyNavResult {
  if (ctx.memberCount === 0) return consumed(s);
  const idx = clamp(s.rosterIndex, 0, ctx.memberCount - 1);
  return consumed({
    ...s,
    zone: "roster",
    rosterIndex: idx,
    lastLeftZone: from,
  });
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
