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

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import type { CharacterRecord } from "@/editor/CharacterSheet";
import { clockFromDate } from "@/battle/world/GameTime";
import { setActiveModule, loadModuleConfig } from "@/battle/world/Module";
import { saveWorld } from "@/play/save";
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
  title,
  description,
}: {
  moduleId: string;
  title: string;
  description: string;
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

    const onKey = () => {
      void commit();
    };
    const onClick = () => {
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
          href={`/play/new/${moduleId}/party`}
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
  const src = new StaticModuleSource();
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
    galadriels_light_steps: 0,
    infravision_active: false,
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
  };
}
