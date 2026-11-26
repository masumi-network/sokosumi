/**
 * `packages/database/prisma/network-layout/shared-trigger-bodies.sql`: the
 * trigger bodies of the new layout. Its guard refuses today's layout and a
 * layout where a trigger would keep the old body; that a refusal leaves
 * nothing behind is the caller's transaction (the file's header). That the
 * bodies resolve their names is proven by the suites that run on the split
 * layout and fire these triggers, not here; `split-network-layout.sh` checks
 * that every function of `shared` is in the file or waits.
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onSplitLayout } from "@/test/split-layout";

const BODIES_SQL = readFileSync(
  new URL(
    "../../../../../../packages/database/prisma/network-layout/shared-trigger-bodies.sql",
    import.meta.url,
  ),
  "utf8",
);
const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

describe.runIf(ON_POSTGRES)("shared trigger bodies", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Applies the file after `setup`, in a transaction that is always rolled
   * back: a file that does not refuse cannot leave its bodies behind.
   */
  async function refusal(setup: string) {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN; ${setup}`);
      return await client.query(BODIES_SQL).then(
        () => "applied",
        (error: Error) => error.message,
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  describe.runIf(!onSplitLayout)("on today's layout", () => {
    it("refuses", async () => {
      expect(await refusal("SELECT 1")).toBe(
        "shared-trigger-bodies.sql needs the three-schema layout; missing schema: mainnet, preprod, shared",
      );
    });

    it("refuses three schemas that do not hold the functions", async () => {
      expect(
        await refusal(
          "CREATE SCHEMA shared; CREATE SCHEMA mainnet; CREATE SCHEMA preprod",
        ),
      ).toBe(
        "shared-trigger-bodies.sql needs the three-schema layout; missing function: shared.calendar_access_cleanup_on_member_delete()",
      );
    });
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    it("refuses while a trigger still runs a function of the file outside shared", async () => {
      const message = await refusal(
        `ALTER FUNCTION shared.task_assign_number() SET SCHEMA public;
         CREATE FUNCTION shared.task_assign_number() RETURNS trigger
           LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
      );

      expect(message).toContain(
        "runs a task_assign_number that is not in shared",
      );
    });
  });
});
