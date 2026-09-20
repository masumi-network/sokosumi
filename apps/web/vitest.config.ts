import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

function resolvePath(relativePath: string): string {
  return path.resolve(rootDir, relativePath);
}

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
        find: /^@sokosumi\/chat$/,
        replacement: resolvePath("../../packages/chat/src/index.ts"),
      },
      {
        find: /^@sokosumi\/chat\/(.*)$/,
        replacement: resolvePath("../../packages/chat/src/$1"),
      },
      {
        find: /^@sokosumi\/database$/,
        replacement: resolvePath("../../packages/database/src/index.ts"),
      },
      {
        find: /^@sokosumi\/database\/(.*)$/,
        replacement: resolvePath("../../packages/database/src/$1"),
      },
      {
        find: /^@sokosumi\/email$/,
        replacement: resolvePath("../../packages/email/src/index.ts"),
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
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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
  },
});
