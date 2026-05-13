/**
 * /play — the game route.
 *
 * Stub. Eventually this is where the title screen / module picker /
 * Phaser-or-equivalent game canvas mounts.
 */
import Link from "next/link";

export default function PlayPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-display text-4xl text-parchment">Play</h1>
      <p className="text-parchment/70">Game stub — no content yet.</p>
      <Link href="/" className="text-ember underline">
        Back to landing
      </Link>
    </main>
  );
}
