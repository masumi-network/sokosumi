/**
 * `packages/database/prisma/network-layout/network-trigger-bodies.sql`: the
 * bodies of the functions on Network tables, one copy per Network from one
 * template. On the split layout each copy must reach its own Network's tables
 * and the shared ones, and never the other Network's: every test here renames
 * the other Network's schema away before it fires the triggers, so PostgreSQL
 * refuses a body that names it. The other Network also holds rows with the
 * same ids and other values, so a copy that read them would show.
 *
 * The rows under test are written with `session_replication_role = replica`,
 * which skips foreign keys, and with the triggers under test set to fire
 * anyway. So no test needs a Task: creating one fires a trigger on a shared
 * table that still waits for the row's Network (ticket 19 part 2).
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

    it("finds the same digests when the session quotes every identifier", async () => {
      expect(
        await copyRefusal("preprod", "SET LOCAL quote_all_identifiers = on"),
      ).toBe(await copyRefusal("preprod"));
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
    });
  });
});
