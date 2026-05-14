"use client";

/**
 * React hook for the local publish-server's availability. Probes on
 * mount; components use the result to decide whether to render
 * Publish controls. Returns `null` while probing so callers can
 * distinguish "still checking" from "definitely unavailable".
 */

import { useEffect, useState } from "react";
import { probePublishServer } from "@/data_model/publishClient";

export function usePublishServer(): { available: boolean | null } {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    probePublishServer()
      .then((ok) => {
        if (!cancelled) setAvailable(ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { available };
}
