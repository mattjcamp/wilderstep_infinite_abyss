/**
 * Applies a Module Properties dialog patch: writes the manifest draft
 * (module.json) and, when the start position was touched, the party
 * draft (party.json `start_position`). Shared by the module picker's
 * cards and the module landing page so both save identically.
 */

import { loadDraft, MANIFEST_KEY, saveDraft } from "@/data_model/draft";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import type { ModulePropertiesPatch } from "./ModulePropertiesDialog";

/** `current` is the manifest to patch (its pending draft, else the
 *  on-disk file); untouched fields survive. Returns the saved manifest. */
export async function saveModuleProperties(
  moduleId: string,
  current: Record<string, unknown> | null,
  patch: ModulePropertiesPatch,
): Promise<Record<string, unknown>> {
  const next: Record<string, unknown> = current ? { ...current } : {};
  // id is non-editable from the dialog — keep whatever was there,
  // but fall back to the summary's id to be safe.
  next.id = next.id ?? moduleId;
  next.title = patch.title;
  if (patch.description) next.description = patch.description;
  else delete next.description;
  if (patch.trailer) next.trailer = patch.trailer;
  else delete next.trailer;
  if (patch.author) next.author = patch.author;
  else delete next.author;
  if (patch.version) next.version = patch.version;
  else delete next.version;
  if (patch.role) next.role = patch.role;
  else delete next.role;
  if (patch.theme) next.theme = patch.theme;
  else delete next.theme;
  // Soundtrack list — persist when non-empty, drop the key when
  // the textarea was cleared. Keeps quiet modules shape-clean
  // rather than committing a noisy `"soundtrack": []`.
  if (patch.soundtrack && patch.soundtrack.length > 0) {
    next.soundtrack = patch.soundtrack;
  } else {
    delete next.soundtrack;
  }
  // Fog-of-war sight radius — nested under `settings.sight_radius`,
  // one key per lighting mode. Only the modes the author actually
  // set a number for are written; blank modes are dropped so they
  // fall back to the engine default. When no mode is set the whole
  // sight_radius block (and an emptied settings object) is removed,
  // keeping default modules shape-clean. Other settings.* keys
  // (e.g. start_time) are preserved.
  {
    const sr = patch.sightRadius;
    const settings: Record<string, unknown> =
      next.settings && typeof next.settings === "object"
        ? { ...(next.settings as Record<string, unknown>) }
        : {};
    const sightOut: Record<string, number> = {};
    if (typeof sr.day === "number") sightOut.day = sr.day;
    if (typeof sr.twilight === "number") sightOut.twilight = sr.twilight;
    if (typeof sr.night === "number") sightOut.night = sr.night;
    if (Object.keys(sightOut).length > 0) {
      settings.sight_radius = sightOut;
    } else {
      delete settings.sight_radius;
    }
    // Exploration XP — same shape-clean rules: only set keys land.
    const xp = patch.explorationXp;
    const xpOut: Record<string, number> = {};
    if (typeof xp?.map === "number") xpOut.map = xp.map;
    if (typeof xp?.npc === "number") xpOut.npc = xp.npc;
    if (Object.keys(xpOut).length > 0) {
      settings.exploration_xp = xpOut;
    } else {
      delete settings.exploration_xp;
    }
    if (Object.keys(settings).length > 0) {
      next.settings = settings;
    } else {
      delete next.settings;
    }
  }
  await saveDraft(moduleId, MANIFEST_KEY, next);
  // Start position lives in the module's party.json, so it goes to
  // the party draft (same draft the Party editor writes). Only when
  // the author actually touched it.
  if (patch.startPosition !== undefined) {
    let party = await loadDraft<Record<string, unknown>>(moduleId, "party");
    if (!party) {
      const layers = await getEditorModuleSource().loadModelLayers(
        moduleId,
        "party",
      );
      party = (layers.ownFile as Record<string, unknown> | null) ?? null;
    }
    const nextParty: Record<string, unknown> = { ...(party ?? {}) };
    if (patch.startPosition) nextParty.start_position = patch.startPosition;
    else delete nextParty.start_position;
    await saveDraft(moduleId, "party", nextParty);
  }
  return next;
}
