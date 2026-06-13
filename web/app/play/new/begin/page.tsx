/**
 * /play/new/begin?m=<moduleId> — beginning (description) screen.
 *
 * Query-param route (see ../party/page.tsx and src/play/playRoutes.ts)
 * so the static export serves one HTML page for any module id, hosted
 * or local. The id is read client-side from `?m=`; a missing id bounces
 * to the picker.
 *
 * BeginningScreen resolves its title/description through the configured
 * module source when not passed in (the prior route prefetched those
 * from the build-time list, which can't include hosted modules), so the
 * wrapper renders it with no title/description props.
 */
"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { decodeModuleIdParam } from "@/editor/moduleRoutes";
import { BeginningScreen } from "../_screens/begin/BeginningScreen";

function BeginningScreenRoute() {
  const router = useRouter();
  const raw = useSearchParams().get("m");
  const moduleId = raw ? decodeModuleIdParam(raw) : "";
  useEffect(() => {
    if (!moduleId) router.replace("/play/new");
  }, [moduleId, router]);
  if (!moduleId) return null;
  return <BeginningScreen moduleId={moduleId} />;
}

export default function BeginningScreenPage() {
  return (
    <Suspense fallback={null}>
      <BeginningScreenRoute />
    </Suspense>
  );
}
