# Cloudflare Pages deploy (hosted authoring + play)

Goal: serve the whole experience — editor *and* game, against the hosted
catalog and Publish API — as a plain URL, no `npm` required. This is item
2 of the `ugc_publishing_plan.md` next-session plan.

GitHub Pages stays as-is (a game-only static build under
`/<repo>/` on github.io). Cloudflare Pages is the additive, full
authoring+play surface at `https://wilderstep.pages.dev`. The two builds
differ only in env vars (see below); the same source produces both.

## Why Pages and not github.io for authoring

Publishing is credentialed: the editor calls the Worker's `/publish` and
`/status` with the Cloudflare Access cookie. github.io is a third-party
origin to the Worker, so those cookies are cross-site and fragile. A
Pages origin (and later a custom domain alongside the Worker) keeps the
auth story clean. Reads stay anonymous either way.

## How the build differs

`next.config.mjs` enters static-export mode (`output: "export"`) when
**either** a basePath is set (GH Pages) **or** `STATIC_EXPORT=1`
(Cloudflare Pages, which serves from root and has no basePath to imply
it). `basePath` is applied independently and only when set, so the Pages
build has clean root-relative URLs.

The Pages build is wrapped in one script:

```
npm run build:pages
```

which sets:

| Var | Value | Why |
|---|---|---|
| `STATIC_EXPORT` | `1` | Force `output: export` at root (no basePath). |
| `NEXT_PUBLIC_MODULE_SOURCE` | `remote` | Read from the hosted catalog, not the static tree. |
| `NEXT_PUBLIC_READ_HOST` | `https://wilderstep-publish-api.wilderstep.workers.dev` | Catalog/Read API origin. |
| `NEXT_PUBLIC_PUBLISH_HOST` | `https://wilderstep-publish-api.wilderstep.workers.dev` | Publish API origin (Sign-in, `/status`, `/publish`). |

Output lands in `web/out/` (Next's static-export dir), same as the GH
Pages build.

## One-time setup (git-connected — Cloudflare builds on push)

In the Cloudflare dashboard → **Workers & Pages → Create → Pages →
Connect to Git**, pick this repo, then set:

- **Project name:** `wilderstep` (→ `https://wilderstep.pages.dev`).
- **Production branch:** `main`.
- **Root directory:** `web`  (the Next app is not at repo root).
- **Build command:** `npm run build:pages`.
- **Build output directory:** `out`.
- **Environment variables:** none required — `build:pages` bakes them
  in. (If you'd rather manage them in the dashboard, move the four vars
  above into Pages → Settings → Environment variables and change the
  build command to `npm run build`.)

Every push to `main` now rebuilds and redeploys automatically. Preview
deploys on other branches get `*.wilderstep.pages.dev` preview URLs; if
you want previews to publish too, add each preview origin to
`ALLOWED_ORIGINS` (below) — by default only production is wired.

## Worker side (already in `workers/publish-api/wrangler.toml`)

The Pages origin is wired into the Worker:

- `ALLOWED_ORIGINS = "http://localhost:3000,https://wilderstep.pages.dev"`
  — credentialed CORS + the `?return=` allow-list.
- `LOGIN_REDIRECT_URL = "https://wilderstep.pages.dev/editor/"` — where
  `/login` bounces after Access authenticates (the editor's Sign-in link
  passes its own `?return=`, which overrides this for in-app sign-in).

These are plain vars, so they only take effect after you redeploy the
Worker:

```
cd web/workers/publish-api
npx wrangler deploy
```

## Verify (end to end)

1. **Build is static:** `cd web && npm run build:pages` → `web/out/`
   exists with `index.html`, `editor/index.html`, `play/index.html`.
2. **Play (anonymous):** open `https://wilderstep.pages.dev/play/new/`
   → the hosted `@core` catalog lists; a module loads and plays.
3. **Auth:** in the editor, click Sign in → Cloudflare Access (one-time
   PIN) → redirected back; the Publish buttons appear.
4. **Round-trip:** publish a small change to an `@matt/*` module, reload
   `/play`, confirm it reflects. Re-open the published module in the
   editor (now possible in remote mode — see the editor-source change),
   edit, republish.

## Updating engine / core content on the hosted deploy

Core game content (the `default` module + the bare-id libraries) lives in
the repo under `web/public/modules/` and is edited the developer way:
edit locally (`npm run dev:all`), commit, push. That git push rebuilds
the **static bundle** — but in hosted mode the worker reads core modules
from **R2**, not from the static bundle, so R2 must be re-seeded or the
change never shows on the live site.

This is automated: **`.github/workflows/seed-r2.yml`** re-seeds R2 on
every push to `main` that touches `web/public/modules/**`. One-time
setup — add two repo secrets (Settings → Secrets and variables →
Actions):

- `CLOUDFLARE_API_TOKEN` — token with **R2 Storage: Edit** on the account.
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id.

Manual fallback (or to run it yourself): `cd web/workers/publish-api &&
node seed-bucket.mjs` (logged in via `wrangler login`). The worker caches
module files for ~60s, so allow a moment / hard-refresh after a seed.

Caveat: the action re-seeds module **data** only. If you **add or remove**
a shipped module, also open `<worker-url>/reindex` once in a signed-in
browser to rebuild the (server-derived) catalog index — that endpoint
needs Access auth, which CI can't provide.

## Custom domain (optional, later)

Point a domain (e.g. `play.wilderstep.com`) at the Pages project in
**Pages → Custom domains**, then add that exact origin to
`ALLOWED_ORIGINS` and redeploy the Worker. A first-party domain across
Pages + Worker also fully dissolves the third-party-cookie concern.
