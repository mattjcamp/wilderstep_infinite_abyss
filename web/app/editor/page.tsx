/**
 * /editor — the module editor route.
 *
 * Stub. Eventually this is where the module list / per-entity editors
 * live. A future /editor/[moduleId] route will edit a specific module.
 */
import Link from "next/link";

export default function EditorPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-display text-4xl text-parchment">Editor</h1>
      <p className="text-parchment/70">Module editor stub — no content yet.</p>
      <Link href="/" className="text-ember underline">
        Back to landing
      </Link>
    </main>
  );
}
