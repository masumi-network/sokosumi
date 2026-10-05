/**
 * The database a Vitest worker uses in a PostgreSQL run with
 * `POSTGRES_TEST_DATABASE_PER_WORKER=true`: the migrated database's name with
 * the worker's pool id appended. `postgres-worker-databases.ts` creates them.
 */
export function workerDatabaseUrl(url: string, poolId: string): string {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_w${poolId}`;
  return parsed.toString();
}
