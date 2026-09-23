import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

/**
 * Opt-in Postgres / DB integration files skip in the unit run. Keep them out
 * of collect so Vitest does not load them. CLI-listed paths (CI postgres
 * step, local opt-in) still collect. `admin.integration.test.ts` is a mocked
 * router test and stays in the unit suite.
 */
const collectOptInDbFiles = process.argv.some(
  (arg) =>
    arg.includes(".postgres.test.ts") ||
    (arg.includes(".integration.test.ts") &&
      !arg.endsWith("admin.integration.test.ts")),
);

const optInDbExclude = [
  "src/**/*.postgres.test.ts",
  "src/services/task-payment-claim.integration.test.ts",
  "src/helpers/vendor-grants.integration.test.ts",
  "src/helpers/chat-notification-preview.integration.test.ts",
  "src/routes/v1/organizations/seat-assignment-concurrency.integration.test.ts",
  "src/routes/v1/chats/rooms/self-direct.integration.test.ts",
  "src/routes/v1/chats/rooms/room-unread.mute.integration.test.ts",
];

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
    exclude: [
      ...configDefaults.exclude,
      ...(collectOptInDbFiles ? [] : optInDbExclude),
    ],
    setupFiles: ["src/test/setup.ts"],
    /** Same cap as web, for the same reason — see `apps/web/vitest.config.ts`. */
    maxWorkers: process.env.CI ? undefined : "50%",
  },
});
