/**
 * Next.js config.
 *
 * Two deploy modes:
 *   - Local dev: served from "/" with no basePath. The default — works
 *     out of the box with `npm run dev` / `npm run build`.
 *   - GitHub Pages: served from "/<repo>/". Set NEXT_PUBLIC_BASE_PATH
 *     to the repo prefix (e.g. "/wilderstep_infinite_abyss") and this
 *     config switches Next to static-export mode and prepends the
 *     prefix to routes + asset URLs.
 *
 * NEXT_PUBLIC_* env vars are also exposed at runtime, so any direct
 * fetch() calls or asset URLs that Next.js doesn't auto-prefix can
 * prepend the same value themselves.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(basePath
    ? {
        // Static export for GitHub Pages.
        output: "export",
        basePath,
        // Trailing slash so /play/ resolves to /play/index.html under a
        // static host (GH Pages serves directories with a trailing slash;
        // without this, /play 404s).
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
