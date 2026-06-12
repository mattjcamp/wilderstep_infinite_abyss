/**
 * Live read-path integration test — runs RemoteModuleSource against
 * a REAL deployed worker. Opt-in only (network-dependent, so it must
 * never run in CI / the normal suite): the whole file is skipped
 * unless LIVE_READ_HOST is set.
 *
 *   LIVE_READ_HOST=https://wilderstep-publish-api.<subdomain>.workers.dev \
 *     npx vitest run src/data_model/remoteLive.integration.test.ts
 *
 * Use after deploying the worker or re-seeding the bucket to prove
 * the hosted read path end to end: catalog listing, extends-chain
 * resolution through core content, and @core alias resolution.
 */
import { describe, expect, it } from "vitest";
import { RemoteModuleSource } from "./RemoteModuleSource";

const HOST = process.env.LIVE_READ_HOST;

describe.skipIf(!HOST)("live worker read path", () => {
  it("lists the hosted catalog and resolves an extends chain", async () => {
    const src = new RemoteModuleSource(HOST!);
    const list = await src.list();
    const ids = list.map((m) => m.id);
    expect(ids).toContain("default");
    expect(ids).toContain("underworld-invaders");

    // underworld-invaders extends default — resolving a model it
    // doesn't define itself proves the chain walks through the
    // hosted core content.
    const layers = await src.loadModelLayers(
      "underworld-invaders",
      "monsters",
    );
    const inherited = layers.inherited as {
      monsters?: Array<{ id: string }>;
    } | null;
    expect((inherited?.monsters ?? []).length).toBeGreaterThan(10);

    // And the @core alias spelling resolves to the same shipped data.
    const aliased = await src.loadModelLayers("@core/default", "races");
    const own = aliased.ownFile as { races?: Array<{ id: string }> } | null;
    expect((own?.races ?? []).map((r) => r.id)).toContain("dwarf");
  }, 30000);
});
