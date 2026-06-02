/**
 * PaintedQuestLog — in-canvas Quest Log screen, second of the inspector
 * overlays to be ported from React DOM to Phaser. Mirrors the visual
 * idiom set by `PaintedHelpScreen` (flat dark-ink panel, monospaced
 * parchment text, 1-pixel borders) so the two screens read as parts
 * of one UI family.
 *
 * Differs from the Help screen in two ways:
 *   1. Content is *data-driven*. The host hands the painter a fresh
 *      snapshot of quest state each time it opens — see `open(data)`.
 *      Pulling from the live save (which the Phaser scene mutates
 *      without re-rendering React) means the log always shows
 *      what just happened, not what the React tree last memoised.
 *   2. Content can overflow. A long playthrough may carry a dozen
 *      turned-in quests plus a few active ones. The painter clips the
 *      scrollable region with a geometry mask and translates the
 *      content container on mouse-wheel + arrow-key input. Past the
 *      content extents the offset clamps so you can't scroll into
 *      empty space.
 *
 * What it does NOT do:
 *   - Accept / turn in quests. Those flows live in the in-world
 *     QuestDialog overlay; the log is read-only.
 *   - Subscribe to save mutations. Re-opening the screen reads fresh
 *     data; while the screen is up, the world sim is paused via
 *     `overlaysOpenRef` and no quest state can change underneath us.
 */

import type Phaser from "phaser";

/** Step shape pulled out of the loosely-typed quest payload. The
 *  catalog's `SimQuestRef` type doesn't declare `steps` because the
 *  field comes straight from the per-module quest JSON, but every
 *  consumer (this screen, the React overlay, the kill-credit pass)
 *  reads it as `{ name?, description? }[]`. */
interface QuestStep {
  /** Stable per-step id (quest JSON `step.id`). Used to look the step
   *  up in the order-independent `questStepsDone` set so completion is
   *  tracked per-step, not by position. Optional for back-compat with
   *  test fixtures that omit it; the painter falls back to index. */
  id?: string;
  name?: string;
  description?: string;
}

/** The catalog payload shape the painter actually reads. We don't
 *  pin this to `SimQuestRef` from `@/sim/types` because (a) the
 *  catalog gives us extra fields like `steps` that aren't on the
 *  declared type and (b) keeping the painter's input local makes
 *  the unit tests trivial — they hand in plain objects. */
export interface PaintedQuestLogQuest {
  id: string;
  name: string;
  description?: string;
  steps?: QuestStep[];
}

export interface PaintedQuestLogData {
  quests: ReadonlyArray<PaintedQuestLogQuest>;
  acceptedQuests: ReadonlyArray<string>;
  /** `questId → highest step index reached` (0-based). When the value
   *  is `>= quest.steps.length` the quest's body is complete and the
   *  party just needs to return to the giver to claim rewards. */
  questStepProgress: Readonly<Record<string, number>>;
  /** `questId → completed step ids` — the order-independent record.
   *  When present this is authoritative for which steps render done;
   *  the painter falls back to `questStepProgress` (leading run) only
   *  for quests absent here. Lets the checklist show step 3 ticked
   *  while 1-2 are still open. */
  questStepsDone?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Quest ids whose rewards have been claimed. Surface them in the
   *  Completed section so the player can review finished adventures
   *  without losing them in the active queue. */
  turnedInQuests: ReadonlyArray<string>;
}

export interface PaintedQuestLogConfig {
  scene: Phaser.Scene;
  /** Internal canvas dimensions — the menu centers itself within
   *  these. The host's `PLAY_CANVAS_WIDTH` / `PLAY_CANVAS_HEIGHT`
   *  values. */
  canvasWidth: number;
  canvasHeight: number;
  /** Called when the user dismisses the screen (Q / Esc / click
   *  outside the panel / Close hint). Host flips its `questLogOpen`
   *  flag from this. */
  onClose: () => void;
  /** Depth band. Defaults to 2000 — same as the Help screen, since
   *  they're never co-visible. */
  depth?: number;
}

/* Palette + layout — pulled from `PaintedHelpScreen`'s constants so
 * the two painted screens stay visually consistent. If we add a
 * third we should hoist these into a shared module; two is still
 * fine to leave duplicated. */
const COLOR_BACKDROP = 0x000000;
const COLOR_BACKDROP_ALPHA = 0.6;
const COLOR_PANEL = 0x161629;
const COLOR_PANEL_BORDER = 0x4a4a5a;
const COLOR_HEADER_TEXT = "#e8c97a";
const COLOR_BODY_TEXT = "#dcdcc8";
const COLOR_DIM_TEXT = "#a0a098";
const COLOR_STATUS_REWARDS = "#e8c97a";
const COLOR_STATUS_COMPLETE = "#7dd3a3";
const COLOR_STATUS_TURNED_IN = "#a0a098";
// Per-step status colors. Picked to share family with the section
// tags (rewards-amber / complete-green / dim) so the player can
// pattern-match between "what's the quest doing" and "what's the
// current step doing" without re-learning a palette.
const COLOR_STEP_DONE = "#7dd3a3";
const COLOR_STEP_CURRENT = "#e8c97a";
const COLOR_STEP_PENDING = "#7a7a82";
const COLOR_ENTRY_BG = 0x1f1f33;
const COLOR_ENTRY_BORDER = 0x3a3a4a;
const FONT = "monospace";

const PANEL_WIDTH = 720;
const PANEL_HEIGHT = 600;
const PANEL_PADDING = 20;
const HEADER_HEIGHT = 44;
const SECTION_HEADER_HEIGHT = 22;
const ENTRY_INNER_PADDING = 8;
const ENTRY_SPACING = 6;
const SECTION_SPACING = 12;
const SCROLL_STEP_WHEEL = 30;
const SCROLL_STEP_KEY = 40;

/** One quest entry's painted geometry. Captured during paint so the
 *  scroll bookkeeping (content height, clamp) knows where each entry
 *  lives without re-measuring. */
interface PaintedEntryGeometry {
  height: number;
}

/** Painted Quest Log screen. One instance per Phaser scene. */
export class PaintedQuestLog {
  private readonly scene: Phaser.Scene;
  private readonly canvasWidth: number;
  private readonly canvasHeight: number;
  private readonly onCloseCallback: () => void;
  private readonly depth: number;

  /** Root container for the whole screen. Null when closed. */
  private root: Phaser.GameObjects.Container | null = null;
  /** Inner container that holds the scrolling section/entry rows.
   *  Translated by `scrollOffset` to scroll. Separate from `root`
   *  because the backdrop + panel + header + close hint don't
   *  scroll — only the content area does. */
  private content: Phaser.GameObjects.Container | null = null;
  /** Vertical pixel offset for `content`. Always `<= 0` — moving the
   *  content up means a negative y on the container. Clamped to
   *  `[-(contentHeight - viewportHeight), 0]`. */
  private scrollOffset = 0;
  private contentHeight = 0;
  private viewportHeight = 0;
  private viewportY = 0;
  /** Wheel listener — installed via `scene.input.on('wheel', ...)`
   *  on open, removed in close. Kept as a field so the exact
   *  reference can be detached. */
  private wheelListener:
    | ((
        pointer: Phaser.Input.Pointer,
        objects: Phaser.GameObjects.GameObject[],
        deltaX: number,
        deltaY: number,
      ) => void)
    | null = null;
  private keyListener: ((ev: KeyboardEvent) => void) | null = null;

  constructor(cfg: PaintedQuestLogConfig) {
    this.scene = cfg.scene;
    this.canvasWidth = cfg.canvasWidth;
    this.canvasHeight = cfg.canvasHeight;
    this.onCloseCallback = cfg.onClose;
    this.depth = cfg.depth ?? 2000;
  }

  isOpen(): boolean {
    return this.root !== null;
  }

  /** Paint the screen with the given data and start listening for
   *  close keys + scroll input. No-op when already open (a double-Q
   *  press while open is benign — the host's `overlaysOpenRef` gating
   *  prevents it anyway, but the no-op keeps `open()` symmetric with
   *  the Help screen). */
  open(data: PaintedQuestLogData): void {
    if (this.root) return;

    const panelX = Math.floor((this.canvasWidth - PANEL_WIDTH) / 2);
    const panelY = Math.floor((this.canvasHeight - PANEL_HEIGHT) / 2);

    const root = this.scene.add.container(0, 0);
    root.setDepth(this.depth);
    root.setScrollFactor(0);
    this.root = root;

    // Full-canvas backdrop — same idiom as PaintedHelpScreen. A
    // click anywhere on it closes; the panel's own `setInteractive`
    // swallows click-throughs so the backdrop only fires on the
    // visible edges.
    const backdrop = this.scene.add
      .rectangle(
        0,
        0,
        this.canvasWidth,
        this.canvasHeight,
        COLOR_BACKDROP,
        COLOR_BACKDROP_ALPHA,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setInteractive();
    backdrop.on("pointerdown", () => this.requestClose());
    root.add(backdrop);

    const panel = this.scene.add
      .rectangle(panelX, panelY, PANEL_WIDTH, PANEL_HEIGHT, COLOR_PANEL, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(1, COLOR_PANEL_BORDER)
      .setInteractive();
    root.add(panel);

    // Header.
    const headerText = this.scene.add
      .text(panelX + PANEL_PADDING, panelY + 12, "QUEST LOG", {
        fontFamily: FONT,
        fontSize: "14px",
        color: COLOR_HEADER_TEXT,
        fontStyle: "bold",
      })
      .setScrollFactor(0);
    root.add(headerText);
    const closeHint = this.scene.add
      .text(
        panelX + PANEL_WIDTH - PANEL_PADDING,
        panelY + 12,
        "[Q / Esc to close]",
        {
          fontFamily: FONT,
          fontSize: "11px",
          color: COLOR_DIM_TEXT,
        },
      )
      .setOrigin(1, 0)
      .setScrollFactor(0);
    root.add(closeHint);
    const headerRule = this.scene.add
      .rectangle(
        panelX + PANEL_PADDING,
        panelY + 32,
        PANEL_WIDTH - PANEL_PADDING * 2,
        1,
        COLOR_PANEL_BORDER,
        1,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0);
    root.add(headerRule);

    // Viewport — the rectangle inside the panel that the scrolling
    // content is clipped to. Captured here so the mask geometry +
    // scroll clamp share one source of truth.
    this.viewportY = panelY + HEADER_HEIGHT;
    this.viewportHeight = PANEL_HEIGHT - HEADER_HEIGHT - PANEL_PADDING / 2;

    // Bucket the quests three ways: in-progress (active steps left),
    // complete-rewards-pending (all steps done, not turned in), and
    // turned in. Matches the React version's grouping.
    const buckets = bucketQuests(data);

    // Paint into a nested container so scroll is one `setPosition`
    // call. The container starts at `viewportY` with offset 0.
    const content = this.scene.add.container(
      panelX + PANEL_PADDING,
      this.viewportY,
    );
    content.setScrollFactor(0);
    root.add(content);
    this.content = content;

    let cursorY = 0;
    if (
      buckets.active.length === 0 &&
      buckets.pending.length === 0 &&
      buckets.turnedIn.length === 0 &&
      data.acceptedQuests.length === 0
    ) {
      // Empty state. Paint into `content` so it still gets clipped
      // by the mask (defensive — empty text never overflows but the
      // future me will thank us).
      const empty = this.scene.add
        .text(
          0,
          cursorY,
          "You haven't accepted any quests yet.\nLook for quest givers in towns and dungeons.",
          {
            fontFamily: FONT,
            fontSize: "12px",
            color: COLOR_DIM_TEXT,
            wordWrap: { width: PANEL_WIDTH - PANEL_PADDING * 2 },
          },
        )
        .setScrollFactor(0);
      content.add(empty);
      cursorY += empty.height + SECTION_SPACING;
    } else {
      cursorY = this.paintSection(
        content,
        cursorY,
        "ACTIVE",
        buckets.active,
        data,
        "active",
      );
      cursorY = this.paintSection(
        content,
        cursorY,
        "READY TO TURN IN",
        buckets.pending,
        data,
        "rewards-pending",
      );
      cursorY = this.paintSection(
        content,
        cursorY,
        "COMPLETED",
        buckets.turnedIn,
        data,
        "turned-in",
      );
    }
    this.contentHeight = cursorY;

    // Clip the content to the viewport rectangle. A geometry mask
    // built from an off-display Graphics is the right tool: it
    // doesn't render the mask shape itself, just uses it as a stencil
    // for the container.
    const maskGraphics = this.scene.make.graphics({ x: 0, y: 0 });
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(
      panelX + PANEL_PADDING / 2,
      this.viewportY,
      PANEL_WIDTH - PANEL_PADDING,
      this.viewportHeight,
    );
    content.setMask(maskGraphics.createGeometryMask());

    // Wheel listener — Phaser's input plugin emits `wheel` events
    // with a Y delta. We translate the content directly.
    this.installInputListeners(panel);
  }

  /** Tear down the painted objects + listeners. Does NOT fire
   *  `onClose` — same convention as PaintedHelpScreen. */
  close(): void {
    this.removeInputListeners();
    if (this.root) {
      // `destroy(true)` recursively destroys children, including the
      // content container and its geometry mask.
      this.root.destroy(true);
      this.root = null;
    }
    this.content = null;
    this.scrollOffset = 0;
    this.contentHeight = 0;
    this.viewportHeight = 0;
  }

  dispose(): void {
    this.close();
  }

  /** Current vertical scroll offset. Exposed for tests; production
   *  callers shouldn't reach in here. */
  getScrollOffset(): number {
    return this.scrollOffset;
  }

  /** Total painted content height. Same testing carve-out. */
  getContentHeight(): number {
    return this.contentHeight;
  }

  // ── Painting helpers ────────────────────────────────────────────

  private paintSection(
    content: Phaser.GameObjects.Container,
    startY: number,
    title: string,
    quests: ReadonlyArray<PaintedQuestLogQuest>,
    data: PaintedQuestLogData,
    state: "active" | "rewards-pending" | "turned-in",
  ): number {
    // Sections with no entries collapse entirely — same as the React
    // version's behavior. Keeps the empty Active or Completed buckets
    // from leaving a vestigial "ACTIVE" header with nothing below it.
    if (quests.length === 0) return startY;

    const header = this.scene.add
      .text(0, startY, title, {
        fontFamily: FONT,
        fontSize: "12px",
        color: COLOR_HEADER_TEXT,
        fontStyle: "bold",
      })
      .setScrollFactor(0);
    content.add(header);
    let cursorY = startY + SECTION_HEADER_HEIGHT;
    for (const q of quests) {
      const geom = this.paintEntry(
        content,
        cursorY,
        q,
        doneSetForQuest(data, q),
        state,
      );
      cursorY += geom.height + ENTRY_SPACING;
    }
    return cursorY + SECTION_SPACING - ENTRY_SPACING;
  }

  private paintEntry(
    content: Phaser.GameObjects.Container,
    startY: number,
    quest: PaintedQuestLogQuest,
    doneIds: ReadonlySet<string>,
    state: "active" | "rewards-pending" | "turned-in",
  ): PaintedEntryGeometry {
    // Pre-paint pass: figure out which text rows the entry will have
    // and how tall it ends up. Then paint the background rectangle
    // at the computed height, then the text on top. Done in two
    // passes because the rectangle has to be sized before the text
    // is added — Phaser Text is variable-height once `wordWrap` and
    // multi-line content are in play.
    const innerWidth = PANEL_WIDTH - PANEL_PADDING * 2 - ENTRY_INNER_PADDING * 2;
    const steps = quest.steps ?? [];
    const stepId = (i: number): string => steps[i]?.id ?? `__idx_${i}`;
    const doneCount = steps.reduce(
      (n, _s, i) => (doneIds.has(stepId(i)) ? n + 1 : n),
      0,
    );
    const complete = steps.length > 0 && doneCount >= steps.length;
    const statusColor = statusColorFor(state, complete);
    const statusLabel = statusLabelFor(state, complete, doneCount, steps.length);

    let rowY = startY + ENTRY_INNER_PADDING;
    const entryX = ENTRY_INNER_PADDING;

    // Name (left) + status tag (right). Painted first so subsequent
    // rows can stack underneath.
    const name = this.scene.add
      .text(entryX, rowY, quest.name, {
        fontFamily: FONT,
        fontSize: "13px",
        color: COLOR_BODY_TEXT,
        fontStyle: "bold",
      })
      .setScrollFactor(0);
    const tag = this.scene.add
      .text(PANEL_WIDTH - PANEL_PADDING * 2 - ENTRY_INNER_PADDING, rowY, statusLabel, {
        fontFamily: FONT,
        fontSize: "11px",
        color: statusColor,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0);
    const nameHeight = Math.max(name.height, tag.height);
    rowY += nameHeight + 2;

    let desc: Phaser.GameObjects.Text | null = null;
    if (quest.description) {
      desc = this.scene.add
        .text(entryX, rowY, quest.description, {
          fontFamily: FONT,
          fontSize: "11px",
          color: COLOR_DIM_TEXT,
          wordWrap: { width: innerWidth },
        })
        .setScrollFactor(0);
      rowY += desc.height + 2;
    }
    // Per-step list. Replaces the older "active step only" view —
    // quests aren't always tackled in order (a Detect-Traps step
    // might close while the party hasn't returned to the giver yet,
    // a quest with parallel kill steps can have steps 1 and 3 done
    // before step 2), and showing only the current pending step
    // gave the player no way to track which others were finished.
    //
    // Step status:
    //   i  < stepIdx                                   → done
    //   i == stepIdx (and quest not yet complete)      → current
    //   i  > stepIdx                                   → pending
    //
    // Turned-in + rewards-pending quests use `complete=true` which
    // flips every row to "done" regardless of stepIdx (those quests
    // have no remaining current step). Within the painted log we
    // also indent the steps slightly and show the current row's
    // description verbatim — past steps' descriptions are dropped
    // to keep the long-quest view scannable.
    // The "current" step (for the description hint + arrow glyph) is
    // the FIRST not-yet-done step. With out-of-order completion there
    // isn't a single linear cursor, so "first incomplete" is the most
    // useful single step to surface — it's what the player most likely
    // still needs to find. Completed quests have no current step.
    const firstIncompleteIdx = complete
      ? -1
      : steps.findIndex((_s, i) => !doneIds.has(stepId(i)));

    const stepTexts: Phaser.GameObjects.Text[] = [];
    if (steps.length > 0) {
      const stepIndent = entryX + 6;
      const stepInnerWidth = innerWidth - 6;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStatus = stepStatusFor(
          state,
          complete,
          doneIds.has(stepId(i)),
          i === firstIncompleteIdx,
        );
        const glyph =
          stepStatus === "done"
            ? "✓"
            : stepStatus === "current"
              ? "→"
              : "·";
        const color =
          stepStatus === "done"
            ? COLOR_STEP_DONE
            : stepStatus === "current"
              ? COLOR_STEP_CURRENT
              : COLOR_STEP_PENDING;
        const stepName = step?.name ?? `Step ${i + 1}`;
        const row = this.scene.add
          .text(stepIndent, rowY, `${glyph} ${stepName}`, {
            fontFamily: FONT,
            fontSize: "11px",
            color,
            wordWrap: { width: stepInnerWidth },
          })
          .setScrollFactor(0);
        stepTexts.push(row);
        rowY += row.height + 2;
        // Surface the description right below ONLY for the current
        // step (the one the player is actively working on). Done
        // steps' descriptions are noise; pending steps' descriptions
        // would spoil future objectives.
        if (stepStatus === "current" && step?.description) {
          const sub = this.scene.add
            .text(stepIndent + 14, rowY, step.description, {
              fontFamily: FONT,
              fontSize: "11px",
              color: COLOR_DIM_TEXT,
              fontStyle: "italic",
              wordWrap: { width: stepInnerWidth - 14 },
            })
            .setScrollFactor(0);
          stepTexts.push(sub);
          rowY += sub.height + 2;
        }
      }
    }

    const totalHeight =
      rowY - startY + ENTRY_INNER_PADDING - 2;

    // Now paint the background and add it FIRST in the container
    // ordering so the text renders on top. Phaser containers render
    // children in insertion order, so we add the rectangle then
    // re-add the text in the right order.
    const bg = this.scene.add
      .rectangle(
        0,
        startY,
        PANEL_WIDTH - PANEL_PADDING * 2,
        totalHeight,
        COLOR_ENTRY_BG,
        1,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(1, COLOR_ENTRY_BORDER);
    content.add(bg);
    content.add(name);
    content.add(tag);
    if (desc) content.add(desc);
    for (const t of stepTexts) content.add(t);

    return { height: totalHeight };
  }

  // ── Scroll plumbing ─────────────────────────────────────────────

  private scrollBy(deltaY: number): void {
    if (!this.content) return;
    const maxOffset = Math.max(0, this.contentHeight - this.viewportHeight);
    this.scrollOffset = Math.max(
      -maxOffset,
      Math.min(0, this.scrollOffset - deltaY),
    );
    this.content.setPosition(
      this.content.x,
      this.viewportY + this.scrollOffset,
    );
  }

  private installInputListeners(panel: Phaser.GameObjects.Rectangle): void {
    this.removeInputListeners();
    const wheelListener = (
      _pointer: Phaser.Input.Pointer,
      _objects: Phaser.GameObjects.GameObject[],
      _deltaX: number,
      deltaY: number,
    ) => {
      // The deltaY argument comes from Phaser's wheel adapter; sign
      // matches the DOM (positive = scrolling down). One "click" of
      // the wheel is typically deltaY ~= 100; we damp it to a tenth
      // of a line for steady reading.
      this.scrollBy(deltaY * (SCROLL_STEP_WHEEL / 100));
    };
    this.scene.input.on("wheel", wheelListener);
    // Stash the listener so close() can detach the exact reference.
    // (Phaser's `off` is a no-op when called with an arrow function
    // it doesn't have a reference to — every off() needs the same
    // closure that on() received.)
    this.wheelListener = wheelListener;
    void panel; // panel is reserved for future hit-test scoping

    const keyListener = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || ev.key === "q" || ev.key === "Q") {
        ev.stopPropagation();
        ev.preventDefault();
        this.requestClose();
      } else if (ev.key === "ArrowUp") {
        ev.stopPropagation();
        ev.preventDefault();
        this.scrollBy(-SCROLL_STEP_KEY);
      } else if (ev.key === "ArrowDown") {
        ev.stopPropagation();
        ev.preventDefault();
        this.scrollBy(SCROLL_STEP_KEY);
      } else if (ev.key === "PageUp") {
        ev.stopPropagation();
        ev.preventDefault();
        this.scrollBy(-this.viewportHeight);
      } else if (ev.key === "PageDown") {
        ev.stopPropagation();
        ev.preventDefault();
        this.scrollBy(this.viewportHeight);
      } else if (
        ev.key === "ArrowLeft" ||
        ev.key === "ArrowRight" ||
        ev.key === "w" ||
        ev.key === "a" ||
        ev.key === "s" ||
        ev.key === "d" ||
        ev.key === "W" ||
        ev.key === "A" ||
        ev.key === "S" ||
        ev.key === "D"
      ) {
        // Eat unrelated movement keys so the world sim doesn't
        // step under the modal. Belt-and-braces on top of
        // `overlaysOpenRef`.
        ev.stopPropagation();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", keyListener, { capture: true });
    }
    this.keyListener = keyListener;
  }

  private removeInputListeners(): void {
    if (this.wheelListener) {
      this.scene.input?.off?.("wheel", this.wheelListener);
      this.wheelListener = null;
    }
    if (this.keyListener && typeof window !== "undefined") {
      window.removeEventListener("keydown", this.keyListener, {
        capture: true,
      });
      this.keyListener = null;
    }
  }

  private requestClose(): void {
    this.close();
    this.onCloseCallback();
  }
}

// ── Standalone helpers ────────────────────────────────────────────

/** Bucket an `acceptedQuests` list against the catalog + progress
 *  state into the three display groups. Pure, testable, no Phaser
 *  contact — re-used by the painter's `open()` and by the unit
 *  tests directly. */
export function bucketQuests(data: PaintedQuestLogData): {
  active: PaintedQuestLogQuest[];
  pending: PaintedQuestLogQuest[];
  turnedIn: PaintedQuestLogQuest[];
} {
  const byId = new Map(data.quests.map((q) => [q.id, q]));
  const turnedInSet = new Set(data.turnedInQuests);
  const active: PaintedQuestLogQuest[] = [];
  const pending: PaintedQuestLogQuest[] = [];
  const turnedIn: PaintedQuestLogQuest[] = [];
  for (const id of data.acceptedQuests) {
    const q = byId.get(id);
    if (!q) continue;
    if (turnedInSet.has(id)) {
      turnedIn.push(q);
      continue;
    }
    const steps = q.steps ?? [];
    const done = doneSetForQuest(data, q);
    const complete =
      steps.length > 0 && steps.every((s, i) => done.has(s.id ?? `__idx_${i}`));
    if (complete) pending.push(q);
    else active.push(q);
  }
  return { active, pending, turnedIn };
}

/** Resolve the set of completed step ids for one quest. Prefers the
 *  authoritative `questStepsDone`; falls back to deriving from the
 *  legacy linear `questStepProgress` integer (first N step ids) for
 *  quests / saves that predate the per-step record. Index-based
 *  synthetic ids (`__idx_N`) mirror the credit path so fixtures and
 *  real data agree even when a step omits its `id`. */
function doneSetForQuest(
  data: PaintedQuestLogData,
  quest: PaintedQuestLogQuest,
): Set<string> {
  const steps = quest.steps ?? [];
  const explicit = data.questStepsDone?.[quest.id];
  if (explicit) return new Set(explicit);
  const n = data.questStepProgress[quest.id] ?? 0;
  const out = new Set<string>();
  for (let i = 0; i < Math.min(n, steps.length); i++) {
    out.add(steps[i].id ?? `__idx_${i}`);
  }
  return out;
}

function statusColorFor(
  state: "active" | "rewards-pending" | "turned-in",
  complete: boolean,
): string {
  if (state === "rewards-pending") return COLOR_STATUS_REWARDS;
  if (state === "turned-in") return COLOR_STATUS_TURNED_IN;
  if (complete) return COLOR_STATUS_COMPLETE;
  return COLOR_DIM_TEXT;
}

function statusLabelFor(
  state: "active" | "rewards-pending" | "turned-in",
  complete: boolean,
  doneCount: number,
  stepCount: number,
): string {
  if (state === "rewards-pending") return "Return to the giver";
  if (state === "turned-in") return "Turned in";
  if (complete) return "Complete";
  // Count of completed steps regardless of order (e.g. "1/4 steps"
  // even if the one done is step 3).
  if (stepCount > 0) return `${doneCount}/${stepCount} steps`;
  return "In progress";
}

/** Per-step status used by the painted entry. Order-independent: a
 *  step is "done" when its id is in the completed set, "current" when
 *  it's the first incomplete step (the one the player is most likely
 *  still hunting), and "pending" otherwise. Quests in `turned-in` /
 *  `rewards-pending` buckets — or any active quest flagged `complete`
 *  — render every step done. */
export function stepStatusFor(
  state: "active" | "rewards-pending" | "turned-in",
  complete: boolean,
  stepDone: boolean,
  isFirstIncomplete: boolean,
): "done" | "current" | "pending" {
  if (state === "turned-in" || state === "rewards-pending" || complete) {
    return "done";
  }
  if (stepDone) return "done";
  if (isFirstIncomplete) return "current";
  return "pending";
}
