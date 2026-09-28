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
  "src/services/image-studio-recovery.postgres.test.ts",
  "src/helpers/calendar-erasure.postgres.test.ts",
  "src/helpers/project-activity.postgres.test.ts",
  "src/routes/v1/projects/get.postgres.test.ts",
  "src/services/soko-bot-integrations.service.postgres.test.ts",
  "src/services/source-import-github.postgres.test.ts",
  "src/services/file-search.postgres.test.ts",
  "src/services/file-suggestions.postgres.test.ts",
  "src/services/file-suggestion-backfill.postgres.test.ts",
  "src/services/file-table-index.postgres.test.ts",
  "src/services/file-collections.postgres.test.ts",
  "src/services/file-related.postgres.test.ts",
  "src/services/file-backfill.postgres.test.ts",
  "src/services/file-curated-vocabulary.postgres.test.ts",
  "src/helpers/transaction-history.postgres.test.ts",
  "src/helpers/history-sort-at.postgres.test.ts",
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

/**
 * A suite nothing provisions a database for.
 *
 * `push-device-consent.postgres.test.ts` does not use `DATABASE_URL` and
 * the `RUN_DATABASE_INTEGRATION_TESTS` gate the others share. It requires
 * `SOK939_TEST_DATABASE_URL`, pointed at a separate `sok_939` database on
 * `127.0.0.1`, and it reads that variable inside a `vi.mock` factory — so
 * without it the file **throws during collection** rather than skipping.
 * A suite that skips costs nothing; one that throws fails the run.
 *
 * `SOK939` appears nowhere in `.github/` and nowhere else in the
 * repository, so no CI job provisions it. It arrived with #5291 and
 * belongs to that work; the hole is named here rather than left as a
 * deletion somebody makes later to get a build green.
 *
 * Held out only while the variable is absent, so whoever owns it keeps
 * being able to run it. Set `SOK939_TEST_DATABASE_URL` and it collects
 * normally.
 *
 * Kept here rather than as `--exclude` on the CI command line so the
 * reason travels with the pattern and a local run behaves the way CI
 * does.
 */
export const unprovisionedDbFiles = process.env.SOK939_TEST_DATABASE_URL
  ? []
  : ["src/lib/ably/push-device-consent.postgres.test.ts"];

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
      // Unconditional: a CLI filter naming this file must not resurrect
      // it, because it throws rather than skipping. See above.
      ...unprovisionedDbFiles,
      ...(cliSelectsOptInDbFile(process.argv) ? [] : optInDbExclude),
    ],
    setupFiles: ["src/test/setup.ts"],
    /** Same cap as web, for the same reason — see `apps/web/vitest.config.ts`. */
    maxWorkers: process.env.CI ? undefined : "50%",
  },
});
