/**
 * /play/new/party?m=<moduleId> — party formation step.
 *
 * Query-param route (not a `[moduleId]` segment) so the static export
 * serves a single HTML page that works for ANY module id, including
 * hosted `@handle/slug` ids that don't exist at build time. The id is
 * read client-side from `?m=` (see src/play/playRoutes.ts). A missing
 * id bounces back to the picker.
 *
 * `useSearchParams` requires a Suspense boundary under `output:
 * "export"`, hence the wrapper.
 */
"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { decodeModuleIdParam } from "@/editor/moduleRoutes";
import { PartyFormation } from "../_screens/party/PartyFormation";

function PartyFormationRoute() {
  const router = useRouter();
  const raw = useSearchParams().get("m");
  const moduleId = raw ? decodeModuleIdParam(raw) : "";
  useEffect(() => {
    if (!moduleId) router.replace("/play/new");
  }, [moduleId, router]);
  if (!moduleId) return null;
  return <PartyFormation moduleId={moduleId} />;
}

export default function PartyFormationPage() {
  return (
    <Suspense fallback={null}>
      <PartyFormationRoute />
    </Suspense>
  );
}
