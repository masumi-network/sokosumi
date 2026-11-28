import { randomUUID } from "node:crypto";
import { convertCreditsToCents } from "@sokosumi/utils";
import type { Pool } from "pg";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as env from "@/config/env";
import { errorHandler } from "@/helpers/error-handler";
import { createNetworkScope, type NetworkDb } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { createNestedOpenAPIHono } from "@/lib/hono";
import { taskCreditsCharged } from "@/lib/soko-bot/task-charges";
import mountAction from "@/routes/v1/admin/soko-bots/[sokoBotId]/actions/post";
import mountDetail from "@/routes/v1/admin/soko-bots/[sokoBotId]/get";
import mountUsage, { mountById } from "@/routes/v1/soko-bots/me/usage/get";
import { observing } from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";
import { activityStats } from "./soko-bot-activity-stats.service";
import { sokoBotUsageTotals } from "./soko-bot-usage.service";

vi.mock("@vercel/functions", async (original) => {
  const actual = await original<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    attachDatabasePool(pool: Pool) {
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const since = new Date("2000-01-01");
const until = new Date("2099-01-01");

async function moneyFixture() {
  const userId = randomUUID();
  const otherId = randomUUID();
  const workspaceId = randomUUID();
  const main = createNetworkScope("mainnet").networkDb;
  const agents: { db: NetworkDb; id: string; pricingId: string }[] = [];
  const owners = { in: [userId, otherId] };
  const dbs = [main];
  onTestFinished(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.sokoBot.deleteMany({ where: { workspaceId } });
    for (const db of dbs) {
      await db.job.deleteMany({ where: { workspaceId } });
      await db.sokoBotUsage.deleteMany({ where: { userId } });
      await db.creditBucket.deleteMany({ where: { userId } });
      await db.transaction.deleteMany({ where: { userId } });
    }
    for (const { db, id, pricingId } of agents) {
      await db.agent.delete({ where: { id } });
      await db.agentPricing.delete({ where: { id: pricingId } });
    }
    await prisma.coworker.deleteMany({ where: { slug: userId } });
    await prisma.vendor.deleteMany({ where: { slug: userId } });
    await prisma.organization.deleteMany({ where: { slug: userId } });
    await prisma.user.deleteMany({ where: { id: owners } });
    vi.restoreAllMocks();
  });
  await prisma.user.createMany({
    data: [userId, otherId].map((id) => ({
      id,
      name: id,
      email: id + "@example.test",
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: true,
    })),
  });
  const org = await prisma.organization.create({
    data: {
      name: "Reader fixture",
      slug: userId,
      workspace: { create: { id: workspaceId } },
      members: { create: { userId, role: "owner" } },
    },
  });
  const worker = await prisma.coworker.create({
    data: {
      name: "Reader",
      slug: userId,
      vendor: { create: { name: "Reader", slug: userId } },
    },
  });
  const bot = await prisma.sokoBot.create({ data: { workspaceId, userId } });
  const turn = await prisma.sokoBotTurn.create({
    data: {
      sokoBotId: bot.id,
      workspaceId,
      source: "CHAT",
      status: "COMPLETED",
      clientTurnId: randomUUID(),
      userMessage: "test",
      capabilityNames: [],
      deadlineAt: new Date(),
    },
  });
  const task = (ownerId: string, assigneeId: string | null) =>
    prisma.task.create({
      data: { workspaceId, ownerId, assigneeId, name: "Reader task" },
    });
  const assigned = await task(userId, worker.id);
  const unassigned = await task(userId, null);
  const other = await task(otherId, worker.id);
  const transaction = (db: NetworkDb, credits: number, id?: string) =>
    db.transaction.create({
      data: {
        ...(id && { id }),
        userId,
        amount: convertCreditsToCents(credits),
      },
    });
  const event = (
    taskId: string,
    transactionId: string | null,
    network: "mainnet" | "preprod" | null,
  ) => prisma.taskEvent.create({ data: { taskId, transactionId, network } });
  await event(assigned.id, (await transaction(main, -3)).id, null);
  await event(assigned.id, (await transaction(main, 4)).id, "mainnet");
  await event(assigned.id, null, null);
  await event(unassigned.id, (await transaction(main, -2)).id, "mainnet");
  await event(other.id, (await transaction(main, -11)).id, "mainnet");

  async function job(
    db: NetworkDb,
    credits: number,
    refund: number,
    id?: string,
  ) {
    let agent = agents.find((entry) => entry.db === db);
    if (!agent) {
      const created = await db.agent.create({
        data: {
          name: "Reader agent",
          isShown: false,
          blockchainIdentifier: randomUUID(),
          lastUptimeCheck: new Date(),
          uptimeCount: 1,
          uptimeCheckCount: 1,
          pricing: { create: { pricingType: "FREE" } },
        },
      });
      agent = { db, id: created.id, pricingId: created.pricingId };
      agents.push(agent);
    }
    const now = new Date();
    return db.job.create({
      data: {
        ...(id && { id }),
        workspaceId,
        ownerId: userId,
        agentId: agent.id,
        agentJobId: randomUUID(),
        jobType: "PAID",
        blockchainIdentifier: randomUUID(),
        sellerVkey: "seller",
        identifierFromPurchaser: "buyer",
        payByTime: now,
        submitResultTime: now,
        unlockTime: now,
        externalDisputeUnlockTime: now,
        transactionId: (await transaction(db, -credits)).id,
        refundedTransactionId: refund
          ? (await transaction(db, refund)).id
          : null,
      },
    });
  }
  const refundPart = (jobId: string) =>
    main.transaction.create({
      data: {
        userId,
        amount: convertCreditsToCents(2),
        sourceCreditBucket: {
          create: {
            userId,
            referenceType: "REFUND",
            referenceId: jobId + "#pool",
            amount: convertCreditsToCents(2),
          },
        },
      },
    });
  const legacyJob = await job(main, 10, 3);
  await refundPart(legacyJob.id);
  const paid = await job(main, 6, 0);
  const jobReceipt = (
    jobId: string,
    network: "mainnet" | "preprod" | null,
    action = "hire_agent",
  ) =>
    prisma.sokoBotDelegation.create({
      data: {
        turnId: turn.id,
        toolCallId: randomUUID(),
        kind: "JOB",
        action,
        jobId,
        network,
      },
    });
  await jobReceipt(legacyJob.id, null);
  await jobReceipt(paid.id, "mainnet");
  await jobReceipt(paid.id, "mainnet", "read_job");
  const taskReceipt = (taskId: string, action: string) =>
    prisma.sokoBotDelegation.create({
      data: {
        turnId: turn.id,
        toolCallId: randomUUID(),
        kind: "TASK",
        action,
        taskId,
        network: "mainnet",
      },
    });
  const receipt = await taskReceipt(assigned.id, "create_task");
  await taskReceipt(unassigned.id, "assign_task");
  await taskReceipt(unassigned.id, "create_task");
  await taskReceipt(other.id, "read_task");
  await main.sokoBotUsage.create({
    data: {
      sokoBotId: bot.id,
      userId,
      idempotencyKey: "usage",
      transactionId: (await transaction(main, -7)).id,
      cents: convertCreditsToCents(7),
    },
  });

  return {
    bot: { id: bot.id, workspaceId, userId },
    orgId: org.id,
    assigned,
    unassigned,
    main,
    job,
    jobReceipt,
    refundPart,
    event,
    transaction,
    receipt,
    dbs,
  };
}

describe.skipIf(!enabled)("Mainnet Soko Bot money readers", () => {
  it("keeps legacy and Mainnet spend when Preprod receipts name the same Job and transaction", async () => {
    const f = await moneyFixture();
    const { bot, main, assigned, unassigned } = f;
    const ids = [assigned.id, unassigned.id];
    const read = async (excludedRefund?: string) => {
      const usage = await observing(() => sokoBotUsageTotals(bot.id));
      expect(usage.outcome).toMatchObject({
        delegatedCredits: 16,
        credits: 7,
        totalCredits: 23,
      });
      expect(usage.log).toHaveLength(5);
      if (excludedRefund)
        expect(usage.log.flatMap((row) => row.values)).not.toContain(
          excludedRefund + "#",
        );
      const tasks = await observing(() => taskCreditsCharged(ids));
      expect(tasks.outcome).toEqual(
        new Map([
          [assigned.id, 3],
          [unassigned.id, 2],
        ]),
      );
      expect(tasks.log).toHaveLength(1);
      const stats = await observing(() => activityStats(bot, since, until));
      expect(stats.outcome).toMatchObject({
        botCredits: 7,
        coworkerCredits: [
          { name: "Reader", credits: 3 },
          { name: "Unassigned", credits: 2 },
        ],
      });
      expect(stats.log).toHaveLength(15);
      return {
        usage: usage.outcome,
        tasks: tasks.outcome,
        stats: stats.outcome,
      };
    };
    const clean = await read();
    expect(await taskCreditsCharged([assigned.id])).toEqual(
      new Map([[assigned.id, 3]]),
    );
    expect((await sokoBotUsageTotals(randomUUID())).delegatedCredits).toBe(0);
    for (const [scope, start, end] of [
      [{ ...bot, workspaceId: randomUUID() }, since, until],
      [bot, new Date("1990-01-01"), since],
      [bot, until, new Date("2100-01-01")],
    ] as const) {
      expect((await activityStats(scope, start, end)).coworkerCredits).toEqual(
        [],
      );
    }
    const collisionJob = await f.job(main, 10, 0);
    const collisionDebit = await f.transaction(main, -3);
    if (onSplitLayout) {
      vi.spyOn(env, "getEnv").mockReturnValue({
        ...env.getEnv(),
        NETWORK_PREPROD_ENABLED: true,
      });
      const preprod = createNetworkScope("preprod").networkDb;
      f.dbs.push(preprod);
      await f.job(preprod, 1, 0, collisionJob.id);
      await f.transaction(preprod, 0, collisionDebit.id);
    }
    await f.jobReceipt(collisionJob.id, "preprod");
    await f.event(assigned.id, collisionDebit.id, "preprod");
    await prisma.sokoBotDelegation.update({
      where: { id: f.receipt.id },
      data: { network: "preprod" },
    });
    expect(await read()).toEqual(clean);

    const refunded = await f.job(main, 10, 3);
    await f.refundPart(refunded.id);
    await f.jobReceipt(refunded.id, "preprod");
    expect(await read(refunded.id)).toEqual(clean);

    const app = createNestedOpenAPIHono().onError(errorHandler);
    app.use("*", async (c, next) => {
      c.set("requestId", randomUUID());
      c.set("authContext", {
        actor: "user",
        userId: bot.userId,
        role: "admin",
        organizationId: f.orgId,
      });
      c.set("workspaceContext", {
        workspaceId: bot.workspaceId,
        organizationId: f.orgId,
        userId: null,
      });
      await next();
    });
    const userRoutes = createNestedOpenAPIHono();
    mountUsage(userRoutes);
    mountById(userRoutes);
    app.route("/v1/soko-bots", userRoutes);
    const adminRoutes = createNestedOpenAPIHono();
    mountDetail(adminRoutes);
    mountAction(adminRoutes);
    app.route("/v1/admin/soko-bots", adminRoutes);
    for (const path of [
      "/v1/soko-bots/me/usage",
      `/v1/soko-bots/${bot.id}/usage`,
      `/v1/admin/soko-bots/${bot.id}`,
      `/v1/admin/soko-bots/${bot.id}/actions`,
    ]) {
      const response = await app.request(
        path,
        path.endsWith("/actions")
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                operationId: "pause",
                action: "PAUSE",
                reason: "reader fixture",
              }),
            }
          : undefined,
      );
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(path.endsWith("/usage") ? body.data : body.data.usage).toEqual(
        clean.usage,
      );
    }
  }, 60_000);
});
