"use client";

/**
 * Hook for the "Choose a New Adventure" surfaces (the /play/new picker
 * and an author's page): reports the current adventure id (read after
 * mount — localStorage is browser-only) and returns a `choose` that
 * remembers the pick and returns to the /play title screen, which then
 * shows the chosen adventure.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ModuleSummary } from "@/data_model/ModuleSource";
import {
  loadCurrentAdventureId,
  saveCurrentAdventureId,
} from "./currentAdventure";

export function useChooseAdventure(): {
  currentId: string | undefined;
  choose: (m: ModuleSummary) => void;
} {
  const router = useRouter();
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  useEffect(() => {
    setCurrentId(loadCurrentAdventureId());
  }, []);
  const choose = useCallback(
    (m: ModuleSummary) => {
      saveCurrentAdventureId(m.id);
      router.push("/play");
    },
    [router],
  );
  return { currentId, choose };
}
