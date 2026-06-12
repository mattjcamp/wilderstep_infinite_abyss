# Player-Authored Module Publishing — Implementation Sketch

Goal: let any player edit and publish their own modules from the deployed
site, and let players discover and play each other's modules — without
rewriting the editor, content model, or game runtime.

This builds on two seams that already exist:

- **`ModuleSource`** (`src/data_model/ModuleSource.ts`) — the read contract.
  `StaticModuleSource` is one implementation; we add a remote one.
- **`PublishItem[]` protocol** (`src/data_model/publishClient.ts`) — the write
  contract. `scripts/publish-server.mjs` is the local implementation; we add
  a hosted one with the same shape.

Because both reads and writes already go through a typed boundary, the
front-end barely changes. The work is almost entirely net-new backend.

---

## 1. Target architecture

```
Browser (static export, unchanged front-end)
  editor  ──writes──▶ publishClient (PublishItem[]) ──▶  Publish API (hosted)
  game    ──reads───▶ ModuleSource                  ──▶  Catalog/Read API (hosted)
  drafts  ──local───▶ localStorage (unchanged, per-user working copy)

Hosted services
  Publish API   — auth, ownership checks, validation, writes
  Read/Catalog  — list modules, serve resolved module data
  Storage       — module JSON + sprite PNGs (object storage)
  Index/DB      — catalog metadata, ownership, namespacing
  Auth          — identity + sessions
```

The static front-end stays on GitHub Pages (or moves to the host's static
tier). Only the publish/read targets change from "localhost / static files"
to "hosted API."

---

## 2. Hosting stack

**Recommended: Cloudflare.** It maps almost one-to-one onto the existing
design and keeps ops minimal.

- **Pages** — host the existing static export (drop-in for GH Pages).
- **Workers** — the Publish API and Catalog/Read API. The publish handler is
  a near-port of `publish-server.mjs`: same `PublishItem` switch, same
  regex/path validation, now writing to R2 instead of local disk.
- **R2** — object storage for module JSON files and sprite PNGs. The current
  on-disk layout (`modules/<id>/*.json`, `sprites/<cat>/*.png`) becomes the
  R2 key layout almost verbatim.
- **D1 (SQLite)** — catalog index + ownership + moderation flags. Small,
  relational, cheap.
- **Cloudflare Access / a lightweight auth** — identity. (Or Clerk/Auth0 if
  you want social login fast.)

**Alternative: Supabase.** Postgres + Storage + Auth in one box; fastest path
to working auth and row-level ownership rules. Slightly heavier and you keep
the front-end wherever it already is. Either is fine — the codebase doesn't
care which, because everything goes through `ModuleSource` and `publishClient`.

The rest of this doc is stack-neutral; "Storage" = R2/Supabase Storage,
"DB" = D1/Postgres, "API" = Worker/Edge function.

---

## 3. Storage layout

Mirror today's tree so the publish handler and resolver logic barely change.

```
Storage (object):
  modules/<namespaced-id>/module.json
  modules/<namespaced-id>/<model>.json        (races.json, spells.json, …)
  sprites/<owner>/<category>/<file>.png
  sprites/index.json                          (per-owner or global, see §6)

DB (relational):
  users(id, handle, created_at, …)
  modules(id, owner_id, slug, title, role, extends, visibility,
          version, status, created_at, updated_at)
  module_uses(module_id, library_id)          (the `uses` palette list)
  moderation(module_id, state, reason, reviewer, ts)
  reports(id, module_id, reporter_id, reason, ts)
```

DB is the source of truth for *catalog/listing/ownership*; object storage is
the source of truth for *content blobs*. The Catalog API joins them.

---

## 4. Namespacing (the one design-sensitive piece)

Today module ids are global (`default`, `tavern`, …) and the `extends`/`uses`
inheritance chains reference them by bare id. With many authors, two players
will pick the same id, and `extends: "tavern"` becomes ambiguous.

Plan:

- **Public id = `@handle/slug`** (e.g. `@matt/sunken-keep`). `default` and
  other shipped core/library modules keep their bare ids and live under a
  reserved system namespace (`@core/...` aliased so existing references and
  saves still resolve).
- **`extends` / `uses` store fully-qualified ids.** The editor writes the
  qualified form; the resolver (`walkExtendsChain`, `collectUsedLibraryIds`
  in `StaticModuleSource.ts`) is updated to resolve qualified ids. This is the
  main change that reaches into existing code.
- **Cross-author inheritance policy:** simplest v1 = you may only `extends`
  core/library modules and your own; `uses` (import-palette, which *copies*
  records and decouples) may reference any public module. This avoids "author
  deletes a module that 200 others inherit from" headaches. `uses` already
  copies-on-import, so it's safe to open up immediately.

Migration: a one-time script rewrites shipped modules' ids/references to the
`@core` namespace; existing player saves key off resolved record ids, so add
an alias map (`tavern → @core/tavern`) to keep old saves loading.

---

## 5. New front-end code (small, additive)

| New file | Mirrors | Job |
|---|---|---|
| `src/data_model/RemoteModuleSource.ts` | `StaticModuleSource.ts` | `implements ModuleSource`; `list()`/`load()` hit the Catalog/Read API instead of static `/modules/`. Reuse `merge.ts` + the extends/uses resolution unchanged. |
| `src/data_model/sourceConfig.ts` | — | Picks Static vs Remote source from env, so local dev and the hosted site share one editor. |
| (edit) `publishClient.ts` | itself | `PUBLISH_HOST` already env-driven; point it at the hosted API and add an auth header. The `PublishItem` types are untouched. |
| (edit) `usePublishServer.ts` | itself | Probe now means "am I signed in & is the API up," not "is localhost running." Gate Publish buttons on auth. |
| `src/auth/*` | — | Sign-in UI, session, "my modules" view, ownership-aware Publish. |

The editor components, `draft.ts` (localStorage drafts), `merge.ts`,
inheritance logic, and the entire game runtime stay as-is.

---

## 6. Publish API (port of `publish-server.mjs`)

Reuse the existing contract verbatim — `POST /publish` taking
`{ items: PublishItem[] }`, returning `PublishItemResult[]`. Keep the
existing safeguards (id/filename regexes, path-traversal guards, protected
`default`/core modules) — they're already written and correct. Add three
things the local server never needed:

1. **Auth** — reject unauthenticated requests.
2. **Ownership** — every `moduleId` in the batch must belong to the caller
   (or be a new id the caller is claiming). Sprites write under the caller's
   `sprites/<owner>/...` prefix, so the global sprite index becomes per-owner
   (or owner-scoped sections) to avoid collisions.
3. **Quotas + validation** — cap module size, sprite count/dimensions, and
   total storage per user; schema-validate JSON against `models.ts` before
   accepting; verify PNG payloads (the local server already checks the
   `data:image/png;base64,` MIME).

Because the batch is transactional-ish per item already (per-item results),
partial failures and draft-clearing behavior on the client need no change.

---

## 7. Auth & ownership

- Identity provider issues a session; front-end attaches it to publish/read
  calls. Public reads (playing modules) can stay anonymous.
- `modules.owner_id` enforces who can publish/overwrite/delete a given id.
- `visibility` field: `private` (only owner), `unlisted` (link only),
  `public` (in catalog). New modules default to `private` until the author
  opts in to listing.

## 8. Catalog & play picker

- New Catalog API: `GET /catalog?role=playable&visibility=public&sort=...`
  backed by the DB, with search/pagination.
- Update the play picker (`app/play/new/page.tsx` / `PlayLanding.tsx`) to
  pull from the Catalog API via `RemoteModuleSource.list()` instead of the
  static index. Add author, updated date, and a report button.
- Keep shipped `@core` modules pinned/featured so the picker is never empty.

## 9. Moderation, safety, quotas (don't underestimate)

- **Pre-publish:** strict schema validation, size/quota caps, PNG re-encode
  to strip metadata, filename/id sanitization (mostly already present).
- **Post-publish:** report button → `reports` table; `moderation.state`
  (`ok` / `hidden` / `removed`) filters the catalog; an admin view to action
  reports.
- **Abuse:** rate-limit publishes per user; cap modules per user; consider
  text filtering on titles/descriptions. This is ongoing operational work,
  not a one-time build.

---

## 10. Rollout phases

1. **Backend foundation** — auth, DB schema, Storage, Catalog API, hosted
   Publish API (port the local server). No front-end change yet; verify with
   the existing local editor pointed at the hosted host.
2. **Remote read path** — `RemoteModuleSource` + `sourceConfig`; play picker
   reads the hosted catalog. Site can now *play* hosted modules.
3. **Hosted authoring** — sign-in UI, ownership-gated Publish, "my modules,"
   namespacing rollout + core-alias migration. Players can now *publish*.
4. **Community surface** — search/browse, author pages, report flow,
   moderation admin.
5. **Hardening** — quotas, rate limits, abuse handling, observability.

Phases 1–2 are safe and invisible to current users (the static path keeps
working). The behavior change — players publishing live — lands in phase 3.

---

## 11. Status (June 2026)

Shipped in-repo (stack-neutral slice; no hosting yet):

- **Namespacing (§4):** `src/data_model/moduleIds.ts` — `@handle/slug`
  grammar, `@core` aliasing, alias-aware identity, ownership + v1
  extends policy. Wired into `StaticModuleSource` (alias-resolved
  URLs, alias-aware cycle/dedup checks). Bare ids fully back-compat.
- **Remote read seam (§5):** `StaticModuleSource` refactored onto a
  pluggable `ModuleFileLocator`; `RemoteModuleSource` +
  `sourceConfig` (env-driven static/remote switch) shipped with
  stubbed-fetch tests.
- **Publish API port (§6):** `web/workers/publish-api/` — Cloudflare
  Worker (R2-backed) with ownership, server-derived index, owner-
  prefixed sprites, size caps, PNG signature sniff; auth stubbed
  behind Cloudflare Access (JWT verification is a marked TODO).
  `wrangler.toml` template + unit tests over an R2 mock.
- **Contract:** `docs/dev_guides/ugc_api_contract.md` — what the
  hosted services must serve; both front-end and worker are coded
  against it.

**Deployed + verified (June 2026):** worker live at
`https://wilderstep-publish-api.wilderstep.workers.dev` (R2 bucket
`wilderstep-ugc`), shipped module JSON seeded via
`workers/publish-api/seed-bucket.mjs` (modules only — sprites still
pending, run with `--sprites` when wanted). Read path proven end to
end by `src/data_model/remoteLive.integration.test.ts` (opt-in:
`LIVE_READ_HOST=<worker> npx vitest run …` from `web/`): catalog
listing, extends-chain resolution through hosted core content, and
@core alias resolution all pass against the live worker. **Phases
1–2 complete.**

**Phase 3 complete (June 2026):** Access + verified JWTs live
(little-tree-b24e team, AUD configured), DEV_ALLOW_ANON removed,
first player modules published as @matt/* and PLAYED from the hosted
catalog via `npm run dev:remote`. Hardened along the way: draft-key
parsing for qualified ids, game sources never read editor drafts,
per-mode Next build caches, no-store catalog index + /reindex
reconciler, credentialed CORS on the local publish-server.

## Next session plan

1. **Editor reads the configured source.** The editor still
   instantiates StaticModuleSource directly, so in remote mode it
   browses LOCAL modules only — once a published module's drafts are
   cleared, the author can't reopen it to keep editing. Swap editor
   surfaces to getModuleSource() (drafts stay preferred there) so
   hosted @handle modules are editable: load published → edit as
   drafts → republish. This closes the authoring loop.
2. **Deploy to Cloudflare Pages.** Build the static export with the
   remote env vars, add the Pages origin to ALLOWED_ORIGINS +
   LOGIN_REDIRECT_URL, and the whole experience becomes a URL — no
   npm required. Anyone in the Access policy can author; anyone can
   play. (Also largely dissolves the third-party-cookie concern.)
3. **Sprites**: seed-bucket --sprites, plus play-side resolution of
   per-owner sprite paths (sprites/@handle/…) so published art
   renders.
4. **Phase 4 proper** (community surface): catalog search/browse,
   author pages, "my modules", report flow + moderation flags — D1
   enters here, per §3's schema.
5. Phase 5 hardening overlaps the editor audit's P5: schema
   validation on publish, rate limits, PNG re-encode.

## 11½. Effort & risk summary

- **Already done (~60–70%):** editor UI, content model, draft system,
  inheritance/merge, the read seam (`ModuleSource`), and the write protocol
  (`PublishItem` + a correct reference server). This is the expensive part.
- **Net-new:** a backend (auth + storage + DB + two small APIs) and the
  namespacing change. Mostly additive; the only code that reaches into
  existing logic is qualified-id resolution in the extends/uses resolver.
- **Disruption to existing code:** low. Front-end deltas are a handful of new
  files plus env-config edits; editor and game runtime are untouched.
- **Hosting:** required — the pure-static model can't persist multi-user
  writes. Footprint is modest (edge functions + object storage + small DB +
  auth); a managed stack keeps ops light.
- **Biggest sleeper risks:** (1) namespacing/migration done wrong breaks old
  saves and inheritance — get the `@core` alias map right; (2) moderation and
  abuse are ongoing, not a checkbox.
