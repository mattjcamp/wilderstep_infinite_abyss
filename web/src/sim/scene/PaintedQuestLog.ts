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
 * Clipping: Phaser 4 dropped WebGL support for `setMask` +
 * GeometryMask (it silently renders unmasked), which let entries
 * bleed past the panel. Rather than a Mask filter (whose geometry has
 * to be kept in sync with the camera zoom), every content object is
 * registered as a "clip item" and `applyClip()` crops text / trims
 * rectangles against the visible window on every scroll + repaint.
 *
 * Collapsing: each quest's title row toggles it open / closed. The
 * main quest (`main_quest: true`) is pinned to a MAIN QUEST section.
 * Only the most recently taken quest that's still in progress (active
 * or ready to turn in) starts expanded; everything else — the main
 * quest included, unless it IS the newest — starts collapsed to a
 * title + current-step line so the full list scans at a glance. Once
 * the player expands or collapses a quest, that choice wins for the
 * life of the painter (the play session).
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
  /** Authored flag (quests.json `main_quest`). The main quest is
   *  pinned to its own section at the top of the log and starts
   *  expanded. One per module — if several are flagged, the first
   *  one found wins. */
  main_quest?: boolean;
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
/** Border of the keyboard-selected entry. */
const COLOR_ENTRY_SELECTED = 0xe8c97a;
const FONT = "monospace";

const PANEL_WIDTH = 720;
const PANEL_HEIGHT = 600;
const PANEL_PADDING = 20;
const HEADER_HEIGHT = 56;
const SECTION_HEADER_HEIGHT = 30;
const ENTRY_INNER_PADDING = 8;
const ENTRY_SPACING = 6;
const SECTION_SPACING = 12;
const SCROLL_STEP_WHEEL = 30;
const SCROLL_STEP_KEY = 40;

type EntryState = "active" | "rewards-pending" | "turned-in";

/** A painted content object plus its natural (unclipped) geometry in
 *  content-local coordinates. `applyClip()` hides, crops or trims each
 *  one against the visible window. `hit` items are the invisible
 *  click targets on quest title rows — only clickable while fully in
 *  view, so a header scrolled under the panel edge can't be toggled
 *  (and doesn't swallow clicks meant for the backdrop). */
interface ClipItem {
  obj: Phaser.GameObjects.GameObject;
  kind: "text" | "rect" | "hit";
  x: number;
  y: number;
  w: number;
  h: number;
  clickable?: boolean;
}

/** Painted Quest Log screen. One instance per Phaser scene. */
export class PaintedQuestLog {
  private readonly scene: Phaser.Scene;
  private canvasWidth: number;
  private canvasHeight: number;
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
  /** Snapshot handed to `open()`. Kept so a collapse toggle can
   *  repaint the content without the host re-supplying data. */
  private data: PaintedQuestLogData | null = null;
  /** Every painted content object, for `applyClip()`. */
  private clipItems: ClipItem[] = [];
  /** Player's explicit expand/collapse choices, keyed by quest id.
   *  Survives close / reopen. Absent → default (the most recent
   *  in-progress quest open, everything else collapsed). */
  private readonly expandedOverride = new Map<string, boolean>();
  /** Id of the quest pinned in the MAIN QUEST section on the last
   *  paint, so `toggleQuest` resolves its default state correctly. */
  private mainQuestId: string | null = null;
  /** The quest that's expanded by default — the most recently taken
   *  quest still in progress (see {@link mostRecentOpenQuestId}).
   *  Recomputed on every paint. */
  private defaultExpandedId: string | null = null;
  /** Quest entries in paint (= on-screen) order with their content-
   *  local geometry — the list the keyboard cursor walks. Rebuilt on
   *  every paint. */
  private entries: Array<{ id: string; y: number; h: number }> = [];
  /** Keyboard cursor: the selected quest's id. Up/Down move it, Enter
   *  / Space toggle it, Right / Left expand / collapse it. Null only
   *  when the log is empty. */
  private selectedId: string | null = null;
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
  /** DOM-level wheel listener (window, capture, non-passive). The
   *  PRIMARY wheel path: Phaser's `scene.input` wheel only fires when
   *  the pointer sits over the game canvas, and even then the page
   *  can scroll behind the modal. Listening on the window guarantees
   *  the log scrolls wherever the cursor is, and preventDefault stops
   *  the page from moving underneath. Its `stopPropagation` (capture
   *  phase) also keeps the Phaser listener from double-handling the
   *  same event when the pointer IS over the canvas. */
  private domWheelListener: ((ev: WheelEvent) => void) | null = null;
  private keyListener: ((ev: KeyboardEvent) => void) | null = null;
  /** Scrollbar track + thumb + hint — created hidden on open and
   *  shown by `updateScrollChrome` only while the content overflows
   *  (which can change as quests are expanded / collapsed). */
  private scrollTrack: Phaser.GameObjects.Rectangle | null = null;
  private scrollThumb: Phaser.GameObjects.Rectangle | null = null;
  private scrollHint: Phaser.GameObjects.Text | null = null;
  private scrollThumbTravel = 0;
  private scrollThumbY = 0;

  constructor(cfg: PaintedQuestLogConfig) {
    this.scene = cfg.scene;
    this.canvasWidth = cfg.canvasWidth;
    this.canvasHeight = cfg.canvasHeight;
    this.onCloseCallback = cfg.onClose;
    this.depth = cfg.depth ?? 2000;
  }

  /** The host's play frame changed shape (edge-to-edge play follows
   *  the window). Takes effect the next time the screen opens. */
  setCanvasSize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
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
    this.data = data;

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
        fontSize: "22px",
        color: COLOR_HEADER_TEXT,
        fontStyle: "bold",
      })
      .setScrollFactor(0);
    root.add(headerText);
    const closeHint = this.scene.add
      .text(
        panelX + PANEL_WIDTH - PANEL_PADDING,
        panelY + 8,
        "[Q / Esc to close]",
        {
          fontFamily: FONT,
          fontSize: "14px",
          color: COLOR_DIM_TEXT,
        },
      )
      .setOrigin(1, 0)
      .setScrollFactor(0);
    root.add(closeHint);
    // Scroll + collapse hint lives in the header (under the close
    // hint) rather than at the panel's foot, where it used to sit on
    // top of the last entry.
    const scrollHint = this.scene.add
      .text(
        panelX + PANEL_WIDTH - PANEL_PADDING,
        panelY + 25,
        "[↑↓ select · Enter expand · click title · wheel to scroll]",
        {
          fontFamily: FONT,
          fontSize: "12px",
          color: COLOR_DIM_TEXT,
        },
      )
      .setOrigin(1, 0)
      .setScrollFactor(0);
    root.add(scrollHint);
    this.scrollHint = scrollHint;
    const headerRule = this.scene.add
      .rectangle(
        panelX + PANEL_PADDING,
        panelY + 44,
        PANEL_WIDTH - PANEL_PADDING * 2,
        1,
        COLOR_PANEL_BORDER,
        1,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0);
    root.add(headerRule);

    // Viewport — the rectangle inside the panel that the scrolling
    // content is clipped to. Captured here so the clip + scroll
    // clamp share one source of truth.
    this.viewportY = panelY + HEADER_HEIGHT;
    this.viewportHeight = PANEL_HEIGHT - HEADER_HEIGHT - PANEL_PADDING / 2;

    // Paint into a nested container so scroll is one `setPosition`
    // call. The container starts at `viewportY` with offset 0.
    const content = this.scene.add.container(
      panelX + PANEL_PADDING,
      this.viewportY,
    );
    content.setScrollFactor(0);
    root.add(content);
    this.content = content;

    // Scrollbar on the panel's right edge — hidden until the content
    // overflows (see updateScrollChrome).
    const trackX = panelX + PANEL_WIDTH - 8;
    const track = this.scene.add
      .rectangle(trackX, this.viewportY, 3, this.viewportHeight, COLOR_PANEL_BORDER, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    root.add(track);
    this.scrollTrack = track;
    this.scrollThumbY = this.viewportY;
    const thumb = this.scene.add
      .rectangle(trackX, this.viewportY, 3, 24, 0xe8c97a, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    root.add(thumb);
    this.scrollThumb = thumb;

    this.paintContent();

    // Wheel + key listeners — the DOM wheel path is primary (works
    // wherever the cursor is); the Phaser listener is a fallback.
    this.installInputListeners(panel);
  }

  /** Tear down the painted objects + listeners. Does NOT fire
   *  `onClose` — same convention as PaintedHelpScreen. */
  close(): void {
    this.removeInputListeners();
    if (this.root) {
      // `destroy(true)` recursively destroys children, including the
      // content container.
      this.root.destroy(true);
      this.root = null;
    }
    this.content = null;
    this.data = null;
    this.clipItems = [];
    this.entries = [];
    this.selectedId = null;
    this.scrollTrack = null;
    this.scrollThumb = null;
    this.scrollHint = null;
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

  /** Id of the keyboard-selected quest (null when the log is empty).
   *  Exposed for tests. */
  getSelectedQuestId(): string | null {
    return this.selectedId;
  }

  /** Whether a quest's entry is currently expanded. */
  isQuestExpanded(questId: string): boolean {
    return this.isExpanded(questId);
  }

  /** Flip a quest between expanded and collapsed and repaint. Title
   *  row clicks route here; exposed for tests. */
  toggleQuest(questId: string): void {
    this.setExpanded(questId, !this.isQuestExpanded(questId));
  }

  private setExpanded(questId: string, expanded: boolean): void {
    this.selectedId = questId;
    if (this.isQuestExpanded(questId) === expanded) return;
    this.expandedOverride.set(questId, expanded);
    if (this.root) {
      this.paintContent();
      this.scrollSelectedIntoView();
    }
  }

  /** Move the keyboard cursor one entry up (-1) or down (+1). A long
   *  expanded entry that runs past the viewport edge scrolls first, so
   *  its whole body can be read with the arrows before the cursor
   *  moves on. With no entries this is a plain scroll. */
  private moveSelection(dir: -1 | 1): void {
    if (this.entries.length === 0) {
      this.scrollBy(dir * SCROLL_STEP_KEY);
      return;
    }
    const idx = this.entries.findIndex((e) => e.id === this.selectedId);
    const cur = idx >= 0 ? this.entries[idx] : null;
    if (cur) {
      const top = -this.scrollOffset;
      const bottom = top + this.viewportHeight;
      if (dir > 0 && cur.y + cur.h > bottom && cur.y < bottom) {
        this.scrollBy(SCROLL_STEP_KEY);
        return;
      }
      if (dir < 0 && cur.y < top && cur.y + cur.h > top) {
        this.scrollBy(-SCROLL_STEP_KEY);
        return;
      }
    }
    const next =
      idx < 0 ? 0 : Math.max(0, Math.min(this.entries.length - 1, idx + dir));
    if (idx === next) {
      // At the first/last entry — still nudge so the section header
      // above the first entry / padding below the last can show.
      this.scrollBy(dir * SCROLL_STEP_KEY);
      return;
    }
    this.selectedId = this.entries[next].id;
    this.paintContent();
    this.scrollSelectedIntoView(dir);
  }

  /** Scroll the minimum needed to bring the selected entry into view.
   *  Moving down an entry taller than the viewport aligns its top. */
  private scrollSelectedIntoView(dir: -1 | 1 = 1): void {
    const e = this.entries.find((x) => x.id === this.selectedId);
    if (!e) return;
    const top = -this.scrollOffset;
    const bottom = top + this.viewportHeight;
    // The first entry also reveals its section header above it.
    const y0 = e === this.entries[0] ? 0 : e.y;
    if (y0 < top) {
      this.setScroll(-y0);
    } else if (e.y + e.h > bottom) {
      const alignBottom = e.y + e.h - this.viewportHeight;
      this.setScroll(-(dir > 0 ? Math.min(e.y, alignBottom) : alignBottom));
    }
  }

  private isExpanded(questId: string): boolean {
    return (
      this.expandedOverride.get(questId) ?? questId === this.defaultExpandedId
    );
  }

  // ── Painting helpers ────────────────────────────────────────────

  /** (Re)build every object in the scrolling content area from
   *  `this.data`, then re-clamp the scroll, refresh the scrollbar and
   *  re-apply the clip. Called on open and on every collapse toggle;
   *  the scroll position is preserved where possible. */
  private paintContent(): void {
    const content = this.content;
    const data = this.data;
    if (!content || !data) return;
    content.removeAll(true);
    this.clipItems = [];
    this.entries = [];

    const buckets = pinMainQuest(bucketQuests(data));
    this.mainQuestId = buckets.main?.quest.id ?? null;
    this.defaultExpandedId = mostRecentOpenQuestId(data);

    let cursorY = 0;
    if (
      !buckets.main &&
      buckets.active.length === 0 &&
      buckets.pending.length === 0 &&
      buckets.turnedIn.length === 0 &&
      data.acceptedQuests.length === 0
    ) {
      const empty = this.scene.add
        .text(
          0,
          cursorY,
          "You haven't accepted any quests yet.\nLook for quest givers in towns and dungeons.",
          {
            fontFamily: FONT,
            fontSize: "18px",
            color: COLOR_DIM_TEXT,
            wordWrap: { width: PANEL_WIDTH - PANEL_PADDING * 2 },
          },
        )
        .setScrollFactor(0);
      this.addClipped(empty, "text");
      cursorY += empty.height + SECTION_SPACING;
    } else {
      if (buckets.main) {
        cursorY = this.paintSection(
          cursorY,
          "MAIN QUEST",
          [buckets.main.quest],
          data,
          buckets.main.state,
          true,
        );
      }
      cursorY = this.paintSection(cursorY, "ACTIVE", buckets.active, data, "active");
      cursorY = this.paintSection(
        cursorY,
        "READY TO TURN IN",
        buckets.pending,
        data,
        "rewards-pending",
      );
      cursorY = this.paintSection(
        cursorY,
        "COMPLETED",
        buckets.turnedIn,
        data,
        "turned-in",
      );
    }
    this.contentHeight = cursorY;
    // Keep the cursor on a quest that's still listed; otherwise land
    // on the first entry. If the selection changed, repaint once so
    // the highlight shows (cheap — only happens on open / data drift).
    if (!this.entries.some((e) => e.id === this.selectedId)) {
      const first = this.entries[0]?.id ?? null;
      if (first !== this.selectedId) {
        this.selectedId = first;
        if (first) {
          this.paintContent();
          return;
        }
      }
    }
    // Re-clamp + reposition (expanding near the bottom grows the
    // content; collapsing can shrink it below the current offset).
    this.setScroll(this.scrollOffset);
  }

  /** Add an object to the content container and register it for
   *  clipping at its current (content-local) geometry. */
  private addClipped(
    obj: Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle,
    kind: ClipItem["kind"],
  ): ClipItem {
    this.content?.add(obj);
    const item: ClipItem = {
      obj,
      kind,
      x: obj.x,
      y: obj.y,
      w: obj.width,
      h: obj.height,
      clickable: kind === "hit" ? true : undefined,
    };
    this.clipItems.push(item);
    return item;
  }

  private paintSection(
    startY: number,
    title: string,
    quests: ReadonlyArray<PaintedQuestLogQuest>,
    data: PaintedQuestLogData,
    state: EntryState,
    isMain = false,
  ): number {
    // Sections with no entries collapse entirely — same as the React
    // version's behavior. Keeps the empty Active or Completed buckets
    // from leaving a vestigial "ACTIVE" header with nothing below it.
    if (quests.length === 0) return startY;

    const header = this.scene.add
      .text(0, startY, title, {
        fontFamily: FONT,
        fontSize: "18px",
        color: COLOR_HEADER_TEXT,
        fontStyle: "bold",
      })
      .setScrollFactor(0);
    this.addClipped(header, "text");
    let cursorY = startY + SECTION_HEADER_HEIGHT;
    for (const q of quests) {
      const height = this.paintEntry(
        cursorY,
        q,
        doneSetForQuest(data, q),
        state,
        isMain,
      );
      cursorY += height + ENTRY_SPACING;
    }
    return cursorY + SECTION_SPACING - ENTRY_SPACING;
  }

  /** Paint one quest entry and return its height. Collapsed entries
   *  show the title row plus the current step's name; expanded ones
   *  add the quest description and every step with its details. */
  private paintEntry(
    startY: number,
    quest: PaintedQuestLogQuest,
    doneIds: ReadonlySet<string>,
    state: EntryState,
    isMain: boolean,
  ): number {
    // Text is measured before the background is sized, so collect the
    // rows first and add them after the background (containers render
    // in insertion order — bg must go in first to sit underneath).
    const entryWidth = PANEL_WIDTH - PANEL_PADDING * 2;
    const innerWidth = entryWidth - ENTRY_INNER_PADDING * 2;
    const steps = quest.steps ?? [];
    const stepId = (i: number): string => steps[i]?.id ?? `__idx_${i}`;
    const doneCount = steps.reduce(
      (n, _s, i) => (doneIds.has(stepId(i)) ? n + 1 : n),
      0,
    );
    const complete = steps.length > 0 && doneCount >= steps.length;
    const statusColor = statusColorFor(state, complete);
    const statusLabel = statusLabelFor(state, complete, doneCount, steps.length);
    const expanded = this.isExpanded(quest.id);

    let rowY = startY + ENTRY_INNER_PADDING;
    const entryX = ENTRY_INNER_PADDING;
    const rows: Phaser.GameObjects.Text[] = [];

    // Title row: disclosure glyph + (★ for the main quest) + name on
    // the left, status tag on the right. The name wraps short of the
    // tag so a long title can't run underneath it.
    const tag = this.scene.add
      .text(entryWidth - ENTRY_INNER_PADDING, rowY + 3, statusLabel, {
        fontFamily: FONT,
        fontSize: "15px",
        color: statusColor,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0);
    const titleText = `${expanded ? "▾" : "▸"} ${isMain ? "★ " : ""}${quest.name}`;
    const name = this.scene.add
      .text(entryX, rowY, titleText, {
        fontFamily: FONT,
        fontSize: "20px",
        color: isMain ? COLOR_HEADER_TEXT : COLOR_BODY_TEXT,
        fontStyle: "bold",
        wordWrap: { width: Math.max(120, innerWidth - tag.width - 16) },
      })
      .setScrollFactor(0);
    const titleHeight = Math.max(name.height, tag.height + 3);
    rowY += titleHeight + 2;

    // "Current" = first step not yet done (out-of-order completion
    // means there's no single linear cursor). Completed quests have
    // no current step.
    const firstIncompleteIdx = complete
      ? -1
      : steps.findIndex((_s, i) => !doneIds.has(stepId(i)));
    const stepIndent = entryX + 22;
    const stepInnerWidth = innerWidth - 22;

    if (expanded) {
      if (quest.description) {
        const desc = this.scene.add
          .text(entryX + 22, rowY, quest.description, {
            fontFamily: FONT,
            fontSize: "16px",
            color: COLOR_DIM_TEXT,
            wordWrap: { width: innerWidth - 22 },
          })
          .setScrollFactor(0);
        rows.push(desc);
        rowY += desc.height + 4;
      }
      // Full per-step checklist: every step with its description
      // (current step's detail in body color, the rest dim).
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStatus = stepStatusFor(
          state,
          complete,
          doneIds.has(stepId(i)),
          i === firstIncompleteIdx,
        );
        const row = this.paintStepRow(stepIndent, rowY, stepInnerWidth, step, i, stepStatus);
        rows.push(row);
        rowY += row.height + 2;
        if (step?.description) {
          const sub = this.scene.add
            .text(stepIndent + 14, rowY, step.description, {
              fontFamily: FONT,
              fontSize: "16px",
              color:
                stepStatus === "current" ? COLOR_BODY_TEXT : COLOR_DIM_TEXT,
              fontStyle: "italic",
              wordWrap: { width: stepInnerWidth - 14 },
            })
            .setScrollFactor(0);
          rows.push(sub);
          rowY += sub.height + 2;
        }
      }
    } else if (firstIncompleteIdx >= 0 && state === "active") {
      // Collapsed: just the step the player is working on, so the
      // list stays scannable but still says what to do next.
      const row = this.paintStepRow(
        stepIndent,
        rowY,
        stepInnerWidth,
        steps[firstIncompleteIdx],
        firstIncompleteIdx,
        "current",
      );
      rows.push(row);
      rowY += row.height + 2;
    }

    const totalHeight = rowY - startY + ENTRY_INNER_PADDING - 2;

    const bg = this.scene.add
      .rectangle(0, startY, entryWidth, totalHeight, COLOR_ENTRY_BG, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(
        quest.id === this.selectedId ? 2 : 1,
        quest.id === this.selectedId
          ? COLOR_ENTRY_SELECTED
          : isMain
            ? 0x8a7440
            : COLOR_ENTRY_BORDER,
      );
    this.addClipped(bg, "rect");
    this.entries.push({ id: quest.id, y: startY, h: totalHeight });
    this.addClipped(name, "text");
    this.addClipped(tag, "text");
    for (const t of rows) this.addClipped(t, "text");

    // Invisible click target over the title row (no fill → nothing
    // drawn). The repaint is deferred a tick so we don't destroy the
    // object whose pointerdown Phaser is still dispatching.
    const hit = this.scene.add
      .rectangle(0, startY, entryWidth, titleHeight + ENTRY_INNER_PADDING * 2)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    const hitItem = this.addClipped(hit, "hit");
    hit.on("pointerdown", () => {
      if (!hitItem.clickable) return;
      setTimeout(() => this.toggleQuest(quest.id), 0);
    });

    return totalHeight;
  }

  private paintStepRow(
    x: number,
    y: number,
    width: number,
    step: QuestStep | undefined,
    i: number,
    status: "done" | "current" | "pending",
  ): Phaser.GameObjects.Text {
    const glyph = status === "done" ? "✓" : status === "current" ? "→" : "·";
    const color =
      status === "done"
        ? COLOR_STEP_DONE
        : status === "current"
          ? COLOR_STEP_CURRENT
          : COLOR_STEP_PENDING;
    const stepName = step?.name ?? `Step ${i + 1}`;
    return this.scene.add
      .text(x, y, `${glyph} ${stepName}`, {
        fontFamily: FONT,
        fontSize: "16px",
        color,
        wordWrap: { width },
      })
      .setScrollFactor(0);
  }

  // ── Scroll + clip plumbing ──────────────────────────────────────

  private scrollBy(deltaY: number): void {
    this.setScroll(this.scrollOffset - deltaY);
  }

  /** Clamp + apply a scroll offset, then move the thumb and re-clip. */
  private setScroll(offset: number): void {
    if (!this.content) return;
    const maxOffset = Math.max(0, this.contentHeight - this.viewportHeight);
    this.scrollOffset = Math.max(-maxOffset, Math.min(0, offset));
    this.content.setPosition(
      this.content.x,
      this.viewportY + this.scrollOffset,
    );
    this.updateScrollChrome();
    this.applyClip();
  }

  /** Show / size / position the scrollbar for the current content. */
  private updateScrollChrome(): void {
    const overflow = this.contentHeight > this.viewportHeight;
    this.scrollTrack?.setVisible(overflow);
    this.scrollThumb?.setVisible(overflow);
    if (!overflow || !this.scrollThumb) return;
    const thumbH = Math.max(
      24,
      Math.floor(this.viewportHeight * (this.viewportHeight / this.contentHeight)),
    );
    this.scrollThumb.setSize(3, thumbH);
    this.scrollThumbTravel = this.viewportHeight - thumbH;
    const maxOffset = this.contentHeight - this.viewportHeight;
    const progress = maxOffset > 0 ? -this.scrollOffset / maxOffset : 0;
    this.scrollThumb.setPosition(
      this.scrollThumb.x,
      this.scrollThumbY + Math.round(progress * this.scrollThumbTravel),
    );
  }

  /** Hide / crop / trim every content object against the visible
   *  window `[-scrollOffset, -scrollOffset + viewportHeight]` (in
   *  content-local y). This is what keeps entries inside the panel. */
  private applyClip(): void {
    const top = -this.scrollOffset;
    const bottom = top + this.viewportHeight;
    for (const it of this.clipItems) {
      const y0 = it.y;
      const y1 = it.y + it.h;
      if (it.kind === "hit") {
        const clickable = y0 >= top && y1 <= bottom;
        if (clickable !== it.clickable) {
          it.clickable = clickable;
          const r = it.obj as Phaser.GameObjects.Rectangle;
          if (clickable) r.setInteractive({ useHandCursor: true });
          else r.disableInteractive();
        }
        continue;
      }
      const visible = y1 > top && y0 < bottom;
      const vis = it.obj as unknown as Phaser.GameObjects.Components.Visible;
      vis.setVisible(visible);
      if (!visible) continue;
      const c0 = Math.max(y0, top);
      const c1 = Math.min(y1, bottom);
      if (it.kind === "text") {
        const t = it.obj as Phaser.GameObjects.Text;
        if (c0 === y0 && c1 === y1) t.setCrop();
        else t.setCrop(0, c0 - y0, it.w, c1 - c0);
      } else {
        const r = it.obj as Phaser.GameObjects.Rectangle;
        r.setPosition(it.x, c0);
        r.setSize(it.w, c1 - c0);
      }
    }
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

    // PRIMARY wheel path: window-level, capture, non-passive. Phaser's
    // input plugin only sees wheel events when the pointer is over the
    // game canvas; players opening the log with Q often have the
    // cursor elsewhere (or over the DOM header strip), where wheeling
    // scrolled the PAGE behind the modal instead of the log. The
    // capture-phase stopPropagation also keeps the Phaser fallback
    // above from double-scrolling when the pointer IS over the canvas.
    if (typeof window !== "undefined") {
      const domWheelListener = (ev: WheelEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.scrollBy(ev.deltaY * (SCROLL_STEP_WHEEL / 100));
      };
      window.addEventListener("wheel", domWheelListener, {
        capture: true,
        passive: false,
      });
      this.domWheelListener = domWheelListener;
    }

    const keyListener = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || ev.key === "q" || ev.key === "Q") {
        ev.stopPropagation();
        ev.preventDefault();
        this.requestClose();
      } else if (ev.key === "ArrowUp" || ev.key === "w" || ev.key === "W") {
        ev.stopPropagation();
        ev.preventDefault();
        this.moveSelection(-1);
      } else if (ev.key === "ArrowDown" || ev.key === "s" || ev.key === "S") {
        ev.stopPropagation();
        ev.preventDefault();
        this.moveSelection(1);
      } else if (ev.key === "Enter" || ev.key === " ") {
        ev.stopPropagation();
        ev.preventDefault();
        if (this.selectedId) this.toggleQuest(this.selectedId);
      } else if (ev.key === "ArrowRight" || ev.key === "d" || ev.key === "D") {
        ev.stopPropagation();
        ev.preventDefault();
        if (this.selectedId) this.setExpanded(this.selectedId, true);
      } else if (ev.key === "ArrowLeft" || ev.key === "a" || ev.key === "A") {
        ev.stopPropagation();
        ev.preventDefault();
        if (this.selectedId) this.setExpanded(this.selectedId, false);
      } else if (ev.key === "PageUp") {
        ev.stopPropagation();
        ev.preventDefault();
        this.scrollBy(-this.viewportHeight);
      } else if (ev.key === "PageDown") {
        ev.stopPropagation();
        ev.preventDefault();
        this.scrollBy(this.viewportHeight);
      } else if (ev.key === "Home") {
        ev.stopPropagation();
        ev.preventDefault();
        this.scrollBy(-this.contentHeight);
      } else if (ev.key === "End") {
        ev.stopPropagation();
        ev.preventDefault();
        this.scrollBy(this.contentHeight);
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
    if (this.domWheelListener && typeof window !== "undefined") {
      window.removeEventListener("wheel", this.domWheelListener, {
        capture: true,
      });
      this.domWheelListener = null;
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

/** The most recently taken quest that's still in progress — active or
 *  waiting to be turned in — i.e. the last such id in `acceptedQuests`
 *  (which is kept in acceptance order). The quest log opens with only
 *  this one expanded. Null when nothing is in progress. */
export function mostRecentOpenQuestId(data: PaintedQuestLogData): string | null {
  const known = new Set(data.quests.map((q) => q.id));
  const turnedIn = new Set(data.turnedInQuests);
  for (let i = data.acceptedQuests.length - 1; i >= 0; i--) {
    const id = data.acceptedQuests[i];
    if (known.has(id) && !turnedIn.has(id)) return id;
  }
  return null;
}

/** Pull the main quest (`main_quest: true`) out of the active /
 *  ready-to-turn-in buckets so the painter can pin it at the top.
 *  Once turned in it stays in COMPLETED like any other quest. If
 *  several quests are flagged, the first active one wins (then the
 *  first pending one); the rest render in their normal sections. */
export function pinMainQuest(b: {
  active: PaintedQuestLogQuest[];
  pending: PaintedQuestLogQuest[];
  turnedIn: PaintedQuestLogQuest[];
}): {
  main: { quest: PaintedQuestLogQuest; state: EntryState } | null;
  active: PaintedQuestLogQuest[];
  pending: PaintedQuestLogQuest[];
  turnedIn: PaintedQuestLogQuest[];
} {
  const ai = b.active.findIndex((q) => q.main_quest === true);
  if (ai >= 0) {
    return {
      main: { quest: b.active[ai], state: "active" },
      active: b.active.filter((_q, i) => i !== ai),
      pending: b.pending,
      turnedIn: b.turnedIn,
    };
  }
  const pi = b.pending.findIndex((q) => q.main_quest === true);
  if (pi >= 0) {
    return {
      main: { quest: b.pending[pi], state: "rewards-pending" },
      active: b.active,
      pending: b.pending.filter((_q, i) => i !== pi),
      turnedIn: b.turnedIn,
    };
  }
  return { main: null, ...b };
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
