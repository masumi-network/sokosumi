import type { Prisma } from "@sokosumi/database";
import { netTable } from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Network } from "@/lib/network";
import { onSplitLayout } from "@/test/split-layout";
import {
  type DeletionWorld,
  insertRow,
  seedDeletionWorld,
} from "@/test-fixtures/user-deletion-world";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

type Tx = Prisma.TransactionClient;
type Id = DeletionWorld["id"];

// How a payment or claim can reach Ada: her charge, her refund, her Task.
const REACHES = {
  "charged to Ada": (id: Id) => ({
    taskId: id("task.bob"),
    transactionId: id("transaction.adaSpend"),
  }),
  "refunded to Ada": (id: Id) => ({
    taskId: id("task.bob"),
    transactionId: id("transaction.bob.a"),
    refundTransactionId: id("transaction.adaGrant"),
  }),
  "on a Task Ada owns": (id: Id) => ({
    taskId: id("task.public"),
    transactionId: id("transaction.bob.a"),
  }),
  "of Bob alone": (id: Id) => ({
    taskId: id("task.bob"),
    transactionId: id("transaction.bob.a"),
  }),
} as const;
type Reach = keyof typeof REACHES;

describe.runIf(ON_POSTGRES)(
  "the account deletion's statements on a Network's rows",
  () => {
    let prisma: typeof import("@/lib/db/prisma").default;
    let statements: typeof import("./user-deletion-network");
    const networks: Network[] = onSplitLayout
      ? ["mainnet", "preprod"]
      : ["mainnet"];

    beforeAll(async () => {
      vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
      ({ default: prisma } = await import("@/lib/db/prisma"));
      statements = await import("./user-deletion-network");
    }, 60_000);

    afterAll(() => vi.unstubAllEnvs());

    /** Seeds the world, runs `run` on it, and rolls everything back. */
    async function inWorld(
      run: (tx: Tx, world: DeletionWorld) => Promise<void>,
    ): Promise<void> {
      const rollback = new Error("Roll back the world");
      await expect(
        prisma.$transaction(
          async (tx) => {
            await run(tx, await seedDeletionWorld(tx, networks));
            throw rollback;
          },
          { timeout: 60_000 },
        ),
      ).rejects.toBe(rollback);
    }

    describe.each(networks)("on %s", (network) => {
      const exists = async (tx: Tx, table: "payment" | "claim", id: string) => {
        const rows =
          table === "payment"
            ? await tx.$queryRaw<unknown[]>`
                SELECT 1 FROM ${netTable(network, "task_x402_payment")} WHERE "id" = ${id}`
            : await tx.$queryRaw<unknown[]>`
                SELECT 1 FROM ${netTable(network, "task_payment_claim")} WHERE "id" = ${id}`;
        return rows.length === 1;
      };

      it.each(Object.keys(REACHES) as Reach[])(
        "blocks on, and sweeps, a payment %s",
        async (reach) => {
          const reaches = reach !== "of Bob alone";
          const foreign =
            reach === "refunded to Ada" || reach === "on a Task Ada owns";
          await inWorld(async (tx, { ada, bob, id }) => {
            const payment = (name: string, row: Record<string, unknown>) =>
              insertRow(tx, netTable(network, "task_x402_payment"), {
                id: id(name),
                updatedAt: "2026-01-01T00:00:00",
                idempotencyKey: id(name),
                caip2Network: "test",
                asset: "test",
                amount: "1",
                payTo: "test",
                agentId: id("agent"),
                ...REACHES[reach](id),
                ...row,
              });
            const now = new Date("2026-06-01T00:00:00Z");

            // The world's own payments are terminal and without a header.
            expect(
              await statements.findUnresolvedX402Payment(tx, network, ada),
            ).toBeUndefined();
            expect(
              await statements.findLiveAuthorizationX402Payment(
                tx,
                network,
                ada,
                now,
              ),
            ).toBeUndefined();

            await tx.$executeRaw`SAVEPOINT payment`;
            await payment("pending", { status: "PENDING" });
            expect(
              await statements.findUnresolvedX402Payment(tx, network, ada),
            ).toEqual(
              reaches ? { id: id("pending"), status: "PENDING" } : undefined,
            );
            expect(
              await statements.findForeignChargeX402Payment(tx, network, ada),
            ).toBeUndefined();
            await statements.deleteSweepableX402Payments(tx, network, ada);
            expect(await exists(tx, "payment", id("pending"))).toBe(true);
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT payment`;

            // A header counts in every status, until its expiry has passed.
            for (const [validBefore, live] of [
              [null, true],
              ["2026-06-01T00:00:01", true],
              ["2026-05-31T23:59:59", false],
            ] as const) {
              await payment("signed", {
                status: "FAILED",
                xPaymentHeader: "header",
                validBefore,
              });
              expect(
                await statements.findLiveAuthorizationX402Payment(
                  tx,
                  network,
                  ada,
                  now,
                ),
              ).toEqual(reaches && live ? { id: id("signed") } : undefined);
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT payment`;
            }

            await payment("terminal", { status: "REFUNDED" });
            expect(
              await statements.findForeignChargeX402Payment(tx, network, ada),
            ).toEqual(
              foreign
                ? {
                    id: id("terminal"),
                    taskId: REACHES[reach](id).taskId,
                    chargedUserId: bob,
                  }
                : undefined,
            );
            await statements.lockX402PaymentsOfUser(tx, network, ada);
            await statements.deleteSweepableX402Payments(tx, network, ada);
            expect(await exists(tx, "payment", id("terminal"))).toBe(!reaches);
            // Swept with Ada's own; Bob's other payments stay.
            expect(await exists(tx, "payment", id("payment.private"))).toBe(
              false,
            );
            expect(
              await exists(tx, "payment", id("payment.onPrivateEvent")),
            ).toBe(true);
          });
        },
      );

      it("blocks on a pending claim on Ada's charge, a reviewed one first, and sweeps the terminal ones", async () => {
        await inWorld(async (tx, { ada, id }) => {
          const claim = (name: string, row: Record<string, unknown>) =>
            insertRow(tx, netTable(network, "task_payment_claim"), {
              id: id(name),
              updatedAt: "2026-01-01T00:00:00",
              network: "preprod",
              blockchainIdentifier: id(name),
              purchasePayload: {},
              ...row,
            });
          const find = async () => [
            await statements.findReviewRequiredClaim(tx, network, ada),
            await statements.findPendingClaim(tx, network, ada),
          ];
          expect(await find()).toEqual([undefined, undefined]);

          await claim("bobs", {
            status: "PENDING",
            reviewRequiredAt: "2026-03-01T00:00:00",
            transactionId: id("transaction.bob.a"),
          });
          expect(await find()).toEqual([undefined, undefined]);

          await claim("pending", {
            status: "PENDING",
            transactionId: id("transaction.adaSpend"),
          });
          expect(await find()).toEqual([undefined, { id: id("pending") }]);

          await claim("reviewed", {
            status: "PENDING",
            reviewRequiredAt: "2026-03-01T00:00:00",
            transactionId: id("transaction.adaGrant"),
          });
          const [reviewed] = await find();
          expect(reviewed).toEqual({
            id: id("reviewed"),
            reviewRequiredAt: new Date("2026-03-01T00:00:00Z"),
          });

          await claim("refunded", {
            status: "REFUNDED",
            transactionId: id("transaction.bob.b"),
            refundTransactionId: id("transaction.adaPayment"),
          });
          await statements.deleteTerminalClaims(tx, network, ada);
          const claims: [string, boolean][] = [];
          for (const name of [
            "claim.terminal",
            "refunded",
            "pending",
            "reviewed",
            "bobs",
            "claim.onPersonalEvent",
          ]) {
            claims.push([name, await exists(tx, "claim", id(name))]);
          }
          expect(claims).toEqual([
            ["claim.terminal", false],
            ["refunded", false],
            ["pending", true],
            ["reviewed", true],
            ["bobs", true],
            ["claim.onPersonalEvent", true],
          ]);
        });
      });

      it("deletes the Jobs on Ada's private Tasks and in her personal workspace, no other", async () => {
        await inWorld(async (tx, { ada, id }) => {
          const jobs = await statements.deleteJobsOfUser(tx, network, ada);
          expect(jobs.sort()).toEqual(
            [
              id("job.personal"),
              id("job.private"),
              // On Mainnet the twin is Bob's.
              ...(network === "mainnet" ? [] : [id("job.twin")]),
            ].sort(),
          );
          const left = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM ${netTable(network, "Job")} WHERE "id" = ANY(${jobs})`;
          expect(left).toEqual([]);
          expect(await statements.deleteJobsOfUser(tx, network, ada)).toEqual(
            [],
          );
        });
      });
    });
  },
);
