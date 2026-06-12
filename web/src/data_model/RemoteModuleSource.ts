/**
 * RemoteModuleSource — reads modules from a hosted Read/Catalog API
 * instead of the static export. Phase-2 of the UGC publishing plan
 * (docs/dev_guides/ugc_publishing_plan.md §5).
 *
 * The hosted API serves the SAME path layout as the static tree
 * (that's the contract — see docs/dev_guides/ugc_api_contract.md):
 *
 *   GET <host>/modules/index.json
 *   GET <host>/modules/<id>/module.json
 *   GET <host>/modules/<id>/<model>.json
 *
 * …where `<id>` may be bare ("tavern") or qualified
 * ("@matt/sunken-keep"). Because the layout matches, this class is
 * nothing but a locator pointing at a different origin —
 * StaticModuleSource's extends/uses resolution, merge semantics,
 * and localStorage-draft preference are inherited unchanged, which
 * is the whole point of the ModuleSource seam.
 *
 * Reads are anonymous (public catalog). Authenticated, ownership-
 * aware operations are the Publish API's concern (publishClient),
 * not this class's.
 */

import {
  StaticModuleSource,
  type ModuleFileLocator,
} from "./StaticModuleSource";
import { moduleStorageSegment } from "./moduleIds";

/** Build a locator rooted at a hosted Read API origin. Exported for
 *  tests and for any future caller that wants the URLs without the
 *  class. */
export function remoteLocator(host: string): ModuleFileLocator {
  // Normalise: no trailing slash, so path joins are predictable.
  const base = host.replace(/\/+$/, "");
  return {
    moduleFile: (moduleId, fileName) =>
      `${base}/modules/${moduleStorageSegment(moduleId)}/${fileName}`,
    index: () => `${base}/modules/index.json`,
  };
}

export class RemoteModuleSource extends StaticModuleSource {
  constructor(host: string, opts?: { preferDrafts?: boolean }) {
    super(remoteLocator(host), opts);
  }
}
