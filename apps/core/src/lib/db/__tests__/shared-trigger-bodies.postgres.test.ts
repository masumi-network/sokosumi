/**
 * `packages/database/prisma/network-layout/shared-trigger-bodies.sql`: the
 * trigger bodies of the new layout. Its guard refuses today's layout and a
 * layout where a trigger would keep the old body; that a refusal leaves
 * nothing behind is the caller's transaction (the file's header). That the
 * bodies resolve their names is proven by the suites that run on the split
 * layout and fire these triggers; here only for the bodies that read a
 * Network table, which must read the right Network's. `split-network-layout.sh`
 * checks that every function of `shared` is in the file.
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

    it("refuses a function of shared that has no digest in the guard", async () => {
      const message = await refusal(
        BODIES_SQL,
        `CREATE FUNCTION shared.without_digest() RETURNS trigger
           LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
      );

      expect(message).toContain(
        "no digest for shared.without_digest(): add its line to the guard of packages/database/prisma/network-layout/shared-trigger-bodies.sql",
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

    // A Preprod payment does not count towards a Task's amount. Each
    // Transaction id also exists on the other Network, with another amount.
    it("counts only Mainnet's Transactions in a Task's History amount", async () => {
      const [task, plain, tagged, preprod] = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ];
      const history = `SELECT title, amount::int, network FROM shared.history
        WHERE kind = 'TASK' AND "entityId" = $1`;

      const seen = await firing(
        {
          "shared.task": ["history_task_sync"],
          'shared."taskEvent"': ["history_task_event_sync"],
          'mainnet."Transaction"': ["history_transaction_sync"],
          'preprod."Transaction"': ["history_transaction_sync"],
        },
        async (db) => {
          for (const [schema, id, cents] of [
            ["mainnet", plain, 100],
            ["mainnet", tagged, 200],
            ["mainnet", preprod, 4000],
            ["preprod", plain, 999],
            ["preprod", preprod, 50],
          ]) {
            await db.query(
              `INSERT INTO ${schema}."Transaction" (id, "updatedAt", amount)
               VALUES ($1, now(), -$2::bigint)`,
              [id, cents],
            );
          }
        },
        async (db) => {
          const rows: unknown[] = [];
          const after = async (sql: string, values: unknown[]) => {
            await db.query(sql, values);
            rows.push((await db.query(history, [task])).rows[0] ?? null);
          };
          const event = `INSERT INTO shared."taskEvent" (id, "updatedAt", "taskId",
              "transactionId", network)
            VALUES (gen_random_uuid()::text, now(), $1, $2, $3)`;
          await after(
            `INSERT INTO shared.task (id, "updatedAt", name, "workspaceId")
             VALUES ($1, now(), 'A Task', gen_random_uuid())`,
            [task],
          );
          // From before the Networks were split: no Network, so Mainnet's.
          await after(event, [task, plain, null]);
          await after(event, [task, tagged, "mainnet"]);
          await after(event, [task, preprod, "preprod"]);
          await after(
            `UPDATE mainnet."Transaction" SET amount = -150 WHERE id = $1`,
            [plain],
          );
          await after(
            `UPDATE preprod."Transaction" SET amount = -60 WHERE id = $1`,
            [preprod],
          );
          await after(`DELETE FROM shared.task WHERE id = $1`, [task]);
          return rows;
        },
      );

      const row = (amount: number) => ({
        title: "A Task",
        amount,
        network: null,
      });
      expect(seen).toEqual([
        row(0),
        row(100),
        row(300),
        row(300),
        row(350),
        row(350),
        null,
      ]);
    });

    // No code writes a JOB Notification any more; old rows exist, and a
    // Network can write them again. One Job id is on both Networks, in
    // another Workspace on each.
    it("scopes a JOB Notification to the Workspace of its Network's Job", async () => {
      const job = randomUUID();
      const workspaces = { mainnet: randomUUID(), preprod: randomUUID() };

      const scoped = await firing(
        { "shared.notification": ["notification_workspace_membership_scope"] },
        async (db) => {
          for (const [network, workspace] of Object.entries(workspaces)) {
            await db.query(
              `INSERT INTO shared.workspace (id, "updatedAt", "organizationId")
               VALUES ($1, now(), $2)`,
              [workspace, `organization-${network}`],
            );
            await db.query(
              `INSERT INTO ${network}."Job" (id, "updatedAt", "agentId", "agentJobId", "jobType",
                 "workspaceId")
               VALUES ($1, now(), 'agent', $1::text, 'FREE', $2)`,
              [job, workspace],
            );
          }
        },
        async (db) => {
          const rows: unknown[] = [];
          // Without a Network the row is from before the split: Mainnet's.
          for (const network of [null, "mainnet", "preprod"]) {
            const { rows: inserted } = await db.query(
              `INSERT INTO shared.notification (id, "userId", kind, "referenceId", "eventId",
                 "messageKey", "messageParams", network)
               VALUES (gen_random_uuid()::text, 'user', 'JOB', $1, $2, 'key', '{}', $3)
               RETURNING "workspaceId", "organizationId"`,
              [job, `event-${network}`, network],
            );
            rows.push(inserted[0]);
          }
          return rows;
        },
      );

      const mainnet = {
        workspaceId: workspaces.mainnet,
        organizationId: "organization-mainnet",
      };
      expect(scoped).toEqual([
        mainnet,
        mainnet,
        {
          workspaceId: workspaces.preprod,
          organizationId: "organization-preprod",
        },
      ]);
    });
  });
});
