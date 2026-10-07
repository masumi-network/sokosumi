import { availableParallelism } from "node:os";

import { Client } from "pg";
import type { TestProject } from "vitest/node";

import { workerDatabaseUrl } from "./worker-database-url";

/**
 * Gives every Vitest worker its own copy of the migrated database, so the
 * `*.postgres.test.ts` files can run in parallel. They cannot share one: the
 * file index jobs are leased globally, oldest first, so two suites on one
 * database take each other's jobs and fail on rows the other one wrote.
 *
 * `CREATE DATABASE … TEMPLATE` copies the migrated schema, triggers included,
 * in milliseconds. It needs the CREATEDB privilege and no open connection to
 * the template, which is why it is opt-in: CI sets
 * `POSTGRES_TEST_DATABASE_PER_WORKER=true` right after migrating.
 */
export default async function setup(project: TestProject) {
  const templateUrl = process.env.DATABASE_URL;
  if (!templateUrl?.startsWith("postgres")) {
    throw new Error(
      "POSTGRES_TEST_DATABASE_PER_WORKER needs DATABASE_URL to name the migrated database.",
    );
  }

  // In CI Core leaves `maxWorkers` unset and Vitest resolves its default in
  // the pool, never above the machine's parallelism.
  const workers = project.config.maxWorkers ?? availableParallelism();
  const template = new URL(templateUrl).pathname.slice(1);
  const names = Array.from({ length: workers }, (_, index) =>
    new URL(workerDatabaseUrl(templateUrl, String(index + 1))).pathname.slice(
      1,
    ),
  );

  // Any database on the server will do for issuing CREATE DATABASE; the
  // template itself must not be the one connected to.
  const admin = new Client({
    connectionString: Object.assign(new URL(templateUrl), {
      pathname: "/postgres",
    }).toString(),
  });
  await admin.connect();
  try {
    for (const name of names) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    }
  } finally {
    await admin.end();
  }
}
