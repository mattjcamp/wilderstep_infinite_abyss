"use client";

/**
 * Characters-specific browse view. Dispatched to from
 * /editor/[moduleId]/[modelKey] when modelKey === "characters". Each
 * row is a character with a thumbnail + name + level/class/race
 * summary; expanding the row opens the full CharacterSheet inline.
 *
 * The CharacterSheet component is the reusable bit — same component
 * will mount in the game-side character-creation flow when it lands.
 * This file is the editor-side wrapper that loads characters + the
 * race / class catalogs, handles add / edit / delete, and persists
 * through the existing draft → publish pipeline.
 */

import { useEffect, useMemo, useState } from "react";
import {
  discardDraft,
  downloadJson,
  hasDraft,
  loadDraft,
  saveDraft,
} from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import { publishItems } from "@/data_model/publishClient";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  CharacterCreator,
  type AbilityRecord,
  type ClassRecord,
  type RaceRecord,
} from "./CharacterCreator";
import {
  CharacterSheet,
  type CharacterRecord,
} from "./CharacterSheet";
import {
  CharacterSheetSim,
  type SheetItemRef,
} from "./CharacterSheetSim";
import { resolveSpritePath } from "./spriteFields";
import { usePublishServer } from "./usePublishServer";

const MODEL_KEY = "characters";
const FILE_NAME = "characters.json";
const SPRITE_CONFIG = { category: "person", format: "path" } as const;

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      characters: CharacterRecord[];
      /** Full Race records (the CharacterCreator wizard reads
       *  `stat_modifiers`, `description`, and `abilities` off these). */
      races: RaceRecord[];
      /** Full Character Class records (the wizard reads `abilities`
       *  and `description` off these). */
      classes: ClassRecord[];
      /** Ability catalog — used to look up names + descriptions for
       *  the race-innate-ability and class-abilities lore cards. */
      abilities: AbilityRecord[];
      /** Item catalog — read by the CharacterSheetSim preview to
       *  resolve equipped item names and derive AC + damage. */
      items: SheetItemRef[];
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

export function CharactersBrowse({ moduleId }: { moduleId: string }) {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // ── Load characters + races + classes + abilities (draft-aware) ──
  const refresh = async () => {
    try {
      const src = new StaticModuleSource();
      const [
        charactersLayers,
        racesLayers,
        classesLayers,
        abilitiesLayers,
        itemsLayers,
      ] = await Promise.all([
        src.loadModelLayers(moduleId, "characters"),
        src.loadModelLayers(moduleId, "races"),
        src.loadModelLayers(moduleId, "character_classes"),
        src.loadModelLayers(moduleId, "abilities"),
        src.loadModelLayers(moduleId, "items"),
      ]);
      const draft = loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
      const ownEffective =
        draft ??
        (charactersLayers.ownFile as Record<string, unknown> | null);
      const merged = mergeModel(
        "characters",
        charactersLayers.inherited,
        ownEffective,
      ) as { characters?: CharacterRecord[] } | null;
      const characters = merged?.characters ?? [];

      const racesMerged = mergeModel(
        "races",
        racesLayers.inherited,
        racesLayers.ownFile,
      ) as { races?: RaceRecord[] } | null;
      const races = racesMerged?.races ?? [];

      const classesMerged = mergeModel(
        "character_classes",
        classesLayers.inherited,
        classesLayers.ownFile,
      ) as { character_classes?: ClassRecord[] } | null;
      const classes = classesMerged?.character_classes ?? [];

      const abilitiesMerged = mergeModel(
        "abilities",
        abilitiesLayers.inherited,
        abilitiesLayers.ownFile,
      ) as { abilities?: AbilityRecord[] } | null;
      const abilities = abilitiesMerged?.abilities ?? [];

      const itemsMerged = mergeModel(
        "items",
        itemsLayers.inherited,
        itemsLayers.ownFile,
      ) as { items?: SheetItemRef[] } | null;
      const items = itemsMerged?.items ?? [];

      setState({
        kind: "ok",
        characters,
        races,
        classes,
        abilities,
        items,
        ownFile: ownEffective ?? null,
        isDraft: hasDraft(moduleId, MODEL_KEY),
      });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  useEffect(() => {
    setState({ kind: "loading" });
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  // ── Mutators ───────────────────────────────────────────────────
  const persist = (updated: CharacterRecord[]) => {
    if (state.kind !== "ok") return;
    const baseFile: Record<string, unknown> = state.ownFile
      ? { ...state.ownFile }
      : { characters: [] };
    baseFile.characters = updated;
    saveDraft(moduleId, MODEL_KEY, baseFile);
    setState({
      ...state,
      characters: updated,
      ownFile: baseFile,
      isDraft: true,
    });
  };

  const onCreate = (rec: CharacterRecord) => {
    if (state.kind !== "ok") return;
    persist([...state.characters, rec]);
    setCreating(false);
    setExpanded((prev) => new Set(prev).add(rec.id));
  };

  const onDelete = (id: string) => {
    if (state.kind !== "ok") return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete character "${id}"?\n\nRemoves it from this module's characters file. Saves to the draft until you Publish.`,
      )
    )
      return;
    persist(state.characters.filter((c) => c.id !== id));
  };

  const onUpdate = (originalId: string, next: CharacterRecord) => {
    if (state.kind !== "ok") return;
    persist(
      state.characters.map((c) => (c.id === originalId ? next : c)),
    );
    // If the id changed mid-edit, update the expanded set to track
    // the new id so the row stays open.
    if (next.id !== originalId) {
      setExpanded((prev) => {
        const out = new Set(prev);
        out.delete(originalId);
        out.add(next.id);
        return out;
      });
    }
  };

  // ── Draft lifecycle ────────────────────────────────────────────
  const onDiscardDraft = () => {
    if (typeof window === "undefined") return;
    if (!hasDraft(moduleId, MODEL_KEY)) return;
    if (
      !window.confirm(
        "Discard all pending changes to this module's characters file?",
      )
    )
      return;
    discardDraft(moduleId, MODEL_KEY);
    refresh();
  };

  const onExport = () => {
    if (state.kind !== "ok" || !state.ownFile) return;
    downloadJson(FILE_NAME, state.ownFile);
  };

  const onPublish = async () => {
    if (state.kind !== "ok" || !state.ownFile) return;
    setPublishing(true);
    try {
      const res = await publishItems([
        {
          kind: "model",
          moduleId,
          modelKey: MODEL_KEY,
          fileName: FILE_NAME,
          content: state.ownFile,
        },
      ]);
      const r = res.results[0];
      if (!r.ok) {
        window.alert(`Publish failed: ${r.error}`);
        return;
      }
      discardDraft(moduleId, MODEL_KEY);
      await refresh();
    } catch (e) {
      window.alert(
        `Publish error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPublishing(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────
  const classNameById = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, string>();
    return new Map(state.classes.map((c) => [c.id, c.name ?? c.id]));
  }, [state]);
  const raceNameById = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, string>();
    return new Map(state.races.map((r) => [r.id, r.name ?? r.id]));
  }, [state]);

  // ── Render ─────────────────────────────────────────────────────
  if (state.kind === "loading") {
    return <p className="p-4 text-parchment/60">Loading characters…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load characters.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }

  const existingIds = new Set(state.characters.map((c) => c.id));
  const canExport = state.ownFile !== null;

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-parchment">Characters</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-parchment/60">
            <span>
              {state.characters.length} character
              {state.characters.length === 1 ? "" : "s"}
            </span>
            <span className="text-parchment/40">·</span>
            <span>{FILE_NAME}</span>
            {state.isDraft ? (
              <span className="rounded bg-ember/30 px-2 py-0.5 text-xs text-parchment/90">
                draft active
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50"
            >
              + New Character
            </button>
          ) : null}
          {state.isDraft ? (
            <button
              type="button"
              onClick={onDiscardDraft}
              className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/70 hover:bg-ink/40"
            >
              Discard
            </button>
          ) : null}
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport}
            className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/90 hover:bg-ink/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⬇ Export
          </button>
          {state.isDraft && publishAvailable === true ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={publishing}
              className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          ) : null}
        </div>
      </header>

      {creating ? (
        <div className="mt-4">
          <CharacterCreator
            existingIds={existingIds}
            races={state.races}
            classes={state.classes}
            abilities={state.abilities}
            onComplete={onCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      <ul className="mt-6 space-y-2">
        {state.characters.map((c) => {
          const isOpen = expanded.has(c.id);
          const klassLabel = classNameById.get(c.class) ?? c.class;
          const raceLabel = raceNameById.get(c.race) ?? c.race;
          const thumb = c.sprite
            ? resolveSpritePath(c.sprite, SPRITE_CONFIG)
            : null;
          return (
            <li
              key={c.id}
              className="overflow-hidden rounded border border-parchment/10 bg-ink/20"
            >
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleExpanded(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-parchment hover:text-parchment/100"
                >
                  <span className="text-parchment/55">
                    {isOpen ? "▾" : "▸"}
                  </span>
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt=""
                      width={24}
                      height={24}
                      style={{ imageRendering: "pixelated" }}
                      className="h-6 w-6 shrink-0 rounded border border-parchment/20 bg-ink/80 object-contain"
                    />
                  ) : (
                    <span className="h-6 w-6 shrink-0 rounded border border-parchment/20 bg-ink/80" />
                  )}
                  <span className="font-display">{c.name || c.id}</span>
                  <span className="font-mono text-xs text-parchment/45">
                    {c.id}
                  </span>
                  <span className="text-xs text-parchment/45">
                    · L{c.level} {klassLabel} · {raceLabel}{" "}
                    {c.gender ? `· ${c.gender}` : ""}
                  </span>
                  <span className="ml-2 text-xs text-parchment/40">
                    HP {c.hp} · MP {c.mp}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/60 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                  title="Delete this character."
                >
                  Delete
                </button>
              </div>
              {isOpen ? (
                <div className="space-y-4 border-t border-parchment/10 bg-ink/10 px-3 py-3">
                  <CharacterSheet
                    character={c}
                    races={state.races}
                    classes={state.classes}
                    onChange={(next) => onUpdate(c.id, next)}
                  />
                  <div>
                    <h3 className="mb-1 px-1 font-display text-sm text-parchment/80">
                      In-Game Character Sheet{" "}
                      <span className="text-xs text-parchment/45">
                        (preview — same view the Party screen drills into)
                      </span>
                    </h3>
                    <CharacterSheetSim
                      character={c}
                      classes={state.classes}
                      races={state.races}
                      items={state.items}
                    />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {state.characters.length === 0 ? (
        <p className="mt-6 text-sm text-parchment/55">
          No characters yet. Click <strong>+ New Character</strong> to create
          one.
        </p>
      ) : null}
    </div>
  );
}


