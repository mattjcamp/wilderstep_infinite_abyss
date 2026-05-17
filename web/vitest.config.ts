import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Minimal vitest config. The project uses `@/` as a path alias for
 * `./src/` (declared in tsconfig.json's `compilerOptions.paths`).
 * Next.js + TypeScript pick it up automatically; vitest needs the
 * mapping mirrored here so test files (and the source modules they
 * import) can use the same import form.
 *
 * Nothing else is configured — vitest's defaults are fine for this
 * codebase: jsdom isn't needed (no DOM-touching unit tests today),
 * and the existing tests live alongside their source files.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
