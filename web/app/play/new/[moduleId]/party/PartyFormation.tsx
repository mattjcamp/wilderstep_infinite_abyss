"use client";

/**
 * PartyFormation — pick + create your adventuring party.
 *
 * The module ships a default roster in party.json. Each entry is a
 * slot here; the player can either keep the module-provided character
 * or replace the slot with one they build themselves via
 * CharacterCreator. Slots can't be added, removed, or reordered in
 * this first pass — the module decides party size.
 *
 * On "Begin", the assembled party (slot resolution + custom-character
 * records for any replaced slots) is stashed in sessionStorage so the
 * beginning-screen page can read it. Refreshing the page resets the
 * draft on purpose — it's a short flow, no need for persistence across
 * a hard reload.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { withBasePath } from "@/util/basePath";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  CharacterCreator,
  type RaceRecord,
  type ClassRecord,
  type AbilityRecord,
} from "@/editor/CharacterCreator";
import type { CharacterRecord } from "@/editor/CharacterSheet";

/** A resolved slot — either a reference to a module-supplied
 *  character by id, or a freshly built CharacterRecord the player
 *  rolled in CharacterCreator. The save layer treats these the same
 *  at write time; the loader joins module-id slots against the
 *  module's characters.json while custom slots are self-contained. */
type Slot =
  | { kind: "module"; characterId: string }
  | { kind: "custom"; character: CharacterRecord };

/** sessionStorage key shape — namespaced per module so two modules
 *  can hold concurrent drafts (e.g. tab-switching). */
function draftKey(moduleId: string): string {
  return `wsia.play.draft.party.${moduleId}`;
}

interface ModulePartyDoc {
  start_position?: { map_id?: string; col?: number; row?: number };
  avatar?: string;
  gold?: number;
  roster?: string[];
  party_effects?: unknown[];
  inventory?: Array<{ item: string; charges?: number }>;
}

interface LoadedCatalog {
  party: ModulePartyDoc;
  characters: CharacterRecord[];
  races: RaceRecord[];
  classes: ClassRecord[];
  abilities: AbilityRecord[];
}

export function PartyFormation({ moduleId }: { moduleId: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ok"; catalog: LoadedCatalog } | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [slots, setSlots] = useState<Slot[]>([]);
  /** Which slot index is currently being replaced. `null` = no inline
   *  creator open. Mutually exclusive — one creator at a time. */
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  // Load the module's party + character catalogs. Same pattern the
  // editor's CharactersBrowse uses, scoped down to the fields we
  // actually need for formation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = new StaticModuleSource();
        const [
          partyLayers,
          characterLayers,
          raceLayers,
          classLayers,
          abilityLayers,
        ] = await Promise.all([
          src.loadModelLayers(moduleId, "party"),
          src.loadModelLayers(moduleId, "characters"),
          src.loadModelLayers(moduleId, "races"),
          src.loadModelLayers(moduleId, "character_classes"),
          src.loadModelLayers(moduleId, "abilities"),
        ]);
        if (cancelled) return;
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
        const races = (mergeModel(
          "races",
          raceLayers.inherited,
          raceLayers.ownFile,
        ) ?? {}) as { races?: RaceRecord[] };
        const classes = (mergeModel(
          "character_classes",
          classLayers.inherited,
          classLayers.ownFile,
        ) ?? {}) as { character_classes?: ClassRecord[] };
        const abilities = (mergeModel(
          "abilities",
          abilityLayers.inherited,
          abilityLayers.ownFile,
        ) ?? {}) as { abilities?: AbilityRecord[] };
        const catalog: LoadedCatalog = {
          party,
          characters: chars.characters ?? [],
          races: races.races ?? [],
          classes: classes.character_classes ?? [],
          abilities: abilities.abilities ?? [],
        };
        setState({ kind: "ok", catalog });
        // Initial slot state: every roster id resolves to a module
        // slot. The player can replace any of them with a fresh
        // creation; refreshing the page resets to module defaults.
        setSlots(
          (catalog.party.roster ?? []).map((id) => ({
            kind: "module",
            characterId: id,
          })),
        );
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  // Map of module characters by id for O(1) slot resolution.
  const charactersById = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, CharacterRecord>();
    return new Map(state.catalog.characters.map((c) => [c.id, c]));
  }, [state]);

  // Ids already in use — passed to CharacterCreator so a freshly
  // rolled character can't collide with a module character or with
  // another slot's custom character. The creator suffixes a "_2" /
  // "_3" automatically if the player picks a name whose slug is taken.
  const usedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of charactersById.values()) ids.add(c.id);
    for (const s of slots) {
      if (s.kind === "custom") ids.add(s.character.id);
    }
    return ids;
  }, [charactersById, slots]);

  const onReplace = (idx: number, rec: CharacterRecord) => {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { kind: "custom", character: rec };
      return next;
    });
    setEditingIdx(null);
  };

  const onRevert = (idx: number) => {
    if (state.kind !== "ok") return;
    const originalId = state.catalog.party.roster?.[idx];
    if (!originalId) return;
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { kind: "module", characterId: originalId };
      return next;
    });
  };

  const onBegin = () => {
    if (state.kind !== "ok") return;
    if (typeof window === "undefined") return;
    // Stash the assembled party so the begin screen can write the
    // initial save. Custom characters carry their full record;
    // module slots carry just the id (the loader joins against
    // characters.json on the next page).
    const draft = {
      moduleId,
      slots,
    };
    try {
      window.sessionStorage.setItem(
        draftKey(moduleId),
        JSON.stringify(draft),
      );
    } catch {
      // Storage unavailable — fall through; the beginning screen will
      // detect the absent draft and route back here.
    }
    router.push(`/play/new/${moduleId}/begin`);
  };

  if (state.kind === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="text-parchment/55">Loading module data…</p>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8">
        <p className="text-red-300">Failed to load module: {state.message}</p>
        <Link href="/play/new" className="text-parchment/70 underline">
          Pick a different module
        </Link>
      </main>
    );
  }

  const { catalog } = state;
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <header>
        <h1 className="font-display text-3xl text-parchment">Form the Party</h1>
        <p className="mt-1 text-sm text-parchment/65">
          The module ships with a roster of {slots.length}{" "}
          {slots.length === 1 ? "adventurer" : "adventurers"}. Keep them, or
          replace any slot with someone you create.
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {slots.map((slot, idx) => (
          <li
            key={idx}
            className="rounded-md border border-parchment/20 bg-ink/40 p-4"
          >
            {editingIdx === idx ? (
              <div>
                <h2 className="mb-3 font-display text-lg text-parchment">
                  Create a new character for slot {idx + 1}
                </h2>
                <CharacterCreator
                  existingIds={usedIds}
                  races={catalog.races}
                  classes={catalog.classes}
                  abilities={catalog.abilities}
                  onComplete={(rec) => onReplace(idx, rec)}
                  onCancel={() => setEditingIdx(null)}
                />
              </div>
            ) : (
              <SlotSummary
                slot={slot}
                idx={idx}
                charactersById={charactersById}
                onEdit={() => setEditingIdx(idx)}
                onRevert={
                  slot.kind === "custom" ? () => onRevert(idx) : null
                }
              />
            )}
          </li>
        ))}
      </ul>

      <footer className="mt-2 flex items-center justify-between gap-4">
        <Link
          href="/play/new"
          className="text-sm text-parchment/55 underline hover:text-parchment/80"
        >
          Back to module picker
        </Link>
        <button
          type="button"
          onClick={onBegin}
          disabled={editingIdx !== null || slots.length === 0}
          className="rounded-md border border-parchment/40 bg-ember/90 px-8 py-2 text-parchment shadow transition hover:bg-ember disabled:cursor-not-allowed disabled:opacity-40"
        >
          Begin →
        </button>
      </footer>
    </main>
  );
}

function SlotSummary({
  slot,
  idx,
  charactersById,
  onEdit,
  onRevert,
}: {
  slot: Slot;
  idx: number;
  charactersById: Map<string, CharacterRecord>;
  onEdit: () => void;
  onRevert: (() => void) | null;
}) {
  const character: CharacterRecord | null =
    slot.kind === "custom"
      ? slot.character
      : charactersById.get(slot.characterId) ?? null;

  if (!character) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-red-300">
          Slot {idx + 1}: missing character{" "}
          <code className="text-xs">
            {slot.kind === "module" ? slot.characterId : "?"}
          </code>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="rounded border border-parchment/30 px-3 py-1 text-xs text-parchment/80 hover:bg-ink/50"
        >
          Create one
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <SpritePortrait sprite={character.sprite} />
      <div className="flex-1">
        <div className="font-display text-lg text-parchment">
          {character.name}
        </div>
        <div className="text-xs text-parchment/65">
          Lv {character.level} {character.race} {character.class}
          {slot.kind === "custom" ? " · new" : ""}
        </div>
        <div className="mt-1 text-xs text-parchment/45">
          HP {character.hp} · MP {character.mp} · STR {character.strength} DEX{" "}
          {character.dexterity} CON {character.constitution} INT{" "}
          {character.intelligence} WIS {character.wisdom}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded border border-parchment/30 px-3 py-1 text-xs text-parchment/80 hover:bg-ink/50"
        >
          Replace with new…
        </button>
        {onRevert ? (
          <button
            type="button"
            onClick={onRevert}
            className="rounded border border-parchment/15 px-3 py-1 text-xs text-parchment/55 hover:bg-ink/50"
          >
            Revert
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SpritePortrait({ sprite }: { sprite?: string }) {
  if (!sprite) {
    return (
      <div className="h-12 w-12 rounded border border-parchment/15 bg-ink/60" />
    );
  }
  // Sprites live under /sprites/. Bare keys ("person/foo.png") get
  // the prefix; anything starting with / passes through.
  const url = sprite.startsWith("/")
    ? withBasePath(sprite)
    : withBasePath(`/sprites/${sprite}`);
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      width={48}
      height={48}
      className="h-12 w-12 rounded border border-parchment/15 bg-ink/60"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
