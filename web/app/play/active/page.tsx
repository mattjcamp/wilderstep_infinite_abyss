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

import type { Viewport } from "next";
import { PlayHost } from "./PlayHost";

/** Game screen only: pin the zoom so pinches / double-taps on a tablet
 *  don't zoom the page instead of playing. No effect on desktop. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function ActivePlayPage() {
  return <PlayHost />;
}
