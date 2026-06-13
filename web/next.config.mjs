/**
 * Next.js config.
 *
 * Three deploy modes:
 *   - Local dev: served from "/" with no basePath. The default — works
 *     out of the box with `npm run dev` / `npm run build`.
 *   - GitHub Pages: served from "/<repo>/". Set NEXT_PUBLIC_BASE_PATH
 *     to the repo prefix (e.g. "/wilderstep_infinite_abyss") and this
 *     config switches Next to static-export mode and prepends the
 *     prefix to routes + asset URLs.
 *   - Cloudflare Pages: served from "/" (root) but still a STATIC
 *     export. Set STATIC_EXPORT=1 (no basePath) — see
 *     `npm run build:pages` and docs/dev_guides/cloudflare_pages_deploy.md.
 *
 * Static-export mode is therefore triggered by EITHER a basePath (GH
 * Pages) OR an explicit STATIC_EXPORT flag (Cloudflare Pages at root);
 * basePath prefixing is applied independently, only when it's set. That
 * split is what lets Cloudflare Pages host the same export without the
 * "/<repo>/" prefix github.io requires.
 *
 * NEXT_PUBLIC_* env vars are also exposed at runtime, so any direct
 * fetch() calls or asset URLs that Next.js doesn't auto-prefix can
 * prepend the same value themselves.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// Export when a basePath is set (GH Pages) or when explicitly asked
// (Cloudflare Pages serves at root, so it has no basePath to imply it).
const staticExport = basePath !== "" || process.env.STATIC_EXPORT === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_PUBLIC_* values are INLINED into compiled chunks, and the
  // dev/build cache under distDir keeps serving the old inlines when
  // env changes between runs. Remote mode (hosted module catalog —
  // see sourceConfig.ts) therefore gets its own distDir, so
  // `npm run dev` and `npm run dev:remote` can alternate without
  // stale-chunk confusion or cache wipes.
  distDir:
    process.env.NEXT_PUBLIC_MODULE_SOURCE === "remote"
      ? ".next-remote"
      : ".next",
  ...(staticExport
    ? {
        // Static export (GitHub Pages and Cloudflare Pages).
        output: "export",
        // Trailing slash so /play/ resolves to /play/index.html under a
        // static host (directories are served with a trailing slash;
        // without this, /play 404s).
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
  // basePath only when github.io requires the "/<repo>/" prefix; Pages
  // and local dev serve from root.
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
