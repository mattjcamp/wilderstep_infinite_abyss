/**
 * /play/end — the grim end screen.
 *
 * Reached when the party is wiped. Two paths out:
 *
 *   • Continue from last save — restores the backup save written
 *     BEFORE the fatal encounter. The current-slot save (which has
 *     the wiped party) is overwritten by the backup, then the player
 *     resumes at the pre-fight state.
 *
 *   • New Game — wipes both slots and sends the player back to the
 *     module picker.
 *
 * If no backup save exists (the party wiped before ever crossing a
 * link), only "New Game" is offered.
 */

import { EndScreen } from "./EndScreen";

export default function EndScreenPage() {
  return <EndScreen />;
}
