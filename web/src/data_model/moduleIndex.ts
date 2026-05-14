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
