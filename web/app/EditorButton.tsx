"use client";

/**
 * Landing-page Editor button — only shown to signed-in users, since the
 * editor (Dungeon Master mode) requires an account to publish. Renders
 * nothing until the publish API confirms an authenticated session, so
 * signed-out visitors and builds without a reachable publish API (e.g.
 * the static github.io game) don't see it.
 */

import Link from "next/link";
import { usePublishServer } from "@/editor/usePublishServer";

export function EditorButton() {
  const { authenticated } = usePublishServer();
  if (!authenticated) return null;
  return (
    <Link
      href="/editor"
      className="rounded-md border border-ember/50 bg-ink/60 px-8 py-3 text-lg text-parchment shadow transition hover:border-ember hover:bg-ink/40"
    >
      Dungeon Master Mode
    </Link>
  );
}
