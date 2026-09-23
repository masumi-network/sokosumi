import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

/**
 * Opt-in Postgres / DB files skip in the unit run. Keep them out of collect
 * so Vitest does not load them. `admin.integration.test.ts` is a mocked
 * router test and stays in the unit suite.
 *
 * Vitest applies `exclude` before the filename filter, so a CLI filter only
 * sees files that survived exclude. A filter that names one of these files
 * (full path or a stem such as `seat-assignment-concurrency`) drops the
 * exclude; the filter then narrows the run. Directory filters do not.
 */
const optInPostgresFiles = [
  "src/helpers/calendar-erasure.postgres.test.ts",
  "src/helpers/project-activity.postgres.test.ts",
  "src/routes/v1/projects/get.postgres.test.ts",
  "src/services/soko-bot-integrations.service.postgres.test.ts",
];

const optInIntegrationFiles = [
  "src/services/task-payment-claim.integration.test.ts",
  "src/helpers/vendor-grants.integration.test.ts",
  "src/helpers/chat-notification-preview.integration.test.ts",
  "src/routes/v1/organizations/seat-assignment-concurrency.integration.test.ts",
  "src/routes/v1/chats/rooms/self-direct.integration.test.ts",
  "src/routes/v1/chats/rooms/room-unread.mute.integration.test.ts",
];

export const optInDbExclude = [
  "src/**/*.postgres.test.ts",
  ...optInIntegrationFiles,
];

const vitestCommands = new Set([
  "run",
  "watch",
  "dev",
  "related",
  "list",
  "bench",
]);

export function cliSelectsOptInDbFile(
  argv: readonly string[],
  files: readonly string[] = [...optInPostgresFiles, ...optInIntegrationFiles],
): boolean {
  const names = files.map((file) => file.slice(file.lastIndexOf("/") + 1));

  return argv.slice(2).some((arg) => {
    const filter = arg.replace(/\\/g, "/").replace(/:\d+$/, "");
    if (
      filter.startsWith("-") ||
      filter.length < 3 ||
      vitestCommands.has(filter) ||
      filter.endsWith("admin.integration.test.ts")
    ) {
      return false;
    }
    if (filter.includes(".postgres.test.ts")) return true;
    return names.some((name) => filter.includes(name) || name.includes(filter));
  });
}

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
      ...(cliSelectsOptInDbFile(process.argv) ? [] : optInDbExclude),
    ],
    setupFiles: ["src/test/setup.ts"],
    /** Same cap as web, for the same reason — see `apps/web/vitest.config.ts`. */
    maxWorkers: process.env.CI ? undefined : "50%",
  },
});
