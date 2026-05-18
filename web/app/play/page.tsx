/**
 * /play — the game's title-screen route.
 *
 * Two affordances:
 *   • Return to Game — loads the localStorage save and resumes. Hidden
 *     (or disabled — see PlayLanding) when no save exists.
 *   • New Game       — sends the player to the module picker.
 *
 * The save check has to run in the browser (localStorage isn't
 * available during SSR), so the page is a thin server wrapper around
 * a client component.
 */

import { PlayLanding } from "./PlayLanding";

export default function PlayPage() {
  return <PlayLanding />;
}
