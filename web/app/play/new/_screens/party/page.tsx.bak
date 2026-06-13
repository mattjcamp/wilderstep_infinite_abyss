/**
 * /play/new/[moduleId]/party — party formation step.
 *
 * Shows the module's default roster as a set of slots. Each slot can
 * be kept (use the module's pre-built character) or replaced with a
 * freshly created character via CharacterCreator. On "Begin", the
 * assembled party is stashed in sessionStorage and the player
 * advances to the beginning screen.
 *
 * Static export needs generateStaticParams so each module gets its
 * own pre-rendered route at build time.
 */

import { isPlayableModule, readAllModules } from "@/data_model/moduleIndex";
import { decodeModuleIdParam } from "@/editor/moduleRoutes";
import { PartyFormation } from "./PartyFormation";

export function generateStaticParams() {
  return readAllModules()
    .filter(isPlayableModule)
    .map((m) => ({ moduleId: m.id }));
}

export default function PartyFormationPage({
  params,
}: {
  params: { moduleId: string };
}) {
  return <PartyFormation moduleId={decodeModuleIdParam(params.moduleId)} />;
}
