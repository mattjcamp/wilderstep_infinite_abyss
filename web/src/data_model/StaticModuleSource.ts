/**
 * StaticModuleSource — reads modules and shared data from the static
 * site's served files under /data/ and /modules/<id>/.
 *
 * URLs are passed through withBasePath() so GH Pages's repo prefix is
 * applied automatically when the env var is set at build time.
 *
 * Each module's id is also the folder name (matches the architecture
 * plan's contract). For now, the list of modules is hardcoded — when
 * web/scripts/build-module-index.mjs lands, list() will fetch
 * data/modules/index.json instead.
 */

import { withBasePath } from "@/util/basePath";
import {
  MODELS,
  MODULE_MODELS,
  SHARED_MODELS,
  type ModelKey,
} from "./models";
import type {
  LoadedModule,
  ModuleSource,
  ModuleSummary,
  SharedData,
} from "./ModuleSource";

/** Modules baked into the deployed build. Will move to data/modules/index.json. */
const KNOWN_MODULE_IDS = ["default"];

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export class StaticModuleSource implements ModuleSource {
  async list(): Promise<ModuleSummary[]> {
    const out: ModuleSummary[] = [];
    for (const id of KNOWN_MODULE_IDS) {
      try {
        const meta = (await fetchJson(
          withBasePath(`/modules/${id}/module.json`),
        )) as Partial<ModuleSummary> & { id?: string };
        out.push({
          id: meta.id ?? id,
          title: meta.title ?? id,
          description: meta.description ?? "",
          author: meta.author ?? "",
          version: meta.version ?? "0.0.0",
          role: meta.role,
        });
      } catch (e) {
        // Module unreachable — skip with a console warning so the picker
        // still renders rather than throwing.
        // eslint-disable-next-line no-console
        console.warn(`Module ${id} failed to load:`, e);
      }
    }
    return out;
  }

  async load(moduleId: string): Promise<LoadedModule> {
    const meta = (await fetchJson(
      withBasePath(`/modules/${moduleId}/module.json`),
    )) as Partial<ModuleSummary> & { id?: string };
    const summary: ModuleSummary = {
      id: meta.id ?? moduleId,
      title: meta.title ?? moduleId,
      description: meta.description ?? "",
      author: meta.author ?? "",
      version: meta.version ?? "0.0.0",
      role: meta.role,
    };

    const data: Record<string, unknown> = {};
    for (const key of MODULE_MODELS) {
      const def = MODELS[key];
      try {
        data[key] = await fetchJson(
          withBasePath(`/modules/${moduleId}/${def.fileName}`),
        );
      } catch (e) {
        data[key] = null;
      }
    }
    return { summary, data };
  }

  async loadShared(): Promise<SharedData> {
    const data: SharedData = {};
    for (const key of SHARED_MODELS) {
      const def = MODELS[key];
      try {
        data[key] = await fetchJson(withBasePath(`/data/${def.fileName}`));
      } catch (e) {
        data[key] = null;
      }
    }
    return data;
  }

  /** Convenience: load one model's data without pulling the whole module.
   *  Used by the per-model browse page to keep network traffic minimal. */
  async loadModel(moduleId: string, key: ModelKey): Promise<unknown> {
    const def = MODELS[key];
    const url =
      def.scope === "shared"
        ? withBasePath(`/data/${def.fileName}`)
        : withBasePath(`/modules/${moduleId}/${def.fileName}`);
    return fetchJson(url);
  }
}
