/**
 * /editor/[moduleId] — module landing page. Brief intro plus a grid of
 * model cards linking into each model's browse view.
 */

import Link from "next/link";
import {
  ALL_MODEL_KEYS,
  MODELS,
  type ModelKey,
} from "@/data_model/models";
import { listModuleIds } from "@/data_model/moduleIndex";

export async function generateStaticParams() {
  const ids = await listModuleIds();
  return ids.map((moduleId) => ({ moduleId }));
}

export default function ModuleEditorHome({
  params,
}: {
  params: { moduleId: string };
}) {
  const { moduleId } = params;
  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-parchment">
          {moduleId}
        </h1>
        <p className="mt-1 text-parchment/60">
          Browse the module&apos;s data. Pick a model from the sidebar or one of
          the cards below.
        </p>
      </header>

      <Section title="Module data" keys={ALL_MODEL_KEYS} moduleId={moduleId} />

      <section className="mb-8">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-parchment/40">
          Assets
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          <li>
            <Link
              href={`/editor/${moduleId}/sprites`}
              className="block rounded-md border border-parchment/15 bg-ink/30 p-3 transition hover:border-parchment/40 hover:bg-ink/50"
            >
              <div className="font-display text-lg text-parchment">Sprites</div>
              <p className="mt-0.5 text-sm text-parchment/60">
                PNG assets grouped by category — what art is available to
                reference from data records
              </p>
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}

function Section({
  title,
  keys,
  moduleId,
}: {
  title: string;
  keys: ModelKey[];
  moduleId: string;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-parchment/40">
        {title}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {keys.map((k) => {
          const def = MODELS[k];
          return (
            <li key={k}>
              <Link
                href={`/editor/${moduleId}/${k}`}
                className="block rounded-md border border-parchment/15 bg-ink/30 p-3 transition hover:border-parchment/40 hover:bg-ink/50"
              >
                <div className="font-display text-lg text-parchment">
                  {def.label}
                </div>
                <p className="mt-0.5 text-sm text-parchment/60">{def.blurb}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
