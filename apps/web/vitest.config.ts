import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defaultExclude, defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

function resolvePath(relativePath: string): string {
  return path.resolve(rootDir, relativePath);
}

/**
 * `.test.ts` files that render or hook into a DOM. Keep these on happy-dom;
 * every other `*.test.ts` under src runs in node.
 */
const DOM_TEST_TS = [
  "src/**/use-*.test.ts",
  "src/**/*.hook.test.ts",
  "src/components/data-table/**/*.test.ts",
  "src/components/chat/fetch-background-json.test.ts",
  "src/lib/utils/notification-time.test.ts",
  "src/app/(app)/organization/page.test.ts",
] as const;

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: [
      {
        find: "server-only",
        replacement: resolvePath("./src/test/empty-module.ts"),
      },
      {
        find: /^@sokosumi\/masumi$/,
        replacement: resolvePath("../../packages/masumi/src/index.ts"),
      },
      {
        find: /^@sokosumi\/masumi\/(.*)$/,
        replacement: resolvePath("../../packages/masumi/src/$1"),
      },
      {
        find: /^@sokosumi\/utils$/,
        replacement: resolvePath("../../packages/utils/src/index.ts"),
      },
    ],
  },
  test: {
    passWithNoTests: true,
    setupFiles: ["src/test/setup.ts"],
    /**
     * Leave the machine half its cores. Vitest otherwise takes all but one,
     * and a happy-dom suite this size then starves WindowServer badly enough
     * that its watchdog kills it — the desktop freezes, which is worse than a
     * slower test run. Especially easy to hit when this suite, the Core suite
     * and a typecheck run at once. CI boxes are dedicated and small, so they
     * keep full parallelism.
     */
    maxWorkers: process.env.CI ? undefined : "50%",
    /**
     * Vitest 5 dropped `environmentMatchGlobs`. Two projects is the
     * equivalent: pure `.test.ts` files stay in node; `.tsx` and DOM/hook
     * `.test.ts` (Testing Library / window) stay on happy-dom.
     */
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...defaultExclude, ...DOM_TEST_TS],
        },
      },
      {
        extends: true,
        test: {
          name: "happy-dom",
          environment: "happy-dom",
          include: ["src/**/*.test.tsx", ...DOM_TEST_TS],
        },
      },
    ],
  },
});
