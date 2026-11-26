/**
 * `packages/database/prisma/network-layout/network-trigger-bodies.sql`: the
 * bodies of the functions on Network tables, one copy per Network from one
 * template. On the split layout each copy must reach its own Network's tables
 * and the shared ones, and never the other Network's. Two kinds of test:
 * - one copy alone: the other Network's schema is renamed away before the
 *   triggers fire, so PostgreSQL refuses a body that names it. The other
 *   Network also holds rows with the same ids and other values, so a copy
 *   that read them would show;
 * - both copies: both schemas stay, one Job id is on both Networks, and each
 *   Network's History row must survive what the other one writes.
 *
 * The rows under test are written with `session_replication_role = replica`,
 * which skips foreign keys, and with the triggers under test set to fire
 * anyway. So no test needs user, Workspace or Agent rows.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";

import { onSplitLayout } from "@/test/split-layout";

import { refusal, rolledBack } from "./rolled-back";

const TEMPLATE = readFileSync(
  new URL(
    "../../../../../../packages/database/prisma/network-layout/network-trigger-bodies.sql",
    import.meta.url,
  ),
  "utf8",
);
const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));
const RENAMED_OTHER_SCHEMA = "network_away";

/** What applying one Network's copy after `setup` answers. */
function copyRefusal(network: string, setup?: string) {
  return refusal(TEMPLATE.replaceAll("@network@", network), setup);
}

describe.runIf(ON_POSTGRES)("Network trigger bodies", () => {
  it("refuses the template as written, before a Network's name is put in", async () => {
    expect(await copyRefusal("@network@")).toBe('syntax error at or near "@"');
  });

  it.runIf(!onSplitLayout)("refuses today's layout", async () => {
    expect(await copyRefusal("mainnet")).toBe(
      "network-trigger-bodies.sql needs the three-schema layout; missing schema: mainnet, shared",
    );
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    it("refuses while a trigger still runs a function of the file outside its Network", async () => {
      const message = await copyRefusal(
        "preprod",
        `ALTER FUNCTION preprod.enforce_job_project_workspace_placement() SET SCHEMA public;
         CREATE FUNCTION preprod.enforce_job_project_workspace_placement() RETURNS trigger
           LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
      );

      expect(message).toContain(
        'trigger job_project_workspace_placement on preprod."Job" runs a enforce_job_project_workspace_placement that is not in preprod',
      );
    });

    it("refuses while a CHECK still runs a function of the file outside its Network", async () => {
      const message = await copyRefusal(
        "preprod",
        `ALTER FUNCTION preprod.canonical_credit_cost_unit(text) SET SCHEMA public;
         CREATE FUNCTION preprod.canonical_credit_cost_unit(text) RETURNS text
           LANGUAGE sql AS 'SELECT $1'`,
      );

      expect(message).toContain(
        'constraint credit_cost_unit_canonical_chk on preprod."CreditCost" runs a canonical_credit_cost_unit that is not in preprod',
      );
    });

    it("refuses a function of the Network's schema that has no digest in the guard", async () => {
      const message = await copyRefusal(
        "preprod",
        `CREATE FUNCTION preprod.without_digest() RETURNS trigger
           LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
      );

      expect(message).toBe(
        "no digest for preprod.without_digest(): add its line to the guard of packages/database/prisma/network-layout/network-trigger-bodies.sql",
      );
    });

    // The split script already applied the copy, so every digest differs
    // from the migrated one and the refusal lists all of them.
    it.each([
      "SET LOCAL quote_all_identifiers = on",
      "SET LOCAL extra_float_digits = -6",
    ])("finds the same digests after %s", async (setting) => {
      const control = await copyRefusal("preprod");

      expect(control).toContain("a migration changed this function:");
      expect(await copyRefusal("preprod", setting)).toBe(control);
    });

    describe.each([
      ["mainnet", "preprod"],
      ["preprod", "mainnet"],
    ])("the copy in %s, with %s renamed away", (network, other) => {
      /**
       * A transaction in which `seed` wrote both Networks, the named triggers
       * of `network` fire, and the other Network's schema is not there.
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
              await db.query(
                `ALTER TABLE ${network}."${table}" ENABLE ALWAYS TRIGGER ${name}`,
              );
            }
          }
          await db.query(
            `ALTER SCHEMA ${other} RENAME TO ${RENAMED_OTHER_SCHEMA}`,
          );
          return run(db);
        });
      }

      it("writes a credit cost's unit through its own function", async () => {
        const id = randomUUID();

        const rows = await firing(
          { CreditCost: ["credit_cost_unit_canonical_write_trg"] },
          async () => undefined,
          async (db) => {
            const own = await db.query(
              `INSERT INTO ${network}."CreditCost" (id, "updatedAt", unit, "centsPerUnit")
               VALUES ($1, now(), $2, 1) RETURNING unit`,
              [id, `  UNIT-${id} `],
            );
            const away = await db.query(
              `SELECT unit FROM ${RENAMED_OTHER_SCHEMA}."CreditCost" WHERE id = $1`,
              [id],
            );
            return { own: own.rows, away: away.rows };
          },
        );

        expect(rows).toEqual({ own: [{ unit: `unit-${id}` }], away: [] });
      });

      it("records a failed x402 payment from its own Transaction, in its own tables", async () => {
        const [payment, charge, refund] = [
          randomUUID(),
          randomUUID(),
          randomUUID(),
        ];

        const rows = await firing(
          {
            task_x402_payment: [
              "task_x402_payment_replay_key_canonical_trg",
              "task_x402_payment_failure_outcome_trg",
            ],
            task_x402_payment_action: [
              "task_x402_payment_action_snapshot_write_trg",
            ],
          },
          async (db) => {
            // The same charge on both Networks, with another amount and owner.
            for (const [schema, cents, user] of [
              [network, 700, "own-user"],
              [other, 900, "other-user"],
            ]) {
              await db.query(
                `INSERT INTO ${schema}."Transaction" (id, "updatedAt", amount, "userId")
                 VALUES ($1, now(), -$3::bigint, $4), ($2, now(), $3::bigint, $4)`,
                [charge, refund, cents, user],
              );
            }
          },
          async (db) => {
            await db.query(
              `INSERT INTO ${network}.task_x402_payment (id, "updatedAt", "idempotencyKey",
                 "caip2Network", asset, amount, "payTo", "taskId", "agentId", "transactionId",
                 "refundTransactionId", status, "failureReason")
               VALUES ($1, now(), $1::text, 'EIP155:8453', 'USDC', '1', 'pay-to', 'task', 'agent', $2,
                 $3, 'FAILED', 'node_refused_payload')`,
              [payment, charge, refund],
            );
            const own = await db.query(
              `SELECT action, cents::int, "caip2Network", "chargedUserId", "chargeTransactionId"
               FROM ${network}.task_x402_payment_action WHERE "paymentId" = $1`,
              [payment],
            );
            const away = await db.query(
              `SELECT action FROM ${RENAMED_OTHER_SCHEMA}.task_x402_payment_action WHERE "paymentId" = $1`,
              [payment],
            );
            return { own: own.rows, away: away.rows };
          },
        );

        expect(rows).toEqual({
          own: [
            {
              action: "failure",
              cents: 700,
              caip2Network: "eip155:8453",
              chargedUserId: "own-user",
              chargeTransactionId: charge,
            },
          ],
          away: [],
        });
      });

      it("places a Job by the shared project's Workspace", async () => {
        const [project, workspace, elsewhere] = [
          randomUUID(),
          randomUUID(),
          randomUUID(),
        ];

        const outcome = await firing(
          { Job: ["job_project_workspace_placement"] },
          (db) =>
            db.query(
              `INSERT INTO shared.project (id, "updatedAt", "workspaceId", name)
               VALUES ($1, now(), $2, 'Network trigger bodies')`,
              [project, workspace],
            ),
          async (db) => {
            const insert = `INSERT INTO ${network}."Job" (id, "updatedAt", "agentId", "agentJobId",
                "jobType", "workspaceId", "projectId")
              VALUES ($1, now(), 'agent', $1, 'FREE', $2, $3) RETURNING "projectId"`;
            const placed = await db.query(insert, [
              randomUUID(),
              workspace,
              project,
            ]);
            // Last: the refusal ends the transaction.
            const refused = await db
              .query(insert, [randomUUID(), elsewhere, project])
              .then(
                () => "placed",
                (error: Error) => error.message,
              );
            return { placed: placed.rows, refused };
          },
        );

        expect(outcome).toEqual({
          placed: [{ projectId: project }],
          refused:
            "Job projectId must reference a project in the same workspace as workspaceId",
        });
      });

      // Where each copy reads and writes. That the two Networks' rows stay
      // apart is the test below, with neither schema renamed away.
      it("keeps a Job's shared History row from its own tables", async () => {
        const [job, charge, event, purchase, input] = [
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
        ];
        const history = `SELECT title, status, amount::int FROM shared.history
          WHERE kind = 'JOB' AND "entityId" = $1 AND network = '${network}'`;

        const rows = await firing(
          {
            Job: ["history_job_sync"],
            jobPurchase: ["history_job_purchase_sync"],
            jobEvent: ["history_job_event_sync"],
            jobInput: ["history_job_input_sync"],
            Transaction: ["history_transaction_sync"],
          },
          async (db) => {
            // The other Network has the same Job and charge: it is free there,
            // failed, and cost another amount.
            await db.query(
              `INSERT INTO ${other}."Job" (id, "updatedAt", "agentId", "agentJobId", "jobType",
                 "workspaceId", name)
               VALUES ($1, now(), 'agent', $1::text, 'FREE', $2, 'other Network')`,
              [job, randomUUID()],
            );
            await db.query(
              `INSERT INTO ${other}."jobEvent" (id, "updatedAt", "jobId", status)
               VALUES ($1, now(), $2, 'FAILED')`,
              [randomUUID(), job],
            );
            for (const [schema, cents] of [
              [network, 700],
              [other, 900],
            ]) {
              await db.query(
                `INSERT INTO ${schema}."Transaction" (id, "updatedAt", amount)
                 VALUES ($1, now(), -$2::bigint)`,
                [charge, cents],
              );
            }
          },
          async (db) => {
            const seen: unknown[] = [];
            const after = async (sql: string, values: unknown[]) => {
              await db.query(sql, values);
              seen.push((await db.query(history, [job])).rows[0] ?? null);
            };
            await after(
              `INSERT INTO ${network}."Job" (id, "updatedAt", "agentId", "agentJobId", "jobType",
                 "workspaceId", name, "transactionId", "blockchainIdentifier", "payByTime",
                 "submitResultTime", "unlockTime", "externalDisputeUnlockTime", "sellerVkey",
                 "identifierFromPurchaser")
               VALUES ($1, now(), 'agent', $1::text, 'PAID', $2, 'own Network', $3, $1::text,
                 now() + interval '1 day', now() + interval '2 days', now() + interval '3 days',
                 now() + interval '4 days', 'vkey', 'purchaser')`,
              [job, randomUUID(), charge],
            );
            await after(
              `INSERT INTO ${network}."jobPurchase" (id, "updatedAt", "externalId", "jobId",
                 "onChainStatus")
               VALUES ($1, now(), $1::text, $2, 'FUNDS_LOCKED')`,
              [purchase, job],
            );
            await after(
              `INSERT INTO ${network}."jobEvent" (id, "updatedAt", "jobId", status)
               VALUES ($1, now(), $2, 'AWAITING_INPUT')`,
              [event, job],
            );
            await after(
              `INSERT INTO ${network}."jobInput" (id, "updatedAt", input, "eventId")
               VALUES ($1, now(), '{}', $2)`,
              [input, event],
            );
            await after(
              `UPDATE ${network}."Transaction" SET amount = -800 WHERE id = $1`,
              [charge],
            );
            await after(
              `UPDATE ${network}."jobEvent" SET status = 'COMPLETED' WHERE id = $1`,
              [event],
            );
            await after(
              `UPDATE ${network}."jobPurchase" SET "onChainStatus" = 'REFUND_REQUESTED' WHERE id = $1`,
              [purchase],
            );
            await after(
              `UPDATE ${network}."jobInput" SET input = '{"a":1}' WHERE id = $1`,
              [input],
            );
            await after(`DELETE FROM ${network}."Job" WHERE id = $1`, [job]);
            const away = await db.query(
              `SELECT name FROM ${RENAMED_OTHER_SCHEMA}."Job" WHERE id = $1`,
              [job],
            );
            return { seen, away: away.rows };
          },
        );

        const title = "own Network";
        expect(rows).toEqual({
          seen: [
            { title, status: "payment_pending", amount: 700 },
            { title, status: "started", amount: 700 },
            { title, status: "input_required", amount: 700 },
            { title, status: "processing", amount: 700 },
            { title, status: "processing", amount: 800 },
            { title, status: "completed", amount: 800 },
            { title, status: "refund_pending", amount: 800 },
            { title, status: "refund_pending", amount: 800 },
            null,
          ],
          away: [{ name: "other Network" }],
        });
      });
    });

    // One Job id on both Networks, with another status, amount and
    // Workspace on each. `acting` writes; `resting`'s row must stay.
    it.each([
      ["mainnet", "preprod"],
      ["preprod", "mainnet"],
    ])(
      "keeps %s's History row of a Job apart from %s's row of the same id",
      async (acting, resting) => {
        const [job, charge, event] = [randomUUID(), randomUUID(), randomUUID()];
        const workspaces = { [acting]: randomUUID(), [resting]: randomUUID() };
        const history = `SELECT network, title, status, amount::int, "workspaceId"
        FROM shared.history WHERE kind = 'JOB' AND "entityId" = $1 ORDER BY network`;

        const seen = await rolledBack(async (db) => {
          await db.query("SET LOCAL session_replication_role = replica");
          for (const schema of [acting, resting]) {
            for (const [table, trigger] of [
              ["Job", "history_job_sync"],
              ["jobEvent", "history_job_event_sync"],
              ["Transaction", "history_transaction_sync"],
            ]) {
              await db.query(
                `ALTER TABLE ${schema}."${table}" ENABLE ALWAYS TRIGGER ${trigger}`,
              );
            }
          }
          const rows: unknown[] = [];
          const after = async (sql: string, values: unknown[]) => {
            await db.query(sql, values);
            rows.push((await db.query(history, [job])).rows);
          };
          // A paid Job without a purchase: its status follows `payByTime`.
          const insertJob = (schema: string, payBy: string) =>
            after(
              `INSERT INTO ${schema}."Job" (id, "updatedAt", "agentId", "agentJobId", "jobType",
                 "workspaceId", name, "transactionId", "blockchainIdentifier", "payByTime",
                 "submitResultTime", "unlockTime", "externalDisputeUnlockTime", "sellerVkey",
                 "identifierFromPurchaser")
               VALUES ($1, now(), 'agent', $1::text, 'PAID', $2, $3, $4, $1::text,
                 now() + $5::interval, now() + interval '2 days', now() + interval '3 days',
                 now() + interval '4 days', 'vkey', 'purchaser')`,
              [job, workspaces[schema], schema, charge, payBy],
            );
          for (const [schema, cents] of [
            [resting, 900],
            [acting, 700],
          ]) {
            await db.query(
              `INSERT INTO ${schema}."Transaction" (id, "updatedAt", amount)
             VALUES ($1, now(), -$2::bigint)`,
              [charge, cents],
            );
          }
          await insertJob(resting, "-1 day");
          await insertJob(acting, "1 day");
          await after(
            `INSERT INTO ${acting}."jobEvent" (id, "updatedAt", "jobId", status)
           VALUES ($1, now(), $2, 'COMPLETED')`,
            [event, job],
          );
          await after(
            `UPDATE ${acting}."Transaction" SET amount = -800 WHERE id = $1`,
            [charge],
          );
          // The Job's own delete, then the delete its sync functions make when
          // they no longer find the Job.
          await after(`DELETE FROM ${acting}."Job" WHERE id = $1`, [job]);
          await after(`DELETE FROM ${acting}."jobEvent" WHERE id = $1`, [
            event,
          ]);
          return rows;
        });

        const row = (network: string, status: string, amount: number) => ({
          network,
          title: network,
          status,
          amount,
          workspaceId: workspaces[network],
        });
        const rested = row(resting, "payment_failed", 900);
        const both = (amount: number) =>
          [row(acting, "payment_pending", amount), rested].sort((a, b) =>
            a.network.localeCompare(b.network),
          );
        expect(seen).toEqual([
          [rested],
          both(700),
          both(700),
          both(800),
          [rested],
          [rested],
        ]);
      },
    );
  });
});
