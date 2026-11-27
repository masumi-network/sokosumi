import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import {
  createSqlTables,
  netType,
  sharedTable,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import type { JobWithListSummaryRelations } from "@sokosumi/database/types/job";
import type { SokoBotCapability } from "@sokosumi/soko-bot";
import { err } from "neverthrow";
import { escapeLiteral } from "pg";
import { afterAll, describe, expect, it, onTestFinished, vi } from "vitest";

import { createAgentJobForUser } from "@/helpers/job";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import {
  PREPROD_GENERATION_KEY,
  PREPROD_PAUSE_KEY,
} from "@/helpers/preprod-control";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import * as transactions from "@/lib/db/transaction";
import type { EnvVariables } from "@/lib/hono";
import { getSokoBotRuntime } from "@/lib/soko-bot/factory";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import mountConsoleSchedule from "@/routes/v1/soko-bots/me/schedules/post";
import { recordStatements } from "@/test/record-statements";
import {
  onSplitLayout,
  testSchemaNames,
  withFixtureSchemas,
} from "@/test/split-layout";
import { testNetworkScope } from "@/test-fixtures/network-scope";

import { sokoBotControlPlane } from "./soko-bot-control-plane.service";
import { ensureSystemSchedules } from "./soko-bot-proactive.service";
import { sokoBotRuntimeService } from "./soko-bot-runtime.service";
import { adoptCoworkerSpawnedTasks } from "./soko-bot-spawned-task-adoption.service";

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

vi.mock("@sokosumi/masumi", async (original) => {
  const masumi = await original<typeof import("@sokosumi/masumi")>();
  return {
    ...masumi,
    createAgentClient: () => ({
      ...masumi.createAgentClient(),
      provideJobInput: async () =>
        err({ kind: "unreachable", message: "Seller fixture refused input" }),
    }),
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

// Counts measured at the pool against origin/main on each layout.
const mainnetStatements = {
  "hire approval": [32, 32],
  "input refusal": [32, 32],
  "attach null": [31, 31],
  "attach mainnet": [31, 31],
  "attach preprod": [31, 31],
  "recover null": [9, 9],
  "recover mainnet": [9, 9],
  create_task: [55, 58],
  adopt: [6, 6],
  archive_task: [53, 56],
  update_task: [56, 59],
  assign_task: [57, 60],
  update_assigned_task: [55, 58],
  reply_to_task: [54, 57],
  create_schedule: [57, 57],
} as const;

async function countMainnetStatements<T>(
  label: keyof typeof mainnetStatements,
  run: () => Promise<T>,
) {
  const recorder = recordStatements();
  try {
    return await run();
  } finally {
    recorder.restore();
    expect(recorder.statements.flat(Infinity)).not.toContain(PREPROD_PAUSE_KEY);
    expect(recorder.statements.flat(Infinity)).not.toContain(
      PREPROD_GENERATION_KEY,
    );
    expect(recorder.statements).toHaveLength(
      mainnetStatements[label][onSplitLayout ? 1 : 0],
    );
  }
}

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
      await tx.subscription.deleteMany({ where: { referenceId: userId } });
      await tx.user.delete({ where: { id: userId } });
    }),
  );
  const { id: workspaceId } = await createPersonalWorkspace(userId);
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
      network: "mainnet",
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

function allowLegacyTaskHistoryTrigger() {
  if (!onSplitLayout) return;
  const { DATABASE_SCHEMA_SHARED: shared, DATABASE_SCHEMA_MAINNET: mainnet } =
    testSchemaNames();
  const serializable = transactions.serializableTransaction;
  const spy = vi
    .spyOn(transactions, "serializableTransaction")
    .mockImplementation((run, message, timing) =>
      serializable(
        async (tx) => {
          // The legacy History trigger still uses an unqualified name.
          await tx.$executeRawUnsafe(
            `SET LOCAL search_path TO "${shared}", "${mainnet}"`,
          );
          return run(tx);
        },
        message,
        timing,
      ),
    );
  onTestFinished(() => spy.mockRestore());
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

async function seedHireDecision(status: "PENDING" | "PROCESSING" = "PENDING") {
  const fixture = await seedBot();
  const { userId, workspaceId, bot } = fixture;
  const turn = await seedLiveTurn(fixture, ["hire_agent", "provide_job_input"]);
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
      status,
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
  const createJob = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`
      INSERT INTO ${networkTable("Job")} (
        "id", "updatedAt", "agentId", "workspaceId", "ownerId", "agentJobId", "jobType")
      VALUES (${jobId}, NOW(), ${agent.id}, ${workspaceId}::uuid, ${userId},
        'seller-job', 'FREE'::${netType("mainnet", "JobType")})
    `;
  };
  return {
    userId,
    workspaceId,
    bot,
    turn,
    decision,
    jobId,
    networkDb,
    networkTable,
    reservation,
    createJob,
  };
}

const execFileAsync = promisify(execFile);

async function setupNetworkGate(turnId: string, workspaceId: string) {
  const schema = `hire_gate_${randomUUID().replaceAll("-", "")}`;
  const env = {
    ...process.env,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL,
    DATABASE_SCHEMA_SHARED: schema,
    DATABASE_SCHEMA_MAINNET: "hire_gate_mainnet",
    DATABASE_SCHEMA_PREPROD: "hire_gate_preprod",
    NETWORK_PREPROD_ENABLED: "false",
  };
  const { sharedTable: view } = createSqlTables(sqlTableLayoutFromEnv(env));
  // The CLI connects separately. Filter its reads to this hire's committed
  // rows so the gate can also run in workers that have other test fixtures.
  await withFixtureSchemas(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`
      CREATE VIEW ${view("soko_bot_turn").sql} AS
      SELECT "network" FROM ${sharedTable("soko_bot_turn").sql}
      WHERE "id" = ${escapeLiteral(turnId)}
    `);
    await tx.$executeRawUnsafe(`
      CREATE VIEW ${view("soko_bot_delegation").sql} AS
      SELECT "network", "jobId" FROM ${sharedTable("soko_bot_delegation").sql}
      WHERE "turnId" = ${escapeLiteral(turnId)}
    `);
    await tx.$executeRawUnsafe(`
      CREATE VIEW ${view("soko_bot_schedule").sql} AS
      SELECT "network", "jobId" FROM ${sharedTable("soko_bot_schedule").sql}
      WHERE "workspaceId" = ${escapeLiteral(workspaceId)}
    `);
  });
  onTestFinished(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  });

  return () =>
    execFileAsync(
      process.execPath,
      ["--import", "tsx", "scripts/count-soko-bot-network-catch-up.ts"],
      {
        cwd: fileURLToPath(
          new URL("../../../../packages/database/", import.meta.url),
        ),
        env,
      },
    );
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
      if (network === "preprod") {
        // A Preprod turn starts only while Preprod is open (ticket 24).
        await prisma.syncMetadata.upsert({
          where: { key: PREPROD_PAUSE_KEY },
          create: {
            key: PREPROD_PAUSE_KEY,
            cursorId: "open",
            lastSyncedAt: new Date(),
          },
          update: { cursorId: "open" },
        });
        onTestFinished(async () => {
          await prisma.syncMetadata.deleteMany({
            where: { key: PREPROD_PAUSE_KEY },
          });
        });
      }
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

  it("tags hire reservation, Job attachment and provision of Job input", async () => {
    const {
      userId,
      workspaceId,
      bot,
      turn,
      decision,
      jobId,
      networkDb,
      networkTable,
      reservation,
      createJob,
    } = await seedHireDecision();
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
        await createJob(tx);
        await input.afterLocalJobCreate?.(job, tx);
      });
      return job;
    });

    const debits = () =>
      networkDb.transaction.count({
        where: { userId, amount: { lt: 0n } },
      });
    const initialDebits = await debits();
    await expect(
      countMainnetStatements("hire approval", () =>
        sokoBotRuntimeService.resolveDecision(userId, decision.id, true),
      ),
    ).resolves.toMatchObject({ status: "ACCEPTED", resultingEntityId: jobId });
    expect(await reservation()).toMatchObject({
      network: "mainnet",
      jobId,
      outcome: "accepted",
    });

    await expect(
      prisma.sokoBotToolCall.findUnique({
        where: {
          turnId_toolCallId: {
            turnId: turn.id,
            toolCallId: `decision:${decision.id}`,
          },
        },
      }),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      disposition: "APPLIED",
      verification: "PROVIDER_ACK",
      targetId: jobId,
    });

    if (onSplitLayout) {
      // These Job models in the decision service still use the legacy client.
      const findInput = vi
        .spyOn(prisma.jobInput, "findUnique")
        .mockImplementation((args) => networkDb.jobInput.findUnique(args));
      const findEvent = vi
        .spyOn(prisma.jobEvent, "findFirst")
        .mockImplementation((args) => networkDb.jobEvent.findFirst(args));
      onTestFinished(() => {
        findInput.mockRestore();
        findEvent.mockRestore();
      });
    }
    const eventId = randomUUID();
    await withFixtureSchemas(
      (tx) => tx.$executeRaw`
      INSERT INTO ${networkTable("jobEvent")} ("id", "updatedAt", "jobId", "status", "inputSchema")
      VALUES (${eventId}, NOW(), ${jobId}, 'AWAITING_INPUT'::${netType("mainnet", "AgentJobStatus")},
        '{"input_data":[]}')
    `,
    );
    const provide = await prisma.sokoBotPendingDecision.create({
      data: {
        turnId: turn.id,
        sokoBotId: bot.id,
        workspaceId,
        requestedByUserId: userId,
        toolName: "provide_job_input",
        reason: "Fixture",
        proposal: { jobId, eventId, inputData: {} },
        expiresAt: decision.expiresAt,
      },
    });
    await expect(
      countMainnetStatements("input refusal", () =>
        sokoBotRuntimeService.resolveDecision(userId, provide.id, true),
      ),
    ).rejects.toThrow("Seller fixture refused input");
    await expect(
      prisma.sokoBotDelegation.findFirstOrThrow({
        where: { turnId: turn.id, toolCallId: `decision:${provide.id}` },
      }),
    ).resolves.toMatchObject({
      network: "mainnet",
      jobId,
      outcome: "failed",
    });
    await expect(debits()).resolves.toBe(initialDebits);
  });

  describe.each(["attach", "recover"] as const)("hire %s", (mode) => {
    it.each([
      [null, "mainnet"],
      ["mainnet", "mainnet"],
      ["preprod", "preprod"],
    ] as const)(
      "accepts a reservation with Network %s as %s",
      async (network, expected) => {
        const recovering = mode === "recover";
        const {
          userId,
          workspaceId,
          turn,
          decision,
          jobId,
          reservation,
          createJob,
        } = await seedHireDecision(recovering ? "PROCESSING" : "PENDING");
        if (recovering) await withFixtureSchemas(createJob);
        await prisma.sokoBotDelegation.create({
          data: {
            turnId: turn.id,
            toolCallId: `decision:${decision.id}`,
            kind: "JOB",
            action: "hire_agent",
            outcome: recovering ? "processing" : "failed",
            jobId: recovering ? jobId : null,
            network,
          },
        });

        if (!recovering) {
          vi.mocked(createAgentJobForUser).mockImplementationOnce(
            async (input) => {
              await input.beforeSellerStart?.();
              const job = { id: jobId } as JobWithListSummaryRelations;
              await withFixtureSchemas(async (tx) => {
                await createJob(tx);
                await input.afterLocalJobCreate?.(job, tx);
              });
              return job;
            },
          );
        }

        const count =
          network === null
            ? await setupNetworkGate(turn.id, workspaceId)
            : undefined;
        if (count && recovering) {
          await expect(count()).rejects.toMatchObject({
            code: 1,
            stdout:
              "soko_bot_turn: 0\nsoko_bot_delegation: 1\nsoko_bot_schedule: 0\n",
          });
        }
        const label = `${mode} ${network}` as const;
        if (label === "recover preprod") {
          await expect(
            sokoBotRuntimeService.resolveDecision(userId, decision.id, true),
          ).rejects.toMatchObject({ kind: "soko_bot_network_stale" });
          await expect(reservation()).resolves.toMatchObject({
            jobId,
            network,
            outcome: "processing",
          });
          return;
        }
        await expect(
          countMainnetStatements(label, () =>
            sokoBotRuntimeService.resolveDecision(userId, decision.id, true),
          ),
        ).resolves.toMatchObject({
          status: "ACCEPTED",
          resultingEntityId: jobId,
        });
        expect(await reservation()).toMatchObject({
          jobId,
          network: expected,
          outcome: "accepted",
        });
        if (count) {
          await expect(count()).resolves.toMatchObject({
            stdout:
              "soko_bot_turn: 0\nsoko_bot_delegation: 0\nsoko_bot_schedule: 0\n",
          });
        }
      },
      20_000,
    );
  });

  it("tags the Task delegation and the spawned Task adopted in bulk", async () => {
    const fixture = await seedBot();
    const { bot, userId, workspaceId } = fixture;
    const turn = await seedLiveTurn(fixture, ["create_task"]);
    allowLegacyTaskHistoryTrigger();
    const creation = await countMainnetStatements("create_task", async () => {
      const call = tool(turn.id, "create_task", {
        name: "Parent Task",
        status: "READY",
      });
      await expect(call.result).resolves.toMatchObject({ name: "Parent Task" });
      return call;
    });
    const parent = await prisma.sokoBotDelegation.findFirstOrThrow({
      where: { turnId: turn.id, toolCallId: creation.toolCallId },
    });
    expect(parent).toMatchObject({ network: "mainnet", kind: "TASK" });
    await prisma.sokoBotDelegation.update({
      where: { id: parent.id },
      data: { network: null },
    });
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

    await countMainnetStatements("adopt", () => adoptCoworkerSpawnedTasks());
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

  it.each([
    ["archive_task", {}],
    ["update_task", { name: "Updated Task" }],
    ["assign_task", { assignToOwner: true, ready: false }],
    ["update_assigned_task", { status: "RUNNING", comment: "Starting" }],
    ["reply_to_task", { comment: "Noted" }],
  ] as const)("tags the %s delegation", async (capability, input) => {
    const fixture = await seedBot();
    const turn = await seedLiveTurn(fixture, [capability]);
    const task = await withFixtureSchemas((tx) =>
      tx.task.create({
        data: {
          name: "Fixture Task",
          workspaceId: fixture.workspaceId,
          ownerId: fixture.userId,
          ...(capability === "archive_task" ? { archivedAt: new Date() } : {}),
          ...(capability === "update_assigned_task"
            ? { assigneeSokoBotId: fixture.bot.id, status: "READY" }
            : {}),
        },
      }),
    );
    allowLegacyTaskHistoryTrigger();
    const call = await countMainnetStatements(capability, async () => {
      const call = tool(turn.id, capability, {
        taskId: task.id,
        ...input,
        ...(capability === "archive_task"
          ? { expectedUpdatedAt: task.updatedAt.toISOString() }
          : {}),
      });
      await call.result;
      return call;
    });
    await expect(
      prisma.sokoBotDelegation.findFirstOrThrow({
        where: { turnId: turn.id, toolCallId: call.toolCallId },
      }),
    ).resolves.toMatchObject({
      network: "mainnet",
      taskId: task.id,
      action: capability,
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
    const app = new OpenAPIHono<EnvVariables>();
    app.use("*", async (c, next) => {
      c.set("networkScope", {
        ...testNetworkScope(),
        network: "preprod" as const,
      });
      c.set("authContext", {
        actor: "user",
        role: "user",
        userId,
        organizationId: null,
      });
      c.set("workspaceContext", { userId, workspaceId, organizationId: null });
      await next();
    });
    mountConsoleSchedule(app);
    const response = await app.request("/me/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Console schedule", ...scheduleInput }),
    });
    expect(response.status).toBe(201);
    await expect(
      prisma.sokoBotSchedule.findFirstOrThrow({
        where: { sokoBotId: bot.id, name: "Console schedule" },
      }),
    ).resolves.toMatchObject({ network: "mainnet" });
    await ensureSystemSchedules(bot);
    const builtIns = await prisma.sokoBotSchedule.findMany({
      where: { sokoBotId: bot.id, systemKey: { not: null } },
    });
    expect(builtIns.length).toBeGreaterThan(0);
    expect(builtIns.every((schedule) => schedule.network === "mainnet")).toBe(
      true,
    );

    const { toolCallId, created } = await countMainnetStatements(
      "create_schedule",
      async () => {
        const call = tool(turn.id, "create_schedule", {
          ...scheduleInput,
          name: "Watched schedule",
          taskId: task.id,
        });
        return { toolCallId: call.toolCallId, created: await call.result };
      },
    );
    const watched = await prisma.sokoBotSchedule.findFirstOrThrow({
      where: { sokoBotId: bot.id, taskId: task.id },
    });
    expect(watched.network).toBe("mainnet");

    async function expectLegacyShape(result: unknown, toolCallId: string) {
      // The same Prisma projection the tools returned before the column.
      const legacyRow = await prisma.sokoBotSchedule.findUniqueOrThrow({
        where: { id: watched.id },
        omit: { network: true, preprodGeneration: true },
      });
      expect(result).toStrictEqual(legacyRow);
      const receipt = await prisma.sokoBotToolCall.findUniqueOrThrow({
        where: { turnId_toolCallId: { turnId: turn.id, toolCallId } },
      });
      expect(receipt.result).toStrictEqual(persistedToolResult(legacyRow));
    }

    await expectLegacyShape(created, toolCallId);
    const edit = tool(turn.id, "update_schedule", {
      scheduleId: watched.id,
      name: "Renamed",
    });
    await expectLegacyShape(await edit.result, edit.toolCallId);
  });
});
