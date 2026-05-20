/**
 * Build-time module index reader.
 *
 * The list of modules baked into the deployed build lives in
 * web/public/modules/index.json. At build time (during `next build`,
 * for generateStaticParams), we read it directly off disk via node:fs.
 *
 * At runtime, the client fetches the same file via
 * StaticModuleSource.list() — both should agree on its shape.
 *
 * This file uses node:fs and must only be imported from server
 * components or build scripts. Importing from a "use client" file
 * will break the build.
 */

import fs from "node:fs";
import path from "node:path";

export interface ModuleIndexEntry {
  id: string;
  title?: string;
  role?: string;
}

interface IndexFile {
  modules?: ModuleIndexEntry[];
}

/** Synchronously read the module index from disk. cwd during
 *  `next build` is web/, so the path is relative to that. */
export function readModuleIndex(): ModuleIndexEntry[] {
  const filePath = path.join(process.cwd(), "public", "modules", "index.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as IndexFile;
  return parsed.modules ?? [];
}

export async function listModuleIds(): Promise<string[]> {
  return readModuleIndex().map((m) => m.id);
}

/** Full metadata read off each module's module.json. Used by the
 *  /play module picker which needs title/description/author/version
 *  + role to filter to "playable" modules. Reads the filesystem
 *  rather than the index so a draft module (one in
 *  `public/modules/<id>/` but not yet listed in index.json) still
 *  shows up in the picker. */
export interface ModuleMetadata {
  id: string;
  title?: string;
  description?: string;
  author?: string;
  version?: string;
  role?: string;
}

/** Roles that explicitly disqualify a module from the play picker.
 *  Anything else — including the conventional "omitted == playable"
 *  case (per ModuleSummary.role) and an explicit "playable" — is
 *  considered playable. Keeping this list centralized so the picker
 *  page and the static-params route generators can't drift. */
const NON_PLAYABLE_ROLES = new Set(["core", "library"]);

/** True when this module should appear in /play/new and have its
 *  per-module routes pre-rendered. */
export function isPlayableModule(m: { role?: string }): boolean {
  return !NON_PLAYABLE_ROLES.has((m.role ?? "").trim());
}

/** Synchronously read every module.json under `public/modules/`.
 *  Skips files / hidden dirs. Returns an empty list if the folder
 *  doesn't exist (clean checkout, broken deploy). Build-time only. */
export function readAllModules(): ModuleMetadata[] {
  const modulesDir = path.join(process.cwd(), "public", "modules");
  let entries: string[];
  try {
    entries = fs.readdirSync(modulesDir);
  } catch {
    return [];
  }
  const out: ModuleMetadata[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const moduleJson = path.join(modulesDir, name, "module.json");
    if (!fs.existsSync(moduleJson)) continue;
    try {
      const raw = fs.readFileSync(moduleJson, "utf8");
      const parsed = JSON.parse(raw) as ModuleMetadata;
      // The id in the JSON should match the folder name; defer to
      // the folder for the canonical id so a typo in module.json
      // doesn't break routing.
      out.push({ ...parsed, id: name });
    } catch {
      // Malformed module.json — skip it. The editor would catch this
      // in a separate pass; the play picker just ignores broken
      // modules so one bad draft doesn't take down the whole list.
    }
  }
  return out;
}
