import { defineConfig } from "vitest/config";

/**
 * Tests that drive a real WebKit through Playwright: layout the DOM doubles in
 * `vitest.config.ts` cannot compute, and that Chromium computes differently.
 * Each test serves its own page and opens it; this only picks the files.
 *
 * Kept out of `pnpm test`, which has no browser to launch. Run with
 * `pnpm --filter web test:webkit` after
 * `pnpm --filter web exec playwright install webkit`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.webkit.test.ts"],
  },
});
