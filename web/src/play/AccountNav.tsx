"use client";

/**
 * Small account affordance for the editor + play headers: shows the
 * signed-in handle with "My Modules" + "Sign out", or a "Sign in" link
 * when the hosted publish API is reachable but unauthenticated.
 *
 * Renders nothing when the API is still being probed, isn't reachable
 * (e.g. the static github.io build), or is authenticated without a
 * handle (the local dev publish-server has no auth/handle — nothing to
 * manage or sign out of).
 */

import Link from "next/link";
import { usePublishServer } from "@/editor/usePublishServer";
import {
  publishSignInUrl,
  publishSignOutUrl,
} from "@/data_model/publishClient";

export function AccountNav() {
  const { available, reachable, authenticated, handle } = usePublishServer();

  if (available === null || !reachable) return null;

  if (authenticated && handle) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="font-mono text-parchment/50">@{handle}</span>
        <Link
          href="/play/mine"
          className="text-parchment/70 underline hover:text-parchment"
        >
          My Modules
        </Link>
        <a href={publishSignOutUrl()} className="text-ember underline">
          Sign out
        </a>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <a href={publishSignInUrl()} className="text-sm text-ember underline">
        Sign in
      </a>
    );
  }

  return null;
}
