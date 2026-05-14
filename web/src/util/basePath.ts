/**
 * Prepend the deploy basePath to a runtime URL.
 *
 * Local dev: NEXT_PUBLIC_BASE_PATH is unset → returns the path as-is.
 * GH Pages:  NEXT_PUBLIC_BASE_PATH = "/wilderstep_infinite_abyss" → prepended.
 *
 * Next.js's <Link> and <Image> auto-apply basePath; raw fetch() does not,
 * so any code that calls fetch with an absolute path (`/modules/...`) must
 * route through here.
 */
export function withBasePath(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${base}${path}`;
}
