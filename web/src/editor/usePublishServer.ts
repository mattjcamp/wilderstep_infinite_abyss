"use client";

/**
 * React hook for the publish API's availability + auth state. Probes
 * on mount; components use the result to decide whether to render
 * Publish controls.
 *
 * IMPORTANT SEMANTICS: `available` means "publishing can happen
 * right now" — the API is reachable AND the caller is authenticated.
 * Every pre-auth call site gates Publish buttons on
 * `available === true`, so folding auth into the flag makes all of
 * them auth-aware without edits (fail closed by construction).
 *
 * The decomposed fields are for richer UI:
 *   - `reachable`      the API answered /status at all
 *   - `authenticated`  the hosted API accepted the Access cookie
 *     (the local dev server has no auth and always counts as
 *     authenticated, so local workflows are unchanged)
 *   - `handle`         the publish handle the hosted API resolved
 *
 * `reachable && !authenticated` is the "show a Sign in link" state —
 * DraftBanner renders that affordance (see editorShell.tsx).
 */

import { useEffect, useState } from "react";
import { probePublishServer } from "@/data_model/publishClient";

export interface PublishServerState {
  available: boolean | null;
  reachable: boolean;
  authenticated: boolean;
  handle: string | null;
}

export function usePublishServer(): PublishServerState {
  const [state, setState] = useState<PublishServerState>({
    available: null,
    reachable: false,
    authenticated: false,
    handle: null,
  });

  useEffect(() => {
    let cancelled = false;
    probePublishServer()
      .then((status) => {
        if (!cancelled) {
          setState({
            available: status.available && status.authenticated,
            reachable: status.available,
            authenticated: status.authenticated,
            handle: status.handle,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            available: false,
            reachable: false,
            authenticated: false,
            handle: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
