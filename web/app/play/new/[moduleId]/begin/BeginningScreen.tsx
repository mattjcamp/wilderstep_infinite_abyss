"use client";

/**
 * BeginningScreen — full-bleed presentation of the module description
 * + a "Press any key to begin" prompt.
 *
 * On commit:
 *   - reads the party draft from sessionStorage
 *   - reads the module's party.json (for start_position, avatar,
 *     gold, shared inventory, party effects) via StaticModuleSource
 *   - reads the module's characters.json so module-supplied slots can
 *     be resolved to their stat blocks
 *   - assembles the initial WorldSave
 *   - persists to localStorage
 *   - routes to /play/active
 *
 * Refresh / direct-link safety: if the sessionStorage draft is
 * missing (page reloaded after stash, opened in a new tab), the
 * screen offers a "Back to party formation" link rather than dropping
 * the player onto a half-built game.
 */

import { encodeModuleId } from "@/editor/moduleRoutes";
import { getModuleSource } from "@/data_model/sourceConfig";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import type { CharacterRecord } from "@/editor/CharacterSheet";
import { clockFromDate } from "@/battle/world/GameTime";
import { setActiveModule, loadModuleConfig } from "@/battle/world/Module";
import { saveWorld } from "@/play/save";
import { clearAllDungeonSessions } from "@/sim/dungeon/dungeonSession";
import { Soundtrack } from "@/audio/SoundtrackPlayer";
import type {
  SavedCharacterState,
  SavedPartyState,
  WorldSave,
} from "@/play/saveTypes";

interface PartyDraft {
  moduleId: string;
  slots: ReadonlyArray<
    | { kind: "module"; characterId: string }
    | { kind: "custom"; character: CharacterRecord }
  >;
}

interface ModulePartyDoc {
  start_position?: { map_id?: string; col?: number; row?: number };
  avatar?: string;
  gold?: number;
  roster?: string[];
  inventory?: Array<{ item: string; charges?: number }>;
}

/** sessionStorage key shape — must match the writer in PartyFormation. */
function draftKey(moduleId: string): string {
  return `wsia.play.draft.party.${moduleId}`;
}

/** Delay before the "press any key" hint fades in. Short enough that
 *  it doesn't feel like the page is broken; long enough that a quick
 *  enter-keypress doesn't immediately skip the description. */
const PROMPT_DELAY_MS = 1500;

export function BeginningScreen({
  moduleId,
  title: titleProp,
  description: descriptionProp,
}: {
  moduleId: string;
  /** Module title/description. Optional — absent for remote-catalog
   *  modules the build didn't know about; resolved client-side from
   *  the configured source's list(). */
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<PartyDraft | null | "loading">(
    "loading",
  );
  const [showPrompt, setShowPrompt] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guard the commit path — keypress + click both fire, want one run.
  const committedRef = useRef(false);

  // Module meta. The server page provides it for build-time-known
  // modules; remote-catalog modules resolve it here from the
  // configured source. Falls back to the raw id so the screen never
  // renders blank while (or if) the lookup fails.
  const [meta, setMeta] = useState<{
    title: string;
    description: string;
  } | null>(
    titleProp !== undefined
      ? { title: titleProp, description: descriptionProp ?? "" }
      : null,
  );
  useEffect(() => {
    if (meta) return;
    let cancelled = false;
    getModuleSource()
      .list()
      .then((all) => {
        if (cancelled) return;
        const m = all.find((x) => x.id === moduleId);
        setMeta({
          title: m?.title ?? moduleId,
          description: m?.description ?? "",
        });
      })
      .catch(() => {
        if (!cancelled) setMeta({ title: moduleId, description: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [meta, moduleId]);
  const title = meta?.title ?? moduleId;
  const description = meta?.description ?? "";

  // Pick up the draft on mount. sessionStorage is browser-only.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(draftKey(moduleId));
      if (raw == null) {
        setDraft(null);
        return;
      }
      setDraft(JSON.parse(raw) as PartyDraft);
    } catch {
      setDraft(null);
    }
  }, [moduleId]);

  // Seed the soundtrack as soon as the description screen mounts so
  // the playlist is ready to go before the player commits. Walks the
  // module's extends chain so a parent's default soundtrack still
  // reaches a child module that doesn't override. Attempt an
  // optimistic play() too — most browsers will refuse autoplay before
  // a user gesture, but the keydown/click handler below also kicks
  // play(), so the gesture-driven attempt will succeed. The
  // SoundtrackPlayer is a module-scope singleton, so the playback
  // survives the route transition into /play/active.
  useEffect(() => {
    const src = getModuleSource();
    let cancelled = false;
    void src
      .resolveModuleSoundtrack(moduleId)
      .then((list) => {
        if (cancelled) return;
        Soundtrack.setPlaylist(list);
        Soundtrack.play(); // best-effort — autoplay may reject
      })
      .catch(() => {
        // Silent — silence is fine if the manifest read fails.
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  // Fade in the "press any key" hint after a brief beat.
  useEffect(() => {
    if (draft === "loading" || draft == null) return;
    const t = window.setTimeout(() => setShowPrompt(true), PROMPT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [draft]);

  // Listen for any keypress or click → commit + advance. Bound only
  // once the prompt is visible so impatient mashing doesn't skip
  // past the description before the player's had a moment to read.
  useEffect(() => {
    if (!showPrompt) return;
    if (draft === "loading" || draft == null) return;

    const commit = async () => {
      if (committedRef.current) return;
      committedRef.current = true;
      setCommitting(true);
      try {
        const save = await assembleInitialSave(moduleId, draft);
        // Flush the in-memory dungeon session store before
        // committing the new save — a previous run in the same
        // tab could otherwise re-use its rolled dungeon layouts
        // here even though the new save's `dungeons: {}` map is
        // empty.
        clearAllDungeonSessions();
        saveWorld(save);
        // Clear the draft so a back-button trip doesn't replay.
        try {
          window.sessionStorage.removeItem(draftKey(moduleId));
        } catch {
          // Best-effort.
        }
        router.push("/play/active");
      } catch (e) {
        committedRef.current = false;
        setCommitting(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    // The keypress / click is the user gesture browsers want before
    // autoplay is allowed. Kick the soundtrack here BEFORE the
    // commit/await so the audio.play() call lands inside the same
    // tick as the user input — most browsers' "saw a gesture" flag
    // attaches per-tick, so deferring this to after the async
    // assembleInitialSave would miss the window.
    const kickAudio = () => {
      try {
        Soundtrack.play();
      } catch {
        // Silent — failure shouldn't block the commit.
      }
    };
    const onKey = () => {
      kickAudio();
      void commit();
    };
    const onClick = () => {
      kickAudio();
      void commit();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [showPrompt, draft, moduleId, router]);

  // No draft → the player likely refreshed or deep-linked here.
  // Route them back to party formation.
  if (draft === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <p className="text-parchment/65">
          No party assembly in progress for this module.
        </p>
        <Link
          href={`/play/new/${encodeModuleId(moduleId)}/party`}
          className="text-ember underline"
        >
          Form your party
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ink p-8 text-center">
      <div className="max-w-2xl">
        <h1 className="font-display text-5xl text-parchment">{title}</h1>
        {description ? (
          <p className="mt-8 whitespace-pre-line text-lg leading-relaxed text-parchment/75">
            {description}
          </p>
        ) : null}
      </div>

      <div className="mt-16 h-12">
        {error ? (
          <p className="text-red-300">{error}</p>
        ) : committing ? (
          <p className="text-parchment/65">Beginning…</p>
        ) : showPrompt ? (
          <p className="animate-pulse text-parchment/55">
            Press any key to begin
          </p>
        ) : null}
      </div>
    </main>
  );
}

/** Build the WorldSave from the party draft + the module's static
 *  data. Custom character slots carry their full record (we stash it
 *  into the save so the loader is self-contained); module slots are
 *  joined against the module's characters.json. */
async function assembleInitialSave(
  moduleId: string,
  draft: PartyDraft,
): Promise<WorldSave> {
  const src = getModuleSource();
  const [partyLayers, characterLayers] = await Promise.all([
    src.loadModelLayers(moduleId, "party"),
    src.loadModelLayers(moduleId, "characters"),
  ]);
  const party = (mergeModel(
    "party",
    partyLayers.inherited,
    partyLayers.ownFile,
  ) ?? {}) as ModulePartyDoc;
  const chars = (mergeModel(
    "characters",
    characterLayers.inherited,
    characterLayers.ownFile,
  ) ?? {}) as { characters?: CharacterRecord[] };
  const charactersById = new Map(
    (chars.characters ?? []).map((c) => [c.id, c]),
  );

  // Resolve each slot — module slots pull stats from characters.json,
  // custom slots are self-contained. Missing module ids fall through
  // to a synthetic placeholder so the game can boot rather than fail
  // hard on a typo'd id.
  const members: SavedCharacterState[] = [];
  const roster: string[] = [];
  for (const slot of draft.slots) {
    if (slot.kind === "custom") {
      const c = slot.character;
      members.push({
        id: c.id,
        custom: c,
        hp: c.hp,
        mp: c.mp,
        // Seed level + exp directly from the character record so the
        // Party screen + Character sheet read the right values on
        // first launch. Custom characters are CharacterRecords with
        // both fields required; module characters fall through the
        // `??` for the same defaults memberFromRaw would apply.
        level: c.level ?? 1,
        exp: c.exp ?? 0,
        inventory: [],
        effects: [],
      });
      roster.push(c.id);
    } else {
      const c = charactersById.get(slot.characterId);
      if (!c) {
        // Skip silently — the slot's id had no match in the module.
        // The party will be smaller than intended; the player can
        // recover by going back to formation.
        continue;
      }
      members.push({
        id: c.id,
        custom: null,
        hp: c.hp,
        mp: c.mp,
        // characters.json typically authors `level` (default 1)
        // and may author a starting `exp`. Honour both so a
        // designer who wants a high-level NPC joining the party
        // mid-adventure can ship that via the module.
        level: c.level ?? 1,
        exp: c.exp ?? 0,
        inventory: [],
        effects: [],
      });
      roster.push(c.id);
    }
  }

  // Seed the in-world clock from module.json's `settings.start_time`
  // (loaded via the v1battle ModuleConfig helper, which already knows
  // about `extends` chains through the `setActiveModule` switch). When
  // a module doesn't declare a start time, fall back to year 1 / Jan 1
  // / 12:00 PM — that's the epoch and lands the world at midday on
  // the first day. The clock advances per step from there.
  setActiveModule(moduleId);
  const moduleConfig = await loadModuleConfig().catch(() => null);
  const startTime = moduleConfig?.settings.startTime;
  const initialClock = startTime
    ? clockFromDate({
        year: startTime.year,
        month: startTime.month,
        day: startTime.day,
        hour: startTime.hour,
        minute: startTime.minute,
      })
    : { totalMinutes: 0 };

  const startPos = party.start_position ?? { col: 0, row: 0 };
  const savedParty: SavedPartyState = {
    currentMapId: startPos.map_id ?? "",
    col: startPos.col ?? 0,
    row: startPos.row ?? 0,
    avatar: party.avatar ?? "",
    gold: party.gold ?? 0,
    inventory: party.inventory ?? [],
    torch_steps: 0,
    infravision_active: false,
    // Fresh game — party starts on foot. The kernel's grid-scan
    // boat-spawn-cell heuristic still handles the "party started
    // on a boat tile" case; this just leaves the saved flags at
    // their defaults so the absence-of-value behavior triggers.
    onBoat: false,
    currentBoatSprite: null,
    roster,
    members,
  };

  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    moduleId,
    clockMinutes: initialClock.totalMinutes,
    party: savedParty,
    maps: {},
    dungeons: {},
    acceptedQuests: [],
    questStepProgress: {},
  };
}
