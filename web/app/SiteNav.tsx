"use client";

/**
 * Global navigation bar, rendered once in the root layout so it's
 * consistent on every screen — EXCEPT the active game (/play/active),
 * which stays full-screen and immersive.
 *
 * Contents (auth-aware, via usePublishServer):
 *   signed out:  Play · Player's Manual · Sign in
 *   signed in:   @handle · Play · Player's Manual · Dungeon Master Mode
 *                · My Modules · Sign out
 *
 * "Dungeon Master Mode", "My Modules", and the @handle chip are gated on
 * being signed in (those need an account). On builds with no reachable
 * publish API (e.g. the static github.io game), only Play + Manual show.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { withBasePath } from "@/util/basePath";
import { usePublishServer } from "@/editor/usePublishServer";
import {
  publishSignInUrl,
  publishSignOutUrl,
} from "@/data_model/publishClient";

const linkClass =
  "text-parchment/80 transition hover:text-parchment whitespace-nowrap";

export function SiteNav() {
  const pathname = usePathname();
  const { available, reachable, authenticated, handle } = usePublishServer();

  // Immersive full-screen gameplay gets no chrome.
  if (pathname?.startsWith("/play/active")) return null;

  const signedIn = !!(reachable && authenticated && handle);

  return (
    <header className="sticky top-0 z-40 flex items-center gap-4 border-b border-parchment/10 bg-ink/80 px-4 py-2 text-sm backdrop-blur">
      {signedIn ? (
        <span className="font-mono text-parchment/50">@{handle}</span>
      ) : null}

      <nav className="ml-auto flex items-center gap-4">
        <Link href="/" className={linkClass}>
          Home
        </Link>
        <Link href="/play" className={linkClass}>
          Play
        </Link>
        <a
          href={withBasePath("/manual.pdf")}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          Player&apos;s Manual
        </a>
        {signedIn ? (
          <>
            <Link href="/editor" className={linkClass}>
              Dungeon Master Mode
            </Link>
            <Link href="/play/mine" className={linkClass}>
              My Modules
            </Link>
          </>
        ) : null}

        <Link href="/faq" className={linkClass}>
          FAQ
        </Link>


        {/* Auth control — nothing while the session is still being
            probed (available === null) or when there's no publish API. */}
        {available === null ? null : signedIn ? (
          <a href={publishSignOutUrl()} className="text-ember underline">
            Sign out
          </a>
        ) : reachable ? (
          <a href={publishSignInUrl()} className="text-ember underline">
            Sign in
          </a>
        ) : null}
      </nav>
    </header>
  );
}
