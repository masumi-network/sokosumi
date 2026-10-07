import { defineConfig } from "vitest/config";

import baseConfig from "./vitest.config";

/**
 * Tests that drive a real browser through Playwright: layout the DOM doubles in
 * `vitest.config.ts` cannot compute, and that Chromium computes differently.
 * Each test serves its own page and opens it; this picks the files and shares
 * the main config's module resolution, so a test can render real components.
 *
 * Kept out of `pnpm test`, which has no browser to launch. Run with
 * `pnpm --filter web test:webkit` after
 * `pnpm --filter web exec playwright install webkit chromium`.
 */
export default defineConfig({
  plugins: baseConfig.plugins,
  resolve: baseConfig.resolve,
  test: {
    environment: "node",
    include: ["src/**/*.webkit.test.{ts,tsx}"],
  },
});
