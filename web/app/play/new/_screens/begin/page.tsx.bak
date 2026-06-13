/**
 * /play/new/[moduleId]/begin — beginning screen.
 *
 * Full-screen presentation of the module's description. After a short
 * pause, "Press any key to begin" prompts the player. On keypress (or
 * click), the assembled party + initial world state get written to
 * the localStorage save and the player is routed to /play/active.
 */

import { isPlayableModule, readAllModules } from "@/data_model/moduleIndex";
import { decodeModuleIdParam } from "@/editor/moduleRoutes";
import { BeginningScreen } from "./BeginningScreen";

export function generateStaticParams() {
  return readAllModules()
    .filter(isPlayableModule)
    .map((m) => ({ moduleId: m.id }));
}

export default function BeginningScreenPage({
  params,
}: {
  params: { moduleId: string };
}) {
  const moduleId = decodeModuleIdParam(params.moduleId);
  // Build-time metadata covers shipped modules; remote/qualified ids
  // aren't in the static list, so BeginningScreen resolves their
  // title + description client-side through the configured source.
  const meta = readAllModules().find((m) => m.id === moduleId);
  return (
    <BeginningScreen
      moduleId={moduleId}
      title={meta?.title}
      description={meta?.description}
    />
  );
}
