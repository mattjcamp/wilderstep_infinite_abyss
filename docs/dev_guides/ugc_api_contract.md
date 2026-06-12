# UGC Hosted API Contract

*Companion to `ugc_publishing_plan.md`. This is the contract the
front-end is coded against today (`RemoteModuleSource`,
`publishClient`) and the hosted services must satisfy. The reference
implementation of the publish side is
`web/workers/publish-api/worker.mjs` (Cloudflare Worker, R2-backed).*

## Module ids

Single source of truth: `web/src/data_model/moduleIds.ts`. Two forms:

| Form | Grammar | Meaning |
|---|---|---|
| bare (`tavern`) | `^[a-z][a-z0-9-]*$` | shipped/system modules only |
| qualified (`@matt/sunken-keep`) | handle `^[a-z0-9][a-z0-9_-]{1,29}$`, slug `^[a-z0-9][a-z0-9_-]{0,63}$` | player modules |

`@core/<x>` is an alias for the bare shipped id `<x>` — services and
clients MUST treat the two spellings as the same module
(`resolveModuleIdAlias`). Storage paths use the alias-resolved id
verbatim (`modules/@matt/sunken-keep/...`, `modules/tavern/...`);
both forms are URL- and object-key-safe by grammar, no encoding.

**v1 cross-author policy** (`canExtendModule`): `extends` may target
system modules or modules owned by the caller's handle. `uses` may
reference any public module (import copies records, so deletion of
the source can't break dependents).

## Read API (anonymous)

Serves the SAME path layout as the static export, from object
storage. `RemoteModuleSource` is just a different origin + this
layout:

```
GET <READ_HOST>/modules/index.json
      → { "modules": [ { "id", "title"?, "role"? }, ... ] }
GET <READ_HOST>/modules/<id>/module.json
GET <READ_HOST>/modules/<id>/<model>.json      (races.json, …)
GET <READ_HOST>/sprites/<owner-or-core>/<category>/<file>.png
```

404 for missing files (clients already treat missing model files as
fall-through). Responses are public-cacheable; the index should be
short-TTL. Visibility: entries with `visibility != "public"` are
omitted from index.json for anonymous readers (owner-scoped listings
come with auth, phase 3+).

Front-end selection: `NEXT_PUBLIC_MODULE_SOURCE=remote` +
`NEXT_PUBLIC_READ_HOST=<origin>` (see `sourceConfig.ts`).

## Publish API (authenticated)

Same wire shapes as the local `publish-server.mjs` so
`publishClient.ts` works against either:

```
GET  <PUBLISH_HOST>/status   → { ok: true, ... }        (also: am I signed in?)
POST <PUBLISH_HOST>/publish  body { items: PublishItem[] }
      → 200 { results: [ { ok, item, ...detail | error }, ... ] }
```

Per-item results — partial failure is normal and the client already
handles it. Batch-level errors (bad JSON, auth) use HTTP status +
`{ error }`.

### Auth (implemented)

Cloudflare Access, with the application protecting ONLY the worker's
`/login` path. The flow:

1. Editor sends the user to `<PUBLISH_HOST>/login?return=<editor-url>`
   (`publishSignInUrl()` in publishClient). Access intercepts, runs
   its login (One-time PIN or any configured IdP), sets the
   `CF_Authorization` cookie for the worker's domain, and the worker
   bounces the browser back to `return` (validated against
   ALLOWED_ORIGINS) or LOGIN_REDIRECT_URL.
2. The editor's `/status` + `/publish` fetches use
   `credentials: "include"`, so the cookie rides along cross-origin.
   These paths are NOT behind Access — the worker verifies the
   cookie's JWT itself (accessAuth.mjs): RS256 signature against the
   team JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`,
   cached), `exp`/`nbf` with small skew, `aud` must contain the
   Access app's AUD tag. Fails closed — unset config means nobody
   authenticates; reads stay anonymous.
3. Identity → handle: `HANDLE_MAP` env (JSON email → handle) wins;
   otherwise a sanitised email local-part. (Pre-D1 stand-in for the
   users table.)

`/status` reports `{ ok, authenticated, handle }`. CORS: origins in
`ALLOWED_ORIGINS` get reflected-origin + `Allow-Credentials`
headers; everything else gets anonymous `*` (read path only).

Worker env: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_ORIGINS`,
`LOGIN_REDIRECT_URL`, `HANDLE_MAP` — see wrangler.toml. Local dev:
`wrangler dev --var DEV_ALLOW_ANON:true` — NEVER on a deployed
environment.

### Item kinds, hosted semantics

| kind | hosted behaviour |
|---|---|
| `manifest` | moduleId must be qualified `@<caller>/<slug>` (system ids rejected). Validates `extends` against the cross-author policy. Writes `modules/<id>/module.json`; upserts the catalog index entry. |
| `model` | same ownership rule; fileName per `^[a-z][a-z0-9_]*\.json$` and must be a registered model file. Size-capped. |
| `index` | **rejected** — the hosted catalog index is derived server-side, never client-written. |
| `delete-module` | owner only; system ids always rejected. Deletes the prefix + index entry. |
| `sprite` | writes under the CALLER's prefix: `sprites/@<handle>/<category>/<file>.png` (client-supplied category/filename validated by the local server's regexes; PNG data-URL payload verified + size-capped). Regenerates the owner's sprite index section. |
| `delete-sprite` | owner prefix only. |
| `sprite-index` | regenerates the owner's section only. |
| `audio-index` | **rejected** in v1 — the audio catalog is system content. |

### Quotas (enforced server-side, v1 constants)

JSON file ≤ 1 MiB; sprite PNG ≤ 256 KiB; ≤ 64 files per module;
≤ 16 modules and ≤ 512 sprites per user; publish rate-limited per
user. Exceeding → per-item `{ ok: false, error }`.

### Validation roadmap

v1 validates ids/filenames/payload types + caps (everything the
local server already enforced, plus ownership). Schema validation of
model JSON against `models.ts` and PNG re-encode (metadata strip)
are phase-5 hardening — tracked in the plan, not yet in the worker.

## Sprite namespace note

Shipped sprites stay at `sprites/<category>/...` (`@core`-owned,
read-only via this API). Player sprites live under
`sprites/@<handle>/<category>/...`; the editor's sprite fields
resolve both (a player module references its own sprites by the
owner-prefixed path). The global `sprites/index.json` becomes
core-only; per-owner indexes live at `sprites/@<handle>/index.json`.

## What the backend needs from Cloudflare (setup checklist)

1. R2 bucket (module JSON + sprites; layout above).
2. Worker (this repo's `web/workers/publish-api/`) bound to the
   bucket; routes for the publish endpoints and (v1) the read path.
3. Cloudflare Access (or other IdP) in front of /publish; map
   identity → handle (D1 `users` table when it lands).
4. D1 database — phase 3+: ownership/visibility/moderation tables
   per the plan §3. v1 worker runs without it (ownership is derived
   from the id namespace).
