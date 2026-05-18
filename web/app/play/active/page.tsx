/**
 * /play/active — game host.
 *
 * Reads the WorldSave from localStorage, loads the current map and
 * the module's catalogs, mounts Phaser + WorldRenderer, and walks the
 * party. Every link traversal snapshots mutations back into the save.
 *
 * The page itself is a thin shell — `PlayHost` does the actual work
 * and lives in a client module so its catalog/scene loaders run in the
 * browser.
 */

import { PlayHost } from "./PlayHost";

export default function ActivePlayPage() {
  return <PlayHost />;
}
