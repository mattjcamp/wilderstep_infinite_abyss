/**
 * PaintedHelpScreen — the first of the in-game info screens painted
 * directly inside Phaser instead of as a React DOM modal over the
 * canvas. Replaces `PlayHelpTipsOverlay.tsx` and acts as the pattern-
 * setter for porting the rest of the inspector screens (party screen,
 * quest log, adventure log, …) over the same way.
 *
 * Why painted (vs. React modal):
 *   - Matches v1's look: monospaced text on a flat ink panel, sharp
 *     1-pixel borders, no rounded corners or CSS shadows. The world
 *     and the menu share a single render surface so the framing reads
 *     as one piece.
 *   - Fixed-resolution layout. The whole canvas is 960×720 and FIT-
 *     scaled by Phaser, so a menu painted in canvas pixels stays
 *     visually consistent at any window size — same idiom as v1.
 *   - Keystrokes are scoped to the scene's keyboard plugin. No
 *     window-level capture-phase listener fighting the sim's own
 *     handler.
 *
 * Scope (this screen only):
 *   - Static content: hand-curated shortcut tables + tip strings.
 *   - One interactive control surface: mute checkbox + volume slider
 *     for the soundtrack. Wired through an injected `soundtrack`
 *     dependency so tests can stub it out without touching the real
 *     audio module.
 *   - Two close paths: `H` or `Esc`. Both call back through `onClose`
 *     so the host can flip its `helpTipsOpen` flag.
 *
 * Lifecycle:
 *   - Construct once per Phaser scene. `open()` paints every object
 *     into a single container; `close()` destroys the container in
 *     one call. `dispose()` is for scene teardown.
 *   - The class owns the keyboard listener for its lifetime — it's
 *     installed in `open()` and removed in `close()`. The host's
 *     `overlaysOpenRef` gating is unchanged: as long as the host's
 *     boolean tracks open/close, the world sim stays frozen the same
 *     way it does for the React overlay today.
 */

import type Phaser from "phaser";

/** Subset of the Soundtrack module the help screen actually reads /
 *  writes. Defined here (not imported from `@/audio/SoundtrackPlayer`)
 *  so unit tests can inject a plain object without pulling the real
 *  module — which touches `window.localStorage` and an `<audio>` el
 *  at module import time. */
export interface PaintedHelpScreenSoundtrack {
  isMuted(): boolean;
  setMuted(v: boolean): void;
  getVolume(): number;
  setVolume(v: number): void;
}

export interface PaintedHelpScreenConfig {
  scene: Phaser.Scene;
  /** Internal canvas dimensions — the menu centers itself within
   *  these. The host's `PLAY_CANVAS_WIDTH` / `PLAY_CANVAS_HEIGHT`
   *  values. Required (no default) because the host owns the canvas
   *  size; falling back to `scene.scale.width` would track the
   *  scaled output instead of the internal pixel grid. */
  canvasWidth: number;
  canvasHeight: number;
  /** Soundtrack handle for the audio section. */
  soundtrack: PaintedHelpScreenSoundtrack;
  /** Called when the screen closes itself (H / Esc / Close button).
   *  The host flips its `helpTipsOpen` boolean from this. */
  onClose: () => void;
  /** Depth band for the painted objects. Defaults to 2000 — above
   *  the bottom log strip (1000) and any future in-world overlays.
   *  Exposed so a host that runs other always-on overlays at higher
   *  depths can push the menu above them. */
  depth?: number;
}

interface ShortcutRow {
  key: string;
  description: string;
}

/* Static content. Identical phrasing to the React overlay so muscle
 * memory carries over — these strings are the canonical reference
 * for keybindings in the game. */
const MOVE_SHORTCUTS: ShortcutRow[] = [
  { key: "Arrows", description: "Move the party one tile in that direction" },
  { key: "W A S D", description: "Alternate movement keys" },
];

const INSPECTOR_SHORTCUTS: ShortcutRow[] = [
  { key: "P", description: "Party screen — roster, gold, shared stash" },
  { key: "Q", description: "Quest log — active and completed quests" },
  { key: "L", description: "Adventure log — full message back-buffer" },
  { key: "H", description: "This help screen" },
];

const COMBAT_SHORTCUTS: ShortcutRow[] = [
  { key: "Arrows", description: "Move the cursor / step the combatant" },
  { key: "Enter", description: "Activate / pick a target" },
  { key: "Space", description: "End turn" },
  { key: "Esc", description: "Cancel the current sub-mode" },
  { key: "1 - 9", description: "Pick an option from a list" },
];

const TIPS: string[] = [
  "Torches and the Light spell brighten the party's light radius.",
  "Detect Traps reveals nearby trap tiles when a Thief is in the party.",
  "Boats stay where you leave them — step on to sail, step ashore to leave.",
  "Talk to NPCs by walking into them.",
  "Defeated lairs and placed encounters never respawn.",
];

/* v1-flavored palette. The bottom log strip already uses #161629 /
 * #dcdcc8 in the same scene, so the help screen reads as part of the
 * same UI family. */
const COLOR_BACKDROP = 0x000000;
const COLOR_BACKDROP_ALPHA = 0.6;
const COLOR_PANEL = 0x161629;
const COLOR_PANEL_BORDER = 0x4a4a5a;
const COLOR_HEADER_TEXT = "#e8c97a";
const COLOR_BODY_TEXT = "#dcdcc8";
const COLOR_DIM_TEXT = "#a0a098";
const COLOR_KEY_BG = 0x2a2a3a;
const COLOR_KEY_BORDER = 0x5a5a6a;
const COLOR_SLIDER_TRACK = 0x2a2a3a;
const COLOR_SLIDER_FILL = 0xc8a448;
const COLOR_SLIDER_BORDER = 0x5a5a6a;
const COLOR_CHECKBOX_BORDER = 0xa0a098;
const COLOR_CHECKBOX_FILL = 0xc8a448;
const FONT = "monospace";

/* Layout constants — fixed pixel measurements, sized for the 960×720
 * play canvas. Tweaking these is how the menu's proportions move. */
const PANEL_WIDTH = 720;
const PANEL_HEIGHT = 600;
const PANEL_PADDING = 20;
const SECTION_GAP = 14;
const ROW_HEIGHT = 18;
const KEY_COL_WIDTH = 100;
const SLIDER_WIDTH = 160;
const SLIDER_HEIGHT = 8;
const CHECKBOX_SIZE = 12;

/** Painted Help & Tips screen. One instance per Phaser scene. */
export class PaintedHelpScreen {
  private readonly scene: Phaser.Scene;
  private readonly canvasWidth: number;
  private readonly canvasHeight: number;
  private readonly soundtrack: PaintedHelpScreenSoundtrack;
  private readonly onCloseCallback: () => void;
  private readonly depth: number;

  /** Root container for all painted objects. `null` when closed. */
  private root: Phaser.GameObjects.Container | null = null;
  /** Active keyboard listener — kept as a field so `close()` can
   *  remove the exact same closure that `open()` registered. */
  private keyListener: ((ev: KeyboardEvent) => void) | null = null;
  /** Live volume value (`0..1`). Mirrors the soundtrack module so the
   *  slider can re-paint without re-querying every frame. Captured at
   *  open(); writes go through `applyVolume`. */
  private volume = 0;
  /** Live mute state. Same mirroring rationale as `volume`. */
  private muted = false;
  /** Refs to the interactive pieces so toggles + slider drags can
   *  update their visuals in place. Re-created each open(). */
  private checkboxFill: Phaser.GameObjects.Rectangle | null = null;
  private sliderFill: Phaser.GameObjects.Rectangle | null = null;
  private sliderHit: Phaser.GameObjects.Rectangle | null = null;
  private sliderTrackX = 0;

  constructor(cfg: PaintedHelpScreenConfig) {
    this.scene = cfg.scene;
    this.canvasWidth = cfg.canvasWidth;
    this.canvasHeight = cfg.canvasHeight;
    this.soundtrack = cfg.soundtrack;
    this.onCloseCallback = cfg.onClose;
    this.depth = cfg.depth ?? 2000;
  }

  /** Whether the screen is currently painted. */
  isOpen(): boolean {
    return this.root !== null;
  }

  /** Paint the screen and start listening for close keys. No-op when
   *  already open (a double-`H` press is benign). */
  open(): void {
    if (this.root) return;
    // Mirror the persisted audio state at open time so a refresh-then-
    // reopen shows the right values without us needing to subscribe.
    this.muted = this.soundtrack.isMuted();
    this.volume = this.soundtrack.getVolume();

    const panelX = Math.floor((this.canvasWidth - PANEL_WIDTH) / 2);
    const panelY = Math.floor((this.canvasHeight - PANEL_HEIGHT) / 2);

    const root = this.scene.add.container(0, 0);
    root.setDepth(this.depth);
    root.setScrollFactor(0);
    this.root = root;

    // Full-canvas backdrop. Catches clicks outside the panel so a
    // user clicking the world to "dismiss" actually closes the menu
    // instead of leaking through.
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

    // The panel itself — single rectangle with a 1px stroke matches
    // the bottom log strip's idiom.
    const panel = this.scene.add
      .rectangle(panelX, panelY, PANEL_WIDTH, PANEL_HEIGHT, COLOR_PANEL, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(1, COLOR_PANEL_BORDER)
      .setInteractive(); // swallow click-throughs so the backdrop's
    // own pointerdown only fires on the unobscured edges
    root.add(panel);

    // Header.
    const headerText = this.scene.add
      .text(panelX + PANEL_PADDING, panelY + 12, "HELP & TIPS", {
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
        "[H / Esc to close]",
        {
          fontFamily: FONT,
          fontSize: "11px",
          color: COLOR_DIM_TEXT,
        },
      )
      .setOrigin(1, 0)
      .setScrollFactor(0);
    root.add(closeHint);
    // Header underline — matches the log strip's flat 1px aesthetic.
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

    // Body — sections stack vertically from `cursorY`.
    let cursorY = panelY + 44;
    const sectionX = panelX + PANEL_PADDING;

    cursorY = this.paintAudioSection(root, sectionX, cursorY);
    cursorY = this.paintShortcutSection(
      root,
      sectionX,
      cursorY,
      "MOVEMENT",
      MOVE_SHORTCUTS,
    );
    cursorY = this.paintShortcutSection(
      root,
      sectionX,
      cursorY,
      "INSPECTOR SCREENS",
      INSPECTOR_SHORTCUTS,
    );
    cursorY = this.paintShortcutSection(
      root,
      sectionX,
      cursorY,
      "COMBAT",
      COMBAT_SHORTCUTS,
    );
    cursorY = this.paintTipsSection(root, sectionX, cursorY);

    // Close keybinding. `keydown-*` events fire even when nothing is
    // focused, and the scene's keyboard plugin scopes them to this
    // scene — but the play screen runs a single scene, so a plain
    // window-level listener is what actually matches the rest of the
    // host's input plumbing (see PlayHost inspector-key handler).
    this.installKeyListener();
  }

  /** Tear down the painted objects + keyboard listener. Calling
   *  `close()` does NOT fire `onClose` — that's reserved for the
   *  user-initiated paths (H/Esc/Close hint). The host can call
   *  `close()` directly to dismiss the screen on, e.g., a route
   *  change without echoing back through its own callback. */
  close(): void {
    this.removeKeyListener();
    if (this.root) {
      this.root.destroy(true);
      this.root = null;
    }
    this.checkboxFill = null;
    this.sliderFill = null;
    this.sliderHit = null;
  }

  /** Final teardown — same as `close()` but intended for scene
   *  shutdown. Kept as a separate name so a future "preserve state
   *  across re-opens" optimization has somewhere to grow. */
  dispose(): void {
    this.close();
  }

  // ── Painting helpers ────────────────────────────────────────────

  private paintAudioSection(
    root: Phaser.GameObjects.Container,
    x: number,
    y: number,
  ): number {
    const header = this.scene.add
      .text(x, y, "AUDIO", {
        fontFamily: FONT,
        fontSize: "12px",
        color: COLOR_HEADER_TEXT,
        fontStyle: "bold",
      })
      .setScrollFactor(0);
    root.add(header);
    const rowY = y + 18;

    // Mute checkbox — outline box + (optional) inner fill.
    const cb = this.scene.add
      .rectangle(x, rowY, CHECKBOX_SIZE, CHECKBOX_SIZE)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(1, COLOR_CHECKBOX_BORDER)
      .setInteractive();
    cb.on("pointerdown", () => this.toggleMute());
    root.add(cb);
    const cbFill = this.scene.add
      .rectangle(
        x + 2,
        rowY + 2,
        CHECKBOX_SIZE - 4,
        CHECKBOX_SIZE - 4,
        COLOR_CHECKBOX_FILL,
        this.muted ? 1 : 0,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0);
    root.add(cbFill);
    this.checkboxFill = cbFill;
    const cbLabel = this.scene.add
      .text(x + CHECKBOX_SIZE + 8, rowY - 1, "Mute soundtrack", {
        fontFamily: FONT,
        fontSize: "12px",
        color: COLOR_BODY_TEXT,
      })
      .setScrollFactor(0)
      .setInteractive();
    cbLabel.on("pointerdown", () => this.toggleMute());
    root.add(cbLabel);

    // Volume slider — track + clickable hit-zone + draggable thumb.
    const sliderX = x + 220;
    const sliderY = rowY + Math.floor(CHECKBOX_SIZE / 2) - 4;
    this.sliderTrackX = sliderX;
    const volLabel = this.scene.add
      .text(x + 180, rowY - 1, "Vol", {
        fontFamily: FONT,
        fontSize: "12px",
        color: COLOR_DIM_TEXT,
      })
      .setScrollFactor(0);
    root.add(volLabel);
    const track = this.scene.add
      .rectangle(
        sliderX,
        sliderY,
        SLIDER_WIDTH,
        SLIDER_HEIGHT,
        COLOR_SLIDER_TRACK,
        1,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(1, COLOR_SLIDER_BORDER);
    root.add(track);
    const fill = this.scene.add
      .rectangle(
        sliderX,
        sliderY,
        Math.max(1, Math.round(SLIDER_WIDTH * this.volume)),
        SLIDER_HEIGHT,
        COLOR_SLIDER_FILL,
        1,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0);
    root.add(fill);
    this.sliderFill = fill;

    // Hit-zone — covers a few pixels of vertical slop so the strip
    // is comfortably clickable at small canvas scales.
    const hit = this.scene.add
      .rectangle(sliderX, sliderY - 6, SLIDER_WIDTH, SLIDER_HEIGHT + 12)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setInteractive();
    hit.on(
      "pointerdown",
      (pointer: Phaser.Input.Pointer) => this.dragSlider(pointer),
    );
    hit.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown) this.dragSlider(pointer);
    });
    root.add(hit);
    this.sliderHit = hit;

    return rowY + 24 + SECTION_GAP;
  }

  private paintShortcutSection(
    root: Phaser.GameObjects.Container,
    x: number,
    y: number,
    title: string,
    rows: ShortcutRow[],
  ): number {
    const header = this.scene.add
      .text(x, y, title, {
        fontFamily: FONT,
        fontSize: "12px",
        color: COLOR_HEADER_TEXT,
        fontStyle: "bold",
      })
      .setScrollFactor(0);
    root.add(header);
    let rowY = y + 18;
    for (const row of rows) {
      // Key cell — small bordered box matching v1's "labelled keycap"
      // look. Filled with the same dark blue as the panel border.
      const keyBg = this.scene.add
        .rectangle(x, rowY - 2, KEY_COL_WIDTH - 12, 16, COLOR_KEY_BG, 1)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setStrokeStyle(1, COLOR_KEY_BORDER);
      root.add(keyBg);
      const keyText = this.scene.add
        .text(x + 4, rowY, row.key, {
          fontFamily: FONT,
          fontSize: "11px",
          color: COLOR_BODY_TEXT,
        })
        .setScrollFactor(0);
      root.add(keyText);
      const descText = this.scene.add
        .text(x + KEY_COL_WIDTH, rowY, row.description, {
          fontFamily: FONT,
          fontSize: "12px",
          color: COLOR_BODY_TEXT,
        })
        .setScrollFactor(0);
      root.add(descText);
      rowY += ROW_HEIGHT;
    }
    return rowY + SECTION_GAP - 4;
  }

  private paintTipsSection(
    root: Phaser.GameObjects.Container,
    x: number,
    y: number,
  ): number {
    const header = this.scene.add
      .text(x, y, "TIPS", {
        fontFamily: FONT,
        fontSize: "12px",
        color: COLOR_HEADER_TEXT,
        fontStyle: "bold",
      })
      .setScrollFactor(0);
    root.add(header);
    let rowY = y + 18;
    for (const tip of TIPS) {
      const bullet = this.scene.add
        .text(x, rowY, "•", {
          fontFamily: FONT,
          fontSize: "12px",
          color: COLOR_HEADER_TEXT,
        })
        .setScrollFactor(0);
      root.add(bullet);
      const tipText = this.scene.add
        .text(x + 14, rowY, tip, {
          fontFamily: FONT,
          fontSize: "12px",
          color: COLOR_BODY_TEXT,
          wordWrap: { width: PANEL_WIDTH - PANEL_PADDING * 2 - 14 },
        })
        .setScrollFactor(0);
      root.add(tipText);
      // Tip lines may wrap; advance by the painted text height.
      rowY += tipText.height + 4;
    }
    return rowY + SECTION_GAP;
  }

  // ── Interaction handlers ────────────────────────────────────────

  private toggleMute(): void {
    this.muted = !this.muted;
    this.soundtrack.setMuted(this.muted);
    if (this.checkboxFill) {
      this.checkboxFill.setAlpha(this.muted ? 1 : 0);
    }
  }

  private dragSlider(pointer: Phaser.Input.Pointer): void {
    // `pointer.x` is canvas-space (the scene's input plugin already
    // translates window coords into canvas pixels). Project onto the
    // track's range, clamp, write through.
    const rel = pointer.x - this.sliderTrackX;
    const ratio = Math.max(0, Math.min(1, rel / SLIDER_WIDTH));
    this.applyVolume(ratio);
  }

  private applyVolume(ratio: number): void {
    this.volume = ratio;
    this.soundtrack.setVolume(ratio);
    if (this.sliderFill) {
      this.sliderFill.width = Math.max(1, Math.round(SLIDER_WIDTH * ratio));
    }
  }

  // ── Keyboard plumbing ───────────────────────────────────────────

  private installKeyListener(): void {
    this.removeKeyListener();
    const listener = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || ev.key === "h" || ev.key === "H") {
        // Capture so the host's inspector-key listener doesn't also
        // see the H and immediately re-open. preventDefault keeps
        // Esc from triggering, e.g., a fullscreen exit.
        ev.stopPropagation();
        ev.preventDefault();
        this.requestClose();
      } else if (
        ev.key === "ArrowUp" ||
        ev.key === "ArrowDown" ||
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
        // Movement keys are eaten while the menu is open. The host's
        // `overlaysOpenRef` already gates the sim, but defense in
        // depth never hurts here.
        ev.stopPropagation();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", listener, { capture: true });
    }
    this.keyListener = listener;
  }

  private removeKeyListener(): void {
    if (this.keyListener && typeof window !== "undefined") {
      window.removeEventListener("keydown", this.keyListener, {
        capture: true,
      });
    }
    this.keyListener = null;
  }

  private requestClose(): void {
    this.close();
    this.onCloseCallback();
  }
}
