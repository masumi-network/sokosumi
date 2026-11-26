import { randomUUID } from "node:crypto";
import { netType } from "@sokosumi/database/sql-tables";
import type { JobWithListSummaryRelations } from "@sokosumi/database/types/job";
import type { SokoBotCapability } from "@sokosumi/soko-bot";
import { afterAll, describe, expect, it, onTestFinished, vi } from "vitest";

import { createAgentJobForUser } from "@/helpers/job";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { getSokoBotRuntime } from "@/lib/soko-bot/factory";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  onSplitLayout,
  testSchemaNames,
  withFixtureSchemas,
} from "@/test/split-layout";

import { sokoBotControlPlane } from "./soko-bot-control-plane.service";
import { ensureSystemSchedules } from "./soko-bot-proactive.service";
import { sokoBotRuntimeService } from "./soko-bot-runtime.service";
import { adoptCoworkerSpawnedTasks } from "./soko-bot-spawned-task-adoption.service";
import * as taskDomain from "./task-domain.service";

vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

// These fixtures exercise turn reservation and acknowledgement. The lease
// and reconcile suites cover funded starts separately.
vi.mock("./soko-bot-billing.service", async (original) => ({
  ...(await original<typeof import("./soko-bot-billing.service")>()),
  requireSokoBotTurnFunding: vi.fn(),
}));

vi.mock("@/helpers/job", async (original) => ({
  ...(await original<typeof import("@/helpers/job")>()),
  createAgentJobForUser: vi.fn(),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

async function seedBot() {
  const userId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Network writer",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  onTestFinished(() =>
    withFixtureSchemas(async (tx) => {
      await tx.task.deleteMany({ where: { ownerId: userId } });
      await tx.user.delete({ where: { id: userId } });
    }),
  );
  const { id: workspaceId } = await prisma.workspace.create({
    data: { userId },
  });
  const bot = await prisma.sokoBot.create({ data: { userId, workspaceId } });
  return { userId, workspaceId, bot };
}

async function seedLiveTurn(
  { userId, workspaceId, bot }: Awaited<ReturnType<typeof seedBot>>,
  capabilityNames: SokoBotCapability[],
) {
  const future = new Date(Date.now() + 60_000);
  return prisma.sokoBotTurn.create({
    data: {
      sokoBotId: bot.id,
      requestedByUserId: userId,
      workspaceId,
      source: "CHAT",
      status: "RUNNING",
      clientTurnId: randomUUID(),
      userMessage: "Fixture turn",
      capabilityNames,
      deadlineAt: future,
      leaseExpiresAt: future,
      contextSnapshot: {
        create: {
          generatedAt: new Date(),
          schemaVersion: 1,
          hash: "fixture",
          packet: { memory: { version: 0 } },
          byteSize: 0,
          tokenEstimate: 0,
          counts: {},
          omissions: {},
        },
      },
    },
  });
}

function tool(turnId: string, capability: SokoBotCapability, input: unknown) {
  const toolCallId = randomUUID();
  const result = sokoBotRuntimeService.executeTool({
    sessionId: `session-${turnId}`,
    turnId,
    toolCallId,
    capability,
    input,
  });
  return { result, toolCallId };
}

describe.skipIf(!enabled)("Soko Bot Network writers", () => {
  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.$disconnect();
  });

  // Classification and context still join Network tables via the shared client.
  it.skipIf(onSplitLayout).each(["mainnet", "preprod"] as const)(
    "persists the turn input's %s Network",
    async (network) => {
      const { userId, workspaceId } = await seedBot();
      const session = vi
        .spyOn(getSokoBotRuntime(), "createSession")
        .mockResolvedValue({
          sessionId: randomUUID(),
          runtimeVersion: "test",
          acceptedAt: new Date().toISOString(),
        });
      onTestFinished(() => session.mockRestore());
      const started = await sokoBotControlPlane.startTurn({
        network,
        userId,
        workspaceId,
        clientTurnId: randomUUID(),
        message: "How is my board doing?",
        presetRoute: { route: "DIRECT_RESPONSE", reason: "Fixture" },
      });
      await expect(
        prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: started.turnId } }),
      ).resolves.toMatchObject({ network });
    },
  );

  it("tags a hire reservation before seller dispatch and keeps its tag when attaching the Job", async () => {
    const fixture = await seedBot();
    const { userId, workspaceId, bot } = fixture;
    const turn = await seedLiveTurn(fixture, ["hire_agent"]);
    const { networkDb, networkTable } = createNetworkScope("mainnet");
    const agent = await networkDb.agent.create({
      data: {
        blockchainIdentifier: randomUUID(),
        name: "Agent",
        isShown: true,
        lastUptimeCheck: new Date(),
        uptimeCount: 1,
        uptimeCheckCount: 1,
        pricing: { create: { pricingType: "FREE" } },
      },
    });
    const jobId = randomUUID();
    onTestFinished(async () => {
      await withFixtureSchemas(
        (tx) => tx.$executeRaw`
        DELETE FROM ${networkTable("Job")} WHERE "id" = ${jobId}
      `,
      );
      await networkDb.agent.delete({ where: { id: agent.id } });
      await networkDb.agentPricing.delete({ where: { id: agent.pricingId } });
    });
    const decision = await prisma.sokoBotPendingDecision.create({
      data: {
        turnId: turn.id,
        sokoBotId: bot.id,
        workspaceId,
        requestedByUserId: userId,
        toolName: "hire_agent",
        reason: "Fixture",
        proposal: {
          agentId: agent.id,
          inputSchema: { input_data: [] },
          inputData: {},
          maxCredits: 10,
        },
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const reservation = () =>
      prisma.sokoBotDelegation.findUniqueOrThrow({
        where: {
          turnId_toolCallId: {
            turnId: turn.id,
            toolCallId: `decision:${decision.id}`,
          },
        },
      });
    vi.mocked(createAgentJobForUser).mockImplementationOnce(async (input) => {
      await input.beforeSellerStart?.();
      expect(await reservation()).toMatchObject({
        network: "mainnet",
        jobId: null,
        outcome: "processing",
      });
      // The mocked seller boundary supplies the persisted Job. Only its ID
      // reaches the real Core attachment callback.
      const job = { id: jobId } as JobWithListSummaryRelations;
      await withFixtureSchemas(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO ${networkTable("Job")} (
            "id", "updatedAt", "agentId", "workspaceId", "ownerId", "agentJobId", "jobType")
          VALUES (${job.id}, NOW(), ${agent.id}, ${workspaceId}::uuid, ${userId},
            'seller-job', 'FREE'::${netType("mainnet", "JobType")})
        `;
        await input.afterLocalJobCreate?.(job, tx);
      });
      return job;
    });

    await expect(
      sokoBotRuntimeService.resolveDecision(userId, decision.id, true),
    ).resolves.toMatchObject({ status: "ACCEPTED", resultingEntityId: jobId });
    expect(await reservation()).toMatchObject({
      network: "mainnet",
      jobId,
      outcome: "accepted",
    });
  });

  it("tags the Task delegation and the spawned Task adopted in bulk", async () => {
    const fixture = await seedBot();
    const { bot, userId, workspaceId } = fixture;
    const turn = await seedLiveTurn(fixture, ["create_task"]);
    if (onSplitLayout) {
      const {
        DATABASE_SCHEMA_SHARED: shared,
        DATABASE_SCHEMA_MAINNET: mainnet,
      } = testSchemaNames();
      const createTask = taskDomain.createTaskForActor;
      const writeTask = vi.spyOn(taskDomain, "createTaskForActor");
      writeTask.mockImplementationOnce(async (input, tx) => {
        // The Task's legacy History trigger still uses an unqualified name.
        await tx.$executeRawUnsafe(
          `SET LOCAL search_path TO "${shared}", "${mainnet}"`,
        );
        return createTask(input, tx);
      });
      onTestFinished(() => writeTask.mockRestore());
    }
    const creation = tool(turn.id, "create_task", {
      name: "Parent Task",
      status: "READY",
    });
    await expect(creation.result).resolves.toMatchObject({
      name: "Parent Task",
    });
    const parent = await prisma.sokoBotDelegation.findFirstOrThrow({
      where: { turnId: turn.id, toolCallId: creation.toolCallId },
    });
    expect(parent).toMatchObject({ network: "mainnet", kind: "TASK" });
    if (!parent.taskId) throw new Error("Expected the tool to create a Task");
    const vendor = await prisma.vendor.create({
      data: { slug: randomUUID(), name: "Fixture" },
    });
    const coworker = await prisma.coworker.create({
      data: { slug: randomUUID(), name: "Fixture", vendorId: vendor.id },
    });
    onTestFinished(() =>
      withFixtureSchemas(async (tx) => {
        await tx.task.deleteMany({ where: { workspaceId } });
        await tx.coworker.delete({ where: { id: coworker.id } });
        await tx.vendor.delete({ where: { id: vendor.id } });
      }),
    );
    const parentId = parent.taskId;
    const spawned = await withFixtureSchemas(async (tx) => {
      await tx.task.update({
        where: { id: parentId },
        data: {
          assigneeId: coworker.id,
          events: { create: { status: "RUNNING" } },
        },
      });
      return tx.task.create({
        data: {
          workspaceId,
          ownerId: userId,
          creatorCoworkerId: coworker.id,
          name: "Spawned Task",
        },
      });
    });

    await adoptCoworkerSpawnedTasks();
    await expect(
      prisma.sokoBotDelegation.findFirstOrThrow({
        where: { turn: { sokoBotId: bot.id }, taskId: spawned.id },
      }),
    ).resolves.toMatchObject({
      network: "mainnet",
      kind: "TASK",
      action: "follow_subtask",
    });
  });

  it("tags ordinary, watched and built-in schedules and preserves both tool receipt shapes", async () => {
    const fixture = await seedBot();
    const { userId, workspaceId, bot } = fixture;
    const turn = await seedLiveTurn(fixture, [
      "create_schedule",
      "update_schedule",
    ]);
    const task = await withFixtureSchemas((tx) =>
      tx.task.create({
        data: { name: "Watch Target", ownerId: userId, workspaceId },
      }),
    );
    const scheduleInput = {
      timezone: "UTC",
      cronExpression: "0 9 * * *",
      prompt: "Check in",
    };
    const ordinary = await sokoBotControlPlane.createSchedule({
      userId,
      workspaceId,
      network: "preprod",
      name: "Console schedule",
      ...scheduleInput,
    });
    expect(ordinary.network).toBe("preprod");
    await ensureSystemSchedules(bot);
    const builtIns = await prisma.sokoBotSchedule.findMany({
      where: { sokoBotId: bot.id, systemKey: { not: null } },
    });
    expect(builtIns.length).toBeGreaterThan(0);
    expect(builtIns.every((schedule) => schedule.network === "mainnet")).toBe(
      true,
    );

    const create = tool(turn.id, "create_schedule", {
      ...scheduleInput,
      name: "Watched schedule",
      taskId: task.id,
    });
    const created = await create.result;
    const watched = await prisma.sokoBotSchedule.findFirstOrThrow({
      where: { sokoBotId: bot.id, taskId: task.id },
    });
    expect(watched.network).toBe("mainnet");

    async function expectLegacyShape(result: unknown, toolCallId: string) {
      // The same Prisma projection the tools returned before the column.
      const legacyRow = await prisma.sokoBotSchedule.findUniqueOrThrow({
        where: { id: watched.id },
        omit: { network: true },
      });
      expect(result).toStrictEqual(legacyRow);
      const receipt = await prisma.sokoBotToolCall.findUniqueOrThrow({
        where: { turnId_toolCallId: { turnId: turn.id, toolCallId } },
      });
      expect(receipt.result).toStrictEqual(persistedToolResult(legacyRow));
    }

    await expectLegacyShape(created, create.toolCallId);
    const edit = tool(turn.id, "update_schedule", {
      scheduleId: watched.id,
      name: "Renamed",
    });
    await expectLegacyShape(await edit.result, edit.toolCallId);
  });
});
