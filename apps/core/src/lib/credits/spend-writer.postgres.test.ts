/**
 * What the debit's rows tell the transaction history, on a real PostgreSQL:
 * the order of a spend's consumptions and the debit's time. The history
 * names a spend's Project by its first consumption (lowest `createdAt`, then
 * `id`) when no receipt names one, and filters by the debit's time. One
 * nested Prisma create gave the consumptions ordered ids and one time for
 * the debit and the receipt; `recordSpend` must keep both.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { sumTransactionHistory } from "@/helpers/transaction-history";
import { spend } from "@/lib/credits/spend";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/** A thousand transactions on a loaded machine: well past Vitest's 5 s. */
const CASE_TIMEOUT = 300_000;
const CLEANUP_TIMEOUT = 120_000;
const DAY = 86_400_000;
const CREDIT = 10n ** 10n;
const SPENDS = 1_000;

const scope = createNetworkScope("mainnet");
const userIds: string[] = [];
const organizationIds: string[] = [];
const workspaceIds: string[] = [];

async function createUser(): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: "Spend writer fixture",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  userIds.push(id);
  return id;
}

/** Buckets with their source grants, written in two statements. */
async function grantBuckets(
  buckets: Array<{
    cents: bigint;
    expiresAt: Date;
    owner: { userId: string } | { organizationId: string };
    projectId?: string;
  }>,
): Promise<string[]> {
  const db = scope.networkDb;
  const grants = buckets.map((bucket) => ({
    id: randomUUID(),
    amount: bucket.cents,
    ...bucket.owner,
  }));
  await db.transaction.createMany({ data: grants });
  const rows = buckets.map((bucket, index) => ({
    id: randomUUID(),
    amount: bucket.cents,
    expiresAt: bucket.expiresAt,
    sourceTransactionId: grants[index]?.id ?? "",
    ...bucket.owner,
    ...(bucket.projectId && { projectId: bucket.projectId }),
  }));
  await db.creditBucket.createMany({ data: rows });
  return rows.map((row) => row.id);
}

/** An Organization with a Project in its workspace, no plan and no member. */
async function organizationWithProject() {
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Spend writer fixture",
      slug: organizationId,
      workspace: { create: { id: workspaceId } },
    },
  });
  organizationIds.push(organizationId);
  workspaceIds.push(workspaceId);
  const project = await prisma.project.create({
    data: { workspaceId, name: "Spend writer Project" },
    select: { id: true },
  });
  return { organizationId, workspaceId, projectId: project.id };
}

function spendInFull(
  payer: {
    userId: string | null;
    organizationId: string | null;
    projectId: string | null;
  },
  cents: bigint,
) {
  return scope.sharedTransaction(
    (tx) => spend({ scope, tx, payer, quotedCents: cents, mode: "in_full" }),
    "Spend writer fixture conflict",
  );
}

describe.skipIf(!enabled)(
  "the debit's rows, as history reads them (PostgreSQL)",
  () => {
    afterAll(async () => {
      const db = scope.networkDb;
      const billedTo = {
        OR: [
          { userId: { in: userIds } },
          { organizationId: { in: organizationIds } },
        ],
      };
      await db.creditConsumption.deleteMany({
        where: { transaction: billedTo },
      });
      await db.creditBucket.deleteMany({ where: billedTo });
      await db.transaction.deleteMany({ where: billedTo });
      await prisma.project.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: workspaceIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }, CLEANUP_TIMEOUT);

    it(
      "gives every spend's consumptions ids in the order its buckets paid, and the debit's time to all of them",
      async () => {
        const userId = await createUser();
        const start = Date.now() + DAY;
        // Two one-cent buckets per spend, each expiring after the one before:
        // the n-th spend of two cents takes buckets 2n and 2n + 1, in that order.
        const bucketIds = await grantBuckets(
          Array.from({ length: SPENDS * 2 }, (_unused, index) => ({
            cents: 1n,
            expiresAt: new Date(start + index * 1_000),
            owner: { userId },
          })),
        );
        const payer = { userId, organizationId: null, projectId: null };

        const spent = [];
        for (let index = 0; index < SPENDS; index += 1) {
          const result = await spendInFull(payer, 2n);
          if (result.shortfall) throw new Error("The fixture ran dry");
          spent.push(result);
        }

        const debits = await scope.networkDb.transaction.findMany({
          where: { id: { in: spent.map((result) => result.transactionId) } },
          select: {
            id: true,
            createdAt: true,
            creditConsumptions: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { bucketId: true, createdAt: true },
            },
          },
        });
        const byId = new Map(debits.map((debit) => [debit.id, debit]));
        const seen = spent.map((result, index) => {
          const debit = byId.get(result.transactionId);
          return {
            // As the history reads them: lowest (createdAt, id) first.
            bucketsInIdOrder: debit?.creditConsumptions.map(
              (row) => row.bucketId,
            ),
            times: [
              debit?.createdAt.getTime(),
              ...(debit?.creditConsumptions ?? []).map((row) =>
                row.createdAt.getTime(),
              ),
            ],
            expected: {
              buckets: [bucketIds[index * 2], bucketIds[index * 2 + 1]],
              time: result.createdAt.getTime(),
            },
          };
        });
        const outOfOrder = seen.filter(
          (one) =>
            JSON.stringify(one.bucketsInIdOrder) !==
            JSON.stringify(one.expected.buckets),
        ).length;
        const otherTime = seen.filter((one) =>
          one.times.some((time) => time !== one.expected.time),
        ).length;
        expect({ outOfOrder, otherTime }).toEqual({
          outOfOrder: 0,
          otherTime: 0,
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "keeps a spend drawn from a Project and the pool in that Project's history, with no receipt to name it",
      async () => {
        const { organizationId, workspaceId, projectId } =
          await organizationWithProject();
        const owner = { organizationId };
        const payer = { userId: null, organizationId, projectId };
        const rounds = 50;
        for (let round = 0; round < rounds; round += 1) {
          // One credit of the Project's own, then two of the pool: a spend of
          // three takes the Project's first.
          await grantBuckets([
            {
              cents: CREDIT,
              expiresAt: new Date(Date.now() + 40 * DAY),
              owner,
              projectId,
            },
            {
              cents: 2n * CREDIT,
              expiresAt: new Date(Date.now() + 10 * DAY),
              owner,
            },
          ]);
          const result = await spendInFull(payer, 3n * CREDIT);
          if (result.shortfall) throw new Error("The fixture ran dry");
        }

        const history = {
          scope: "workspace" as const,
          userContext: {
            source: "context" as const,
            userId: "spend-writer-reader",
            organizationId,
          },
          workspaceContext: { workspaceId, userId: null, organizationId },
        };
        expect({
          project: await sumTransactionHistory(
            { ...history, projectId, kinds: ["unattributed"] },
            prisma,
          ),
          noProject: await sumTransactionHistory(
            { ...history, projectId: null, kinds: ["unattributed"] },
            prisma,
          ),
        }).toEqual({
          project: { credits: 3 * rounds, count: rounds },
          noProject: { credits: 0, count: 0 },
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "finds the debit from the time it returns, the time a receipt takes",
      async () => {
        const rounds = 50;
        const found = [];
        for (let round = 0; round < rounds; round += 1) {
          // An Organization each, so only this round's debit can be found.
          const { organizationId, workspaceId } =
            await organizationWithProject();
          const owner = { organizationId };
          const payer = { userId: null, organizationId, projectId: null };
          await grantBuckets([
            {
              cents: CREDIT,
              expiresAt: new Date(Date.now() + 10 * DAY),
              owner,
            },
          ]);
          const result = await spendInFull(payer, CREDIT);
          if (result.shortfall) throw new Error("The fixture ran dry");
          // The ledger reader as a receipt's page asks it: from the receipt's
          // own creation time, which is the debit's.
          found.push(
            await sumTransactionHistory(
              {
                scope: "workspace",
                userContext: {
                  source: "context",
                  userId: "spend-writer-reader",
                  organizationId,
                },
                workspaceContext: { workspaceId, userId: null, organizationId },
                from: result.createdAt,
                kinds: ["unattributed"],
              },
              prisma,
            ),
          );
        }
        expect(found.filter((one) => one.count !== 1)).toEqual([]);
      },
      CASE_TIMEOUT,
    );
  },
);
