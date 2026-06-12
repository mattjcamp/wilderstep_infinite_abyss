/**
 * /editor/[moduleId]/sprites — sprite browser.
 *
 * Sprites are *assets*, not a data model, but they're surfaced through
 * the editor here so authors can see what art is available when filling
 * in Monster.sprite / Character.sprite fields. The data lives at
 * web/public/sprites/<category>/<filename> with a generated index.json
 * cataloging the set.
 */

import { decodeModuleIdParam, encodeModuleId } from "@/editor/moduleRoutes";
import Link from "next/link";
import { SpriteView } from "@/editor/SpriteView";

export async function generateStaticParams() {
  return [{ moduleId: "default" }];
}

export default function SpriteBrowsePage({
  params,
}: {
  params: { moduleId: string };
}) {
  const moduleId = decodeModuleIdParam(params.moduleId);
  return (
    <div>
      <nav className="border-b border-parchment/10 bg-ink/40 px-4 py-2 text-xs text-parchment/50">
        <Link
          href={`/editor/${encodeModuleId(moduleId)}`}
          className="hover:text-parchment/80"
        >
          {moduleId}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-parchment/80">Sprites</span>
        <span className="ml-3 text-parchment/40">(/sprites/)</span>
      </nav>
      <SpriteView />
    </div>
  );
}
