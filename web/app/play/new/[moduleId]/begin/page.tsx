/**
 * /play/new/[moduleId]/begin — beginning screen.
 *
 * Full-screen presentation of the module's description. After a short
 * pause, "Press any key to begin" prompts the player. On keypress (or
 * click), the assembled party + initial world state get written to
 * the localStorage save and the player is routed to /play/active.
 */

import { readAllModules } from "@/data_model/moduleIndex";
import { BeginningScreen } from "./BeginningScreen";

export function generateStaticParams() {
  return readAllModules()
    .filter((m) => m.role === "playable")
    .map((m) => ({ moduleId: m.id }));
}

export default function BeginningScreenPage({
  params,
}: {
  params: { moduleId: string };
}) {
  const modules = readAllModules();
  const meta = modules.find((m) => m.id === params.moduleId);
  return (
    <BeginningScreen
      moduleId={params.moduleId}
      title={meta?.title ?? params.moduleId}
      description={meta?.description ?? ""}
    />
  );
}
