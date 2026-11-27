import { Client } from "pg";

/**
 * Runs on its own connection, so no plan of an earlier test is cached, in a
 * transaction that is always rolled back.
 */
export async function rolledBack<T>(
  run: (db: Client) => Promise<T>,
): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("BEGIN");
    try {
      return await run(db);
    } finally {
      await db.query("ROLLBACK");
    }
  } finally {
    await db.end();
  }
}

/**
 * What applying `sql` after `setup` answers: "applied", or the message of the
 * refusal. Rolled back either way: SQL that does not refuse cannot leave its
 * bodies behind.
 */
export function refusal(sql: string, setup = "SELECT 1") {
  return rolledBack(async (db) => {
    await db.query(setup);
    return db.query(sql).then(
      () => "applied",
      (error: Error) => error.message,
    );
  });
}
