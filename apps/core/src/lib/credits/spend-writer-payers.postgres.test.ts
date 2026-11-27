/**
 * The payers that spend through the credits module, as the transaction
 * history reads their charges, on a real PostgreSQL: a charge drawn from a
 * Project's credits and the pool stays in that Project's history, and how
 * the payer's receipt's time relates to the debit's. Each payer is driven at
 * its own charge function, with its own receipt. Coworker usage is not here:
 * it charges the pool only (`projectId: null`), so it never draws a Project's
 * credits.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createTaskEventTransaction } from "@/helpers/task-credits";
import { sumTransactionHistory } from "@/helpers/transaction-history";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { chargeSeoChatReply } from "@/lib/seo/chat-billing";
import type { TransactionHistoryKind } from "@/schemas/transaction-history.schema";
import { chargeProjectCompetitorCheck } from "@/services/competitor-check.service";
import { createSeoAudit } from "@/services/seo-audit.service";
import { sokoBotUsageCents } from "@/services/soko-bot-billing.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const CASE_TIMEOUT = 300_000;
const CLEANUP_TIMEOUT = 120_000;
const DAY = 86_400_000;
const CREDIT = 10n ** 10n;
/** Charges per payer: one in two is out of order with independent ids. */
const ROUNDS = 30;

const scope = createNetworkScope("mainnet");
const userIds: string[] = [];
const organizationIds: string[] = [];
const workspaceIds: string[] = [];

/** A seated owner of an Organization with no plan, and a Project of it. */
async function organizationWithProject() {
  const userId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Spend writer payers fixture",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  userIds.push(userId);
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Spend writer payers fixture",
      slug: organizationId,
      workspace: { create: { id: workspaceId } },
      members: {
        create: { userId, role: "owner", seatAssignedAt: new Date() },
      },
    },
  });
  organizationIds.push(organizationId);
  workspaceIds.push(workspaceId);
  const project = await prisma.project.create({
    data: { workspaceId, name: "Spend writer payers Project" },
    select: { id: true },
  });
  return { userId, organizationId, workspaceId, projectId: project.id };
}

type Payer = Awaited<ReturnType<typeof organizationWithProject>>;

/**
 * The Project's own credits, then the pool's: a charge of more than
 * `projectCents` draws from both, the Project's first.
 */
async function fund(payer: Payer, projectCents: bigint, poolCents: bigint) {
  const owner = { organizationId: payer.organizationId };
  for (const bucket of [
    { cents: projectCents, days: 40, projectId: payer.projectId },
    { cents: poolCents, days: 10 },
  ]) {
    await scope.networkDb.transaction.create({
      data: {
        amount: bucket.cents,
        ...owner,
        sourceCreditBucket: {
          create: {
            amount: bucket.cents,
            ...owner,
            expiresAt: new Date(Date.now() + bucket.days * DAY),
            ...(bucket.projectId && { projectId: bucket.projectId }),
          },
        },
      },
    });
  }
}

/** The Project's history total, and the charges whose receipt kept the debit's time. */
async function seen(
  payer: Payer,
  kind: TransactionHistoryKind,
  receipts: Array<{ transactionId: string | null; createdAt: Date }>,
) {
  const debits = await scope.networkDb.transaction.findMany({
    where: {
      id: { in: receipts.flatMap((row) => row.transactionId ?? []) },
    },
    select: { id: true, createdAt: true },
  });
  const debitTime = new Map(
    debits.map((debit) => [debit.id, debit.createdAt.getTime()]),
  );
  return {
    projectHistory: await sumTransactionHistory(
      {
        scope: "workspace",
        projectId: payer.projectId,
        // Its charges only: the Project's grants are in its history too.
        kinds: [kind],
        userContext: {
          source: "context",
          userId: payer.userId,
          organizationId: payer.organizationId,
        },
        workspaceContext: {
          workspaceId: payer.workspaceId,
          userId: null,
          organizationId: payer.organizationId,
        },
      },
      prisma,
    ),
    receiptsAtTheDebitsTime: receipts.filter(
      (row) =>
        row.transactionId !== null &&
        debitTime.get(row.transactionId) === row.createdAt.getTime(),
    ).length,
  };
}

describe.skipIf(!enabled)(
  "a charge from a Project and the pool, per payer (PostgreSQL)",
  () => {
    afterAll(async () => {
      const db = scope.networkDb;
      const billedTo = { organizationId: { in: organizationIds } };
      await prisma.taskEvent.deleteMany({
        where: { task: { workspaceId: { in: workspaceIds } } },
      });
      await prisma.task.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await prisma.seoAudit.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await prisma.competitorCheck.deleteMany({
        where: { project: { workspaceId: { in: workspaceIds } } },
      });
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
      "competitor check: keeps the check's charge in its Project's history",
      async () => {
        const payer = await organizationWithProject();
        const charge = chargeProjectCompetitorCheck(payer.projectId);
        for (let round = 0; round < ROUNDS; round += 1) {
          await fund(payer, CREDIT, 2n * CREDIT);
          const check = await prisma.competitorCheck.create({
            data: { projectId: payer.projectId, day: `round-${round}` },
            select: { id: true },
          });
          const charged = await charge({ id: check.id, credits: 3 });
          expect(charged.shortfall).toBe(false);
        }
        const receipts = await prisma.competitorCheck.findMany({
          where: { projectId: payer.projectId },
          select: { transactionId: true, createdAt: true },
        });

        expect(await seen(payer, "unattributed", receipts)).toEqual({
          projectHistory: { credits: 3 * ROUNDS, count: ROUNDS },
          // The check is claimed before it is charged: never one time.
          receiptsAtTheDebitsTime: 0,
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "SEO chat: keeps the reply's charge in its frozen Project's history",
      async () => {
        const payer = await organizationWithProject();
        const created = await createSeoAudit(payer, {
          name: "Spend writer payers audit",
          firstPage: { url: "https://example.test/", relationship: "primary" },
        });
        const auditId = created.auditId;
        if (!auditId) throw new Error("Missing fixture audit");
        const price = sokoBotUsageCents(1_234n, true);
        for (let round = 0; round < ROUNDS; round += 1) {
          await fund(payer, price / 4n, price);
          await serializableTransaction(async (tx) => {
            const transactionId = await chargeSeoChatReply(
              tx,
              {
                userId: payer.userId,
                organizationId: payer.organizationId,
                projectId: payer.projectId,
              },
              0.001234,
            );
            // The turn as the chat saves it: its usage freezes the payer.
            await tx.seoAuditChatTurn.create({
              data: {
                auditId,
                userId: payer.userId,
                idempotencyKey: `round-${round}`,
                requestHash: "spend-writer",
                question: "?",
                scopeSnapshot: {},
                model: "test",
                leaseExpiresAt: new Date(),
                usage: { billing: { projectId: payer.projectId } },
                transactionId,
              },
            });
          }, "Spend writer payers fixture conflict");
        }
        const receipts = await prisma.seoAuditChatTurn.findMany({
          where: { auditId },
          select: { transactionId: true, createdAt: true },
        });

        expect(await seen(payer, "seoChat", receipts)).toMatchObject({
          projectHistory: { count: ROUNDS },
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "Task writer: keeps the event's charge in its Task's Project's history",
      async () => {
        const payer = await organizationWithProject();
        const task = await prisma.task.create({
          data: {
            ownerId: payer.userId,
            creatorUserId: payer.userId,
            organizationId: payer.organizationId,
            workspaceId: payer.workspaceId,
            projectId: payer.projectId,
            name: "Spend writer payers Task",
            status: "RUNNING",
          },
          select: { id: true },
        });
        for (let round = 0; round < ROUNDS; round += 1) {
          await fund(payer, CREDIT, 2n * CREDIT);
          await serializableTransaction(async (tx) => {
            const transactionId = await createTaskEventTransaction({
              userId: payer.userId,
              organizationId: payer.organizationId,
              projectId: payer.projectId,
              cents: 3n * CREDIT,
              scope,
              tx,
            });
            await tx.taskEvent.create({
              data: { taskId: task.id, transactionId },
            });
          }, "Spend writer payers fixture conflict");
        }
        const receipts = await prisma.taskEvent.findMany({
          where: { taskId: task.id },
          select: { transactionId: true, createdAt: true },
        });

        expect(await seen(payer, "task", receipts)).toMatchObject({
          projectHistory: { credits: 3 * ROUNDS, count: ROUNDS },
        });
      },
      CASE_TIMEOUT,
    );
  },
);
