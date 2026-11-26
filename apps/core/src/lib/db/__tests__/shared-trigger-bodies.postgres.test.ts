/**
 * `packages/database/prisma/network-layout/shared-trigger-bodies.sql`: the
 * trigger bodies of the new layout. Its guard refuses today's layout and a
 * layout where a trigger would keep the old body; that a refusal leaves
 * nothing behind is the caller's transaction (the file's header). That the
 * bodies resolve their names is proven by the suites that run on the split
 * layout and fire these triggers, not here; `split-network-layout.sh` checks
 * that every function of `shared` is in the file or waits.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";

import { onSplitLayout } from "@/test/split-layout";

import { refusal, rolledBack } from "./rolled-back";

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

/**
 * A transaction in which `seed` wrote its rows without foreign keys or
 * triggers (`session_replication_role = replica`), and then the named
 * triggers fire anyway. So a test needs no user, Workspace or Agent rows.
 */
function firing<T>(
  triggers: Record<string, string[]>,
  seed: (db: Client) => Promise<unknown>,
  run: (db: Client) => Promise<T>,
) {
  return rolledBack(async (db) => {
    await db.query("SET LOCAL session_replication_role = replica");
    await seed(db);
    for (const [table, names] of Object.entries(triggers)) {
      for (const name of names) {
        await db.query(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
      }
    }
    return run(db);
  });
}

describe.runIf(ON_POSTGRES)("shared trigger bodies", () => {
  describe.runIf(!onSplitLayout)("on today's layout", () => {
    it("refuses", async () => {
      expect(await refusal(BODIES_SQL)).toBe(
        "shared-trigger-bodies.sql needs the three-schema layout; missing schema: mainnet, preprod, shared",
      );
    });

    it("refuses three schemas that do not hold the functions", async () => {
      expect(
        await refusal(
          BODIES_SQL,
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
        BODIES_SQL,
        `ALTER FUNCTION shared.task_assign_number() SET SCHEMA public;
         CREATE FUNCTION shared.task_assign_number() RETURNS trigger
           LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
      );

      expect(message).toContain(
        "runs a task_assign_number that is not in shared",
      );
    });

    // The split script already applied the file, so every digest differs
    // from the migrated one and the refusal lists all of them.
    it.each([
      "SET LOCAL quote_all_identifiers = on",
      "SET LOCAL extra_float_digits = -6",
    ])("finds the same digests after %s", async (setting) => {
      const control = await refusal(BODIES_SQL);

      expect(control).toContain("a migration changed this function:");
      expect(await refusal(BODIES_SQL, setting)).toBe(control);
    });

    // Image Studio is Mainnet only: Preprod holds a Transaction with the
    // same id and another amount, and its schema is renamed away.
    it("keeps an image's History row with the refund of Mainnet's Transaction", async () => {
      const [asset, job, refund] = [randomUUID(), randomUUID(), randomUUID()];
      const history = `SELECT title, amount::int, network FROM shared.history
        WHERE kind = 'IMAGE' AND "entityId" = $1`;

      const seen = await firing(
        {
          "shared.project_image_asset": ["history_project_image_asset_sync"],
          "shared.project_image_job": ["history_project_image_job_charge_sync"],
        },
        async (db) => {
          for (const [schema, cents] of [
            ["mainnet", 300],
            ["preprod", 900],
          ]) {
            await db.query(
              `INSERT INTO ${schema}."Transaction" (id, "updatedAt", amount)
               VALUES ($1, now(), $2::bigint)`,
              [refund, cents],
            );
          }
          await db.query(
            `INSERT INTO shared.project_image_job (id, "updatedAt", "projectId", "workspaceId",
               "requestedByUserId", kind, model, prompt, settings, "idempotencyKey",
               "chargedCents", "refundTransactionId")
             VALUES ($1::uuid, now(), $1, $1, 'user', 'GENERATE', 'model', 'prompt', '{}', $1::text,
               1000, $2)`,
            [job, refund],
          );
          await db.query("ALTER SCHEMA preprod RENAME TO network_away");
        },
        async (db) => {
          const rows: unknown[] = [];
          const after = async (sql: string, values: unknown[]) => {
            await db.query(sql, values);
            rows.push((await db.query(history, [asset])).rows[0] ?? null);
          };
          await after(
            `INSERT INTO shared.project_image_asset (id, "projectId", "workspaceId", "jobId",
               "rootId", version, model, prompt, settings, "blobPathname", "contentType",
               width, height, bytes, checksum)
             VALUES ($1, $2, $2, $2, $1, 1, 'model', 'An image', '{}', 'path', 'image/png',
               1, 1, 1, 'sum')`,
            [asset, job],
          );
          await after(
            `UPDATE shared.project_image_job SET "chargedCents" = 1200 WHERE id = $1`,
            [job],
          );
          await after(`DELETE FROM shared.project_image_asset WHERE id = $1`, [
            asset,
          ]);
          return rows;
        },
      );

      expect(seen).toEqual([
        { title: "An image", amount: 700, network: null },
        { title: "An image", amount: 900, network: null },
        null,
      ]);
    });
  });
});
