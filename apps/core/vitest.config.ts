import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@sokosumi/utils": fileURLToPath(
        new URL("../../packages/utils/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    pool: "forks",
    isolate: false,
    /** Same cap as web, for the same reason — see `apps/web/vitest.config.ts`. */
    maxWorkers: process.env.CI ? undefined : "50%",
  },
});
