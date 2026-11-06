"use client";

/**
 * PlayLanding — title-screen client component.
 *
 * The screen is "connected" to the player's current adventure (a
 * playable module, default The Crystal Skull — see
 * src/play/currentAdventure.ts): its title and description headline
 * the screen, and New Game goes straight to party formation for it.
 * "Choose a New Adventure" (under the save slots) opens the picker;
 * whatever the player picks becomes the adventure shown here.
 *
 * Detects saves on mount (localStorage is browser-only):
 *
 *   - "Return to Game" resumes the auto-save (the running game).
 *   - Three manual slots (written in-game via ⌘S) each offer Load —
 *     loading promotes the slot to the active save and jumps in.
 *   - "Import Save" restores a previously exported .json file as the
 *     active game — the escape hatch for wiped browser data.
 *   - "Export" downloads the current auto-save as a .json file.
 *
 * Save metadata (module id, last-played time) is shown on every row
 * so the player knows what they'd be resuming.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  activateSlot,
  downloadSaveExport,
  installImportedSave,
  listSlotSaves,
  loadWorld,
  parseImportedSave,
} from "@/play/save";
import { Soundtrack } from "@/audio/SoundtrackPlayer";
import { withBasePath } from "@/util/basePath";
import { getModuleSource } from "@/data_model/sourceConfig";
import { TitleWanderers } from "./TitleWanderers";
import { useCatalog } from "@/play/ModuleGrid";
import { playPartyHref } from "@/play/playRoutes";
import {
  loadCurrentAdventureId,
  resolveCurrentAdventure,
} from "@/play/currentAdventure";
import {
  enterFullscreen,
  isFullscreen,
  toggleFullscreen,
} from "@/util/fullscreen";
import type { WorldSave } from "@/play/saveTypes";

/** Fades the title art's left/right edges and lower foreground into
 *  the page so it has no hard rectangle. */
const ART_MASK_IMAGE =
  "linear-gradient(to bottom, #000 60%, transparent 98%), " +
  "linear-gradient(to right, transparent 0%, #000 12%, #000 88%, transparent 100%)";
const ART_MASK: React.CSSProperties = {
  WebkitMaskImage: ART_MASK_IMAGE,
  WebkitMaskComposite: "source-in",
  maskImage: ART_MASK_IMAGE,
  maskComposite: "intersect",
};

/** Invisible backing in the page's own background color, feathered at
 *  the edges. It changes nothing on its own; it just hides wanderers
 *  passing behind the header and menu, so they fade out of view and
 *  reappear on the other side. */
const OCCLUDER_FEATHER =
  "linear-gradient(to right, transparent, #000 40px, #000 calc(100% - 40px), transparent), " +
  "linear-gradient(to bottom, transparent, #000 28px, #000 calc(100% - 28px), transparent)";
function Occluder() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -inset-x-12 -inset-y-8 -z-10 bg-[#0f0f1a]"
      style={{
        WebkitMaskImage: OCCLUDER_FEATHER,
        WebkitMaskComposite: "source-in",
        maskImage: OCCLUDER_FEATHER,
        maskComposite: "intersect",
      }}
    />
  );
}

/** sessionStorage flag: the player left fullscreen on purpose, so the
 *  title screen stops auto-entering it until they press F again. */
const WINDOWED_KEY = "wsia.play.windowed";

function formatWhen(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function PlayLanding() {
  const router = useRouter();
  // Tri-state to distinguish "still checking" from "no save" — without
  // it the Return button would flash on for a frame in the no-save
  // case as React hydrates the component.
  const [save, setSave] = useState<WorldSave | null | "loading">("loading");
  const [slots, setSlots] = useState<ReadonlyArray<WorldSave | null>>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const catalog = useCatalog();
  /** Remembered adventure id — read after mount (browser-only). */
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const adventure =
    catalog.kind === "ok" && preferredId !== null
      ? resolveCurrentAdventure(catalog.modules, preferredId)
      : null;
  const adventureReady = catalog.kind !== "loading" && preferredId !== null;
  /** Module id → title, so save rows read "The Crystal Skull" rather
   *  than a raw id. */
  const titleOf = (id: string): string =>
    (catalog.kind === "ok"
      ? catalog.modules.find((m) => m.id === id)?.title
      : undefined) ?? id;

  useEffect(() => {
    setPreferredId(loadCurrentAdventureId());
    setSave(loadWorld());
    setSlots(listSlotSaves());
    // Music: the effect below swaps in the current adventure's
    // soundtrack once it resolves, replacing whatever a previous
    // play-through left streaming. Fullscreen: see the effect below.
  }, []);

  // ── Fullscreen: the title screen runs fullscreen like the game, and F
  // toggles it. Browsers only allow fullscreen from a user gesture, so
  // we try on arrival (works when the player clicked their way here)
  // and otherwise on the first click / key press. If the player leaves
  // fullscreen (F, or holding Esc), we respect that for the rest of the
  // browser session instead of forcing them back in; F re-enters.
  useEffect(() => {
    const windowedByChoice = () => {
      try {
        return sessionStorage.getItem(WINDOWED_KEY) === "1";
      } catch {
        return false;
      }
    };
    const rememberWindowed = (windowed: boolean) => {
      try {
        if (windowed) sessionStorage.setItem(WINDOWED_KEY, "1");
        else sessionStorage.removeItem(WINDOWED_KEY);
      } catch {
        /* storage unavailable — only affects the auto-enter */
      }
    };
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      );
    };

    if (!windowedByChoice()) enterFullscreen();

    // First-gesture fallback (direct load / refresh).
    const autoEnter = (e: Event) => {
      // F is handled by the toggle below.
      if (e instanceof KeyboardEvent && e.key.toLowerCase() === "f") return;
      if (!windowedByChoice()) enterFullscreen();
      window.removeEventListener("pointerdown", autoEnter);
      window.removeEventListener("keydown", autoEnter);
    };
    window.addEventListener("pointerdown", autoEnter);
    window.addEventListener("keydown", autoEnter);

    // F toggles, as in the game.
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      rememberWindowed(isFullscreen());
      toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);

    // Leaving fullscreen any other way (Esc) also counts as a choice.
    const onChange = () => {
      if (!isFullscreen()) rememberWindowed(true);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);

    return () => {
      window.removeEventListener("pointerdown", autoEnter);
      window.removeEventListener("keydown", autoEnter);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const activeSave = save === "loading" ? null : save;

  // ── Title music: the current adventure's soundtrack (Module
  // Properties → soundtrack; falls back up the extends chain, the same
  // lookup the game uses). Browsers refuse audio before the player
  // interacts with the page, so we try right away and again on the
  // first click / key press. The track carries on into party
  // formation and the beginning screen (same playlist = no restart).
  const [hasMusic, setHasMusic] = useState(false);
  const [muted, setMutedState] = useState(false);
  useEffect(() => setMutedState(Soundtrack.isMuted()), []);
  const adventureId = adventure?.id ?? null;
  useEffect(() => {
    if (!adventureReady) return;
    if (!adventureId) {
      Soundtrack.stop();
      setHasMusic(false);
      return;
    }
    let cancelled = false;
    getModuleSource()
      .resolveModuleSoundtrack(adventureId)
      .then((list) => {
        if (cancelled) return;
        if (list.length === 0) {
          Soundtrack.stop();
          setHasMusic(false);
          return;
        }
        setHasMusic(true);
        Soundtrack.setPlaylist(list);
        Soundtrack.play(); // best-effort — autoplay may refuse
      })
      .catch(() => {
        /* silence is fine if the manifest can't be read */
      });
    return () => {
      cancelled = true;
    };
  }, [adventureReady, adventureId]);
  useEffect(() => {
    if (!hasMusic) return;
    const kick = () => Soundtrack.play();
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
  }, [hasMusic]);
  const toggleMuted = () => {
    const next = !muted;
    Soundtrack.setMuted(next);
    setMutedState(next);
    if (!next) Soundtrack.play();
  };

  const onLoadSlot = (slotNumber: number) => {
    // Loading replaces the running auto-save — warn when one exists
    // so a player doesn't silently lose an unslotted game.
    if (
      activeSave &&
      !window.confirm(
        "Loading this slot will replace your current game. " +
          "Save it to a slot first (⌘S in game) if you want to keep it. Continue?",
      )
    ) {
      return;
    }
    if (activateSlot(slotNumber)) {
      enterFullscreen();
      router.push("/play/active");
    }
  };

  const onImportFile = async (file: File) => {
    setImportError(null);
    const text = await file.text();
    const imported = parseImportedSave(text);
    if (!imported) {
      setImportError(
        "That file doesn't look like a Wilderstep save — import cancelled.",
      );
      return;
    }
    if (
      activeSave &&
      !window.confirm(
        "Importing will replace your current game. " +
          "Save it to a slot first (⌘S in game) if you want to keep it. Continue?",
      )
    ) {
      return;
    }
    if (installImportedSave(imported)) {
      enterFullscreen();
      router.push("/play/active");
    }
    else setImportError("Couldn't write the save — storage unavailable.");
  };

  return (
    <main className="relative isolate flex flex-1 flex-col items-center justify-center gap-10 p-8">
      {/* Music toggle — only when the adventure has a soundtrack. Shares
          the persisted mute setting with the in-game help screen. */}
      {hasMusic ? (
        <button
          type="button"
          onClick={toggleMuted}
          aria-pressed={!muted}
          title={muted ? "Turn the music on" : "Turn the music off"}
          className="absolute right-4 top-4 z-20 rounded-md border border-parchment/25 bg-ink/40 px-3 py-1 text-sm text-parchment/75 transition hover:bg-ink/20 hover:text-parchment"
        >
          {muted ? "♪ Music off" : "♪ Music on"}
        </button>
      ) : null}
      {/* Background life: people, animals and monsters wandering past.
          Drawn beneath the header and menu (z-0 vs z-10). */}
      <TitleWanderers />
      <header className="relative z-10 isolate max-w-2xl text-center">
        <Occluder />
        {/* Title art — the manual's cover scene recolored as parchment
            line art (docs/manual/build_play_art.py). Purely decorative;
            the mask fades its edges into the page. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withBasePath("/play-art/hero_lines.png")}
          alt=""
          aria-hidden="true"
          width={1626}
          height={584}
          className="mx-auto mb-4 block h-auto w-full max-w-2xl opacity-85"
          style={ART_MASK}
        />
        <p className="text-xs uppercase tracking-[0.3em] text-parchment/45">
          Wilderstep: Infinite Abyss
        </p>
        {/* The current adventure headlines the screen. Fixed min-height
            while it loads so the menu doesn't jump. */}
        <div className="mt-3 min-h-[3.5rem]">
          {!adventureReady ? null : adventure ? (
            <>
              <h1 className="font-display text-5xl text-parchment">
                {adventure.title}
              </h1>
              {adventure.description ? (
                <p className="mt-4 whitespace-pre-line leading-relaxed text-parchment/65">
                  {adventure.description}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h1 className="font-display text-5xl text-parchment">
                No adventure installed
              </h1>
              <p className="mt-4 text-parchment/60">
                {catalog.kind === "error"
                  ? "The adventure list couldn't be loaded."
                  : "There are no playable adventures yet."}
              </p>
            </>
          )}
        </div>
      </header>

      <nav className="relative z-10 isolate flex flex-col items-stretch gap-3 sm:min-w-[380px]">
        <Occluder />
        {/* Return to Game — only enabled when a save exists. While we
            * haven't checked yet ("loading"), render the button greyed
            * out so the layout doesn't shift after the effect runs. */}
        <ReturnButton save={save} titleOf={titleOf} />
        {/* New Game — starts a party for the current adventure. */}
        {adventure ? (
          <Link
            href={playPartyHref(adventure.id)}
            className="rounded-md border border-parchment/40 bg-ember/90 px-8 py-3 text-center text-lg text-parchment shadow transition hover:bg-ember"
          >
            New Game
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="rounded-md border border-parchment/20 bg-ink/60 px-8 py-3 text-lg text-parchment/30"
          >
            New Game
          </button>
        )}

        {/* Manual save slots — written in-game with ⌘S. Occupied
            slots load; empty slots render greyed out. */}
        <section className="mt-2 flex flex-col gap-2">
          <h2 className="text-center text-xs uppercase tracking-widest text-parchment/45">
            Save Slots
          </h2>
          {slots.map((slot, i) => {
            const n = i + 1;
            const when = formatWhen(slot?.savedAt);
            if (!slot) {
              return (
                <div
                  key={n}
                  className="flex items-baseline justify-between rounded-md border border-parchment/15 bg-ink/50 px-5 py-2 text-parchment/30"
                >
                  <span>Slot {n}</span>
                  <span className="text-xs">Empty</span>
                </div>
              );
            }
            return (
              <button
                key={n}
                type="button"
                onClick={() => onLoadSlot(n)}
                className="flex items-baseline justify-between gap-3 rounded-md border border-parchment/40 bg-ink/40 px-5 py-2 text-left text-parchment shadow transition hover:bg-ink/20"
              >
                <span>Slot {n}</span>
                <span className="text-xs text-parchment/55">
                  {titleOf(slot.moduleId)}
                  {when ? ` · ${when}` : ""}
                </span>
              </button>
            );
          })}
        </section>

        {/* Change which adventure this screen is connected to. */}
        <Link
          href="/play/new"
          className="rounded-md border border-amber-300/40 bg-ink/40 px-5 py-2 text-center text-parchment shadow transition hover:border-amber-300/70 hover:bg-ink/20"
        >
          Choose a New Adventure
        </Link>

        {/* Export / Import — file-based saves that survive cleared
            browser data. Export downloads the current auto-save;
            import restores a previously exported file. */}
        <div className="mt-1 flex items-stretch gap-2">
          <button
            type="button"
            disabled={!activeSave}
            onClick={() => {
              if (activeSave) downloadSaveExport(activeSave);
            }}
            title={
              activeSave
                ? "Download the current game as a JSON file"
                : "No current game to export"
            }
            className="flex-1 rounded-md border border-parchment/25 bg-ink/40 px-4 py-2 text-sm text-parchment/85 transition enabled:hover:bg-ink/20 disabled:border-parchment/15 disabled:text-parchment/30"
          >
            Export Save
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Restore a previously exported save file"
            className="flex-1 rounded-md border border-parchment/25 bg-ink/40 px-4 py-2 text-sm text-parchment/85 transition hover:bg-ink/20"
          >
            Import Save…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so picking the same file twice re-fires change.
              e.target.value = "";
              if (file) void onImportFile(file);
            }}
          />
        </div>
        {importError ? (
          <p className="text-center text-xs text-red-300">{importError}</p>
        ) : null}

        {/* Player's Manual as a "book" — same treatment as the home
            page: its cover page with a spine + drop shadow, opening the
            PDF in a new tab. Static assets aren't auto-basePath'd the
            way <Link> is, so prefix by hand. */}
        <a
          href={withBasePath("/manual.pdf")}
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-4 flex flex-col items-center gap-3 self-center"
          title="Open the Player's Manual (PDF)"
        >
          <span className="relative block w-32 overflow-hidden rounded-l-sm rounded-r-md shadow-xl shadow-black/50 ring-1 ring-parchment/15 transition duration-200 group-hover:-translate-y-1 group-hover:shadow-2xl">
            {/* book spine */}
            <span className="pointer-events-none absolute inset-y-0 left-0 z-10 w-2 bg-gradient-to-r from-black/45 via-black/15 to-transparent" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withBasePath("/manual-cover.png")}
              alt="Player's Manual"
              className="block w-full"
            />
          </span>
          <span className="text-sm uppercase tracking-wide text-parchment/65 transition group-hover:text-parchment">
            Player&apos;s Manual
          </span>
        </a>
      </nav>
    </main>
  );
}

function ReturnButton({
  save,
  titleOf,
}: {
  save: WorldSave | null | "loading";
  titleOf: (moduleId: string) => string;
}) {
  if (save === "loading") {
    return (
      <button
        type="button"
        disabled
        className="rounded-md border border-parchment/20 bg-ink/60 px-8 py-3 text-lg text-parchment/30"
      >
        Return to Game
      </button>
    );
  }
  if (save == null) {
    return (
      <button
        type="button"
        disabled
        title="No save found"
        className="rounded-md border border-parchment/20 bg-ink/60 px-8 py-3 text-lg text-parchment/30"
      >
        Return to Game
      </button>
    );
  }
  // Live save — link straight into the active game.
  const when = formatWhen(save.savedAt);
  return (
    <Link
      href="/play/active"
      onClick={() => enterFullscreen()}
      className="rounded-md border border-parchment/40 bg-ink/40 px-8 py-3 text-center text-lg text-parchment shadow transition hover:bg-ink/20"
    >
      <div>Return to Game</div>
      <div className="mt-1 text-xs text-parchment/55">
        {titleOf(save.moduleId)}
        {when ? ` · ${when}` : null}
      </div>
    </Link>
  );
}
