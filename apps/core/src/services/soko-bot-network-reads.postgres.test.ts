import "@hono/zod-openapi";

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { Prisma } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";
import { sharedTable } from "@sokosumi/database/sql-tables";
import {
  CMO_SOKO_BOT_VERSION_ID,
  SOKO_BOT_TURN_TOKEN_HEADER,
  type SokoBotRuntime,
} from "@sokosumi/soko-bot";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RESULT_SNAPSHOTS_KEY } from "@/helpers/chat-result-metadata";
import {
  PREPROD_GENERATION_KEY,
  PREPROD_PAUSE_KEY,
} from "@/helpers/preprod-control";
import { sokoBotTurnReader } from "@/helpers/task-visibility";
import { createNetworkScope, type NetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { type Network } from "@/lib/network";
import { buildActionResponse } from "@/lib/soko-bot/action-response";
import { loadClassificationContext } from "@/lib/soko-bot/classification-context";
import {
  presetClassificationResult,
  type TurnClassifier,
} from "@/lib/soko-bot/classifier";
import {
  type BuildContextPacketInput,
  ContextPacketBuilder,
} from "@/lib/soko-bot/context-packet";
import { SandboxSokoBotRuntime } from "@/lib/soko-bot/sandbox/sandbox-runtime";
import { issueTurnToken } from "@/lib/soko-bot/sandbox/turn-token";
import { announceTurn, RuntimeEventLog } from "@/lib/soko-bot/turn-loop";
import { sokoBotWriteScopeRefusal } from "@/lib/soko-bot/write-scope";
import runtimeRoutes from "@/routes/v1/soko-bot-runtime";
import { inFlow, observing } from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";
import {
  readSplitBotJob,
  resolveChatResultReference,
} from "./chat-result-preview.service";
import { SokoBotControlPlane } from "./soko-bot-control-plane.service";
import baseline from "./soko-bot-network-reads.base.json";
import {
  requireMutationAuthority,
  requireWriteScope,
} from "./soko-bot-runtime/authorization";
import { prepareDecision } from "./soko-bot-runtime/decision-claim";
import type { RuntimeOperations } from "./soko-bot-runtime/operations";
import {
  requireScheduledRunMayEnd,
  resolveUiScheduleAuthority,
} from "./soko-bot-runtime/schedule-scope";
import { sokoBotRuntimeService } from "./soko-bot-runtime.service";
import { completeSandboxTurn } from "./soko-bot-sandbox-turn.service";
import { prepareTurnActionResultPreviews } from "./turn-action-result-previews.service";

const privateDatabase = await vi.hoisted(async () => {
  const source =
    process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
  if (
    process.env.RUN_DATABASE_INTEGRATION_TESTS !== "true" ||
    !source?.startsWith("postgres")
  )
    return undefined;
  const { copyPostgresTestDatabase } = await import(
    "@/test/postgres-database-copy"
  );
  const copy = await copyPostgresTestDatabase(source, "job_reads_test");
  vi.stubEnv("DATABASE_URL", copy.url);
  vi.stubEnv("DATABASE_URL_UNPOOLED", copy.url);
  vi.stubEnv(
    "NETWORK_PREPROD_ENABLED",
    process.env.DATABASE_SCHEMA_PREPROD === "preprod" ? "true" : "false",
  );
  return copy;
});

const fixture = vi.hoisted(() => ({ pools: [] as Pool[] }));
vi.mock("@vercel/functions", async (load) => {
  const actual = await load<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      fixture.pools.push(pool);
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
    waitUntil: vi.fn(),
  };
});
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { get: async () => ({ stop: async () => undefined }) },
  Drive: {},
}));
vi.mock("@sokosumi/masumi", async (load) => ({
  ...(await load<typeof import("@sokosumi/masumi")>()),
  createAgentClient: () => ({
    fetchAgentInputSchema: async (agent: { name: string }) => ({
      isErr: () => false,
      value: {
        input_data: [{ id: "brief", type: "string", name: agent.name }],
      },
    }),
    provideJobInput: async () => ({
      isErr: () => false,
      value: { input_hash: "test-input-hash", signature: "test-signature" },
    }),
  }),
}));

const OWNER = "fixture:soko-bot-network-reads:owner";
const OTHER = "fixture:soko-bot-network-reads:other";
const ORG = "fixture:soko-bot-network-reads";
const AGENT = "fixture-agent-on-both-networks";
const PRICE_UNIT = "a".repeat(56);
const JOB = "fixture-job-on-both-networks";
const ACTION_JOB = "fixture-job-for-receipts";
const PREPROD_ACTION_AGENT = "fixture-preprod-action-agent";
const INPUT_JOB = "fixture-job-awaiting-approved-input";
const HIDDEN = "fixture-job-on-hidden-parent";
const SCOPE_JOB = "fixture-job-visible-only-to-preprod-project-bot";
const END = new Date("2099-01-01T00:00:00.000Z");
const CLOCK = new Date("2026-11-28T12:00:00.000Z");
const SNAPSHOT_ID = "01960001-0001-7001-8001-000000000901";
const DETERMINISTIC_ID_PREFIX = "01960001-0001-7001-8001-00000000";
const id = (number: number) =>
  `${DETERMINISTIC_ID_PREFIX}${String(number).padStart(4, "0")}`;
const previewRef = { kind: "job", id: JOB } as const;
const classification = presetClassificationResult("Check these Jobs", {
  route: "HIRE_AGENT",
  reason: "Network read fixture",
}).classification;

const mainnet = createNetworkScope("mainnet");
const cases = [
  { name: "personal", botId: id(11), source: "CHAT", route: "DIRECT_RESPONSE" },
  { name: "shared", botId: id(12), source: "CHAT", route: "DIRECT_RESPONSE" },
  { name: "cuso", botId: id(13), source: "CHAT", route: "DIRECT_RESPONSE" },
  { name: "hire-offer", botId: id(11), source: "CHAT", route: "HIRE_AGENT" },
  { name: "event", botId: id(11), source: "EVENT", route: "DIRECT_RESPONSE" },
  {
    name: "scheduled",
    botId: id(11),
    source: "SCHEDULE",
    route: "DIRECT_RESPONSE",
  },
] as const;

let workspaceId: string;
let outsideWorkspaceId: string;
const projectId = id(20);
const emptyProjectId = id(21);
const hiddenProjectId = id(22);
const publicTaskId = id(31);
const privateTaskId = id(32);

const reader = sokoBotTurnReader(OWNER, "OWNER", null);
const actor = () => ({ userId: OWNER, workspaceId, kind: "soko_bot" as const });

function json(value: unknown) {
  return JSON.stringify(value, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

async function seedShared() {
  await prisma.user.createMany({
    data: [OWNER, OTHER].map((id, index) => ({
      id,
      name: index === 0 ? "Mainnet reader" : "Other member",
      email: `turns-network-${index}@example.test`,
      emailVerified: true,
      createdAt: CLOCK,
      updatedAt: CLOCK,
    })),
  });
  await prisma.organization.create({
    data: { id: ORG, slug: "jobs-on-turn-network", name: "Network test" },
  });
  await prisma.member.createMany({
    data: [OWNER, OTHER].map((userId) => ({
      userId,
      organizationId: ORG,
      role: userId === OWNER ? "owner" : "member",
    })),
  });
  await prisma.$executeRaw`
    INSERT INTO ${sharedTable("workspace")} (id, "organizationId", "updatedAt")
    VALUES (${id(2)}::uuid, ${ORG}, ${CLOCK})
  `;
  workspaceId = (
    await prisma.$transaction((tx) =>
      workspaceRepository.upsertOrganizationWorkspace({
        organizationId: ORG,
        tx,
      }),
    )
  ).id;
  outsideWorkspaceId = id(1);
  await prisma.$executeRaw`
    INSERT INTO ${sharedTable("workspace")} (id, "userId", "updatedAt")
    VALUES (${outsideWorkspaceId}::uuid, ${OTHER}, ${CLOCK})
  `;
  await prisma.project.createMany({
    data: [
      { id: projectId, name: "Visible Project", identifier: "VIS" },
      { id: emptyProjectId, name: "Empty Project", identifier: "EMP" },
      { id: hiddenProjectId, name: "Hidden Job Project", identifier: "HID" },
    ].map((project) => ({ workspaceId, updatedAt: CLOCK, ...project })),
  });
  await prisma.task.createMany({
    data: [
      {
        id: publicTaskId,
        ownerId: OWNER,
        name: "Visible Task",
        visibility: "PUBLIC" as const,
      },
      {
        id: privateTaskId,
        ownerId: OTHER,
        name: "Private Task",
        visibility: "PRIVATE" as const,
      },
    ].map((task) => ({
      workspaceId,
      projectId,
      organizationId: ORG,
      updatedAt: CLOCK,
      ...task,
    })),
  });
  for (const [index, botId] of [id(11), id(12), id(13)].entries()) {
    const room = await prisma.chatRoom.create({
      data: {
        id: id(41 + index),
        kind: "channel",
        slug: `turn-read-fixture-${index}`,
        name: `Turn room ${index}`,
        organizationId: ORG,
        createdByUserId: OWNER,
        userMembers: { create: { userId: OWNER } },
      },
    });
    await prisma.sokoBot.create({
      data: {
        id: botId,
        workspaceId,
        name: index === 2 ? "Cuso" : `Turn reader ${index}`,
        userId: index === 0 ? OWNER : null,
        projectId: index === 0 ? null : projectId,
        sharedRoomId: index === 0 ? null : room.id,
        versionId: index === 2 ? CMO_SOKO_BOT_VERSION_ID : "v21",
        createdByUserId: OWNER,
      },
    });
    await prisma.chatRoomSokoBotMember.create({
      data: { roomId: room.id, sokoBotId: botId },
    });
  }
  const credits = 100_000_000_000_000n;
  await mainnet.networkDb.transaction.create({
    data: {
      id: "fixture-mainnet-balance",
      amount: credits,
      organizationId: ORG,
      sourceCreditBucket: {
        create: {
          id: "fixture-mainnet-bucket",
          amount: credits,
          organizationId: ORG,
          expiresAt: END,
        },
      },
    },
  });
  if (onSplitLayout) {
    await prisma.syncMetadata.createMany({
      data: [
        { key: PREPROD_PAUSE_KEY, cursorId: "open", lastSyncedAt: CLOCK },
        { key: PREPROD_GENERATION_KEY, cursorId: "7", lastSyncedAt: CLOCK },
      ],
    });
  }
}

async function seedNetwork(scope: NetworkScope, label: string) {
  const db = scope.networkDb;
  await db.agent.create({
    data: {
      id: AGENT,
      name: `${label} Agent`,
      blockchainIdentifier: AGENT,
      apiBaseUrl: `https://${scope.network}.example.invalid`,
      isShown: true,
      lastUptimeCheck: CLOCK,
      uptimeCount: 1,
      uptimeCheckCount: 1,
      pricing: {
        create: {
          id: "fixture-agent-pricing",
          pricingType: "FIXED",
          fixedPricing: {
            create: {
              id: "fixture-fixed-price",
              amounts: {
                create: {
                  amount: scope.network === "mainnet" ? 3n : 6n,
                  id: "fixture-amount",
                  unit: PRICE_UNIT,
                },
              },
            },
          },
        },
      },
    },
  });
  await db.creditCost.create({
    data: { unit: PRICE_UNIT, centsPerUnit: 5_000_000_000n },
  });
  const debit = await db.transaction.create({
    data: {
      id: "fixture-job-charge",
      organizationId: ORG,
      amount: scope.network === "mainnet" ? -20_000_000_000n : -80_000_000_000n,
    },
  });
  await db.job.createMany({
    data: [
      {
        id: JOB,
        name: `${label} Job`,
        projectId,
        taskId: null,
        transactionId: debit.id,
        jobType: "PAID" as const,
        blockchainIdentifier: "fixture-blockchain",
        identifierFromPurchaser: "fixture-buyer",
        sellerVkey: "fixture-seller",
        payByTime: END,
        submitResultTime: END,
        unlockTime: END,
        externalDisputeUnlockTime: END,
      },
      {
        id: HIDDEN,
        name: "Hidden Job",
        projectId: hiddenProjectId,
        taskId: privateTaskId,
      },
      {
        id: INPUT_JOB,
        name: "Approved input Job",
        projectId,
        taskId: publicTaskId,
      },
      {
        id: SCOPE_JOB,
        name: "Conditional Project Job",
        projectId,
        taskId: scope.network === "mainnet" ? privateTaskId : publicTaskId,
      },
      {
        id: "outside-workspace-job",
        name: "Outside workspace",
        workspaceId: outsideWorkspaceId,
        projectId: null,
        taskId: null,
      },
      ...Array.from({ length: 26 }, (_, index) => ({
        id: `older-job-${index}`,
        name: `Older Job ${index}`,
        projectId,
        taskId: publicTaskId,
        updatedAt: new Date(CLOCK.getTime() - 1000 * (index + 1)),
      })),
    ].map((job) => ({
      ownerId: OWNER,
      workspaceId,
      organizationId: ORG,
      agentId: AGENT,
      agentJobId: job.id,
      jobType: "FREE",
      createdAt: CLOCK,
      updatedAt: CLOCK,
      ...job,
    })),
  });
  if (scope.network === "preprod") {
    await db.agent.create({
      data: {
        id: PREPROD_ACTION_AGENT,
        name: "Preprod Receipt Agent",
        blockchainIdentifier: PREPROD_ACTION_AGENT,
        isShown: false,
        lastUptimeCheck: CLOCK,
        uptimeCount: 1,
        uptimeCheckCount: 1,
        pricing: { create: { pricingType: "FREE" } },
      },
    });
  }
  await db.job.create({
    data: {
      id: ACTION_JOB,
      workspaceId,
      organizationId: ORG,
      ownerId: OTHER,
      jobType: "FREE",
      agentId: scope.network === "preprod" ? PREPROD_ACTION_AGENT : AGENT,
      agentJobId: ACTION_JOB,
    },
  });
  await db.jobPurchase.create({
    data: {
      id: "fixture-purchase",
      jobId: JOB,
      externalId: "fixture-purchase",
      onChainStatus: "FUNDS_LOCKED",
    },
  });
  await db.jobEvent.createMany({
    data: [
      {
        id: "fixture-job-recent-event",
        jobId: JOB,
        status:
          scope.network === "mainnet"
            ? ("COMPLETED" as const)
            : ("AWAITING_INPUT" as const),
        result: `${label} Job output`,
        inputSchema: '[{"id":"answer","type":"string"}]',
      },
      {
        id: "fixture-approved-input-event",
        jobId: INPUT_JOB,
        status: "AWAITING_INPUT" as const,
        inputSchema: '[{"id":"answer","type":"string"}]',
      },
    ].map((event) => ({ createdAt: CLOCK, updatedAt: CLOCK, ...event })),
  });
}

async function runningTurn(turnId: string, network: Network, botId = id(11)) {
  return prisma.sokoBotTurn.create({
    data: {
      id: turnId,
      network,
      ...(network === "preprod" ? { preprodGeneration: 7 } : {}),
      workspaceId,
      sokoBotId: botId,
      requestedByUserId: OWNER,
      source: "CHAT",
      clientTurnId: `record-${turnId}`,
      userMessage: "Review the visible jobs",
      versionId: "v21",
      eveSessionId: `session-${turnId}`,
      status: "RUNNING",
      deadlineAt: END,
      leaseExpiresAt: END,
      contextSnapshot: {
        create: {
          generatedAt: CLOCK,
          schemaVersion: 1,
          hash: "test-snapshot",
          packet: {
            memory: { version: 0 },
            trigger: { askedBy: { kind: "OWNER" } },
          },
          byteSize: 0,
          tokenEstimate: 0,
          counts: {},
          omissions: {},
        },
      },
      capabilityNames: [
        "get_job_status",
        "get_agent_input_schema",
        "preview_result",
        "post_chat",
        "find_agents",
        "create_task",
        "provide_job_input",
      ],
    },
  });
}

function waitingRuntime(name: string): SokoBotRuntime {
  return {
    createSession: async () => ({
      sessionId: `session-${name}`,
      runtimeVersion: "test",
      acceptedAt: CLOCK.toISOString(),
    }),
    async *streamEvents() {},
    cancelTurn: async () => undefined,
    resetSession: async () => undefined,
    inspectSession: async () => ({
      healthy: true,
      runtimeVersion: "test",
      sessionStatus: "waiting",
    }),
  };
}

function packetInput(networkScope: NetworkScope): BuildContextPacketInput {
  return {
    userId: OWNER,
    sokoBotId: id(11),
    workspaceId,
    sharedScope: null,
    networkScope,
    classification,
    source: "CHAT",
  };
}

if (false) {
  // @ts-expect-error Classification must receive a scope from its entry point.
  void loadClassificationContext(undefined, reader, workspaceId, "");
  void new ContextPacketBuilder().build({
    ...packetInput(mainnet),
    // @ts-expect-error Packet readers must receive a scope from their entry point.
    networkScope: undefined,
  });
}

async function tool(
  turnId: string,
  capability: string,
  input: unknown,
  call = capability,
) {
  const response = await runtimeRoutes.request(
    `/turns/${turnId}/tools/${capability}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SOKO_BOT_TURN_TOKEN_HEADER]: issueTurnToken({
          turnId,
          sessionId: `session-${turnId}`,
          expiresAt: END.getTime(),
        }),
      },
      body: JSON.stringify({ input, toolCallId: call }),
    },
  );
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return JSON.parse(text).result;
}

function expectVisibleJobs(
  packet: Awaited<ReturnType<ContextPacketBuilder["build"]>>["packet"],
  label: string,
) {
  expect(packet.jobs).toHaveLength(24);
  expect(packet.jobs).toContainEqual(
    expect.objectContaining({ id: JOB, name: `${label} Job` }),
  );
  expect(
    packet.jobs.some(
      ({ id }) => id === HIDDEN || id === "outside-workspace-job",
    ),
  ).toBe(false);
  expect(packet.counts.jobs).toBe(label === "Mainnet" ? 28 : 29);
  expect(packet.projects).toContainEqual(
    expect.objectContaining({
      id: emptyProjectId,
      status: expect.objectContaining({ totalJobs: 0 }),
    }),
  );
  expect(packet.projects).toContainEqual(
    expect.objectContaining({
      id: hiddenProjectId,
      status: expect.objectContaining({ totalJobs: 0 }),
    }),
  );
  expect(packet.projects).toContainEqual(
    expect.objectContaining({
      id: projectId,
      status: expect.objectContaining({
        totalJobs: label === "Mainnet" ? 28 : 29,
      }),
    }),
  );
}

describe.runIf(Boolean(privateDatabase))(
  "Soko Bot Job and Agent reads on the turn Network",
  () => {
    beforeAll(async () => {
      await seedShared();
      await seedNetwork(mainnet, "Mainnet");
      vi.setSystemTime(CLOCK);
    }, 90_000);

    afterAll(async () => {
      try {
        vi.useRealTimers();
        await Promise.all(fixture.pools.map((pool) => pool.end()));
      } finally {
        vi.unstubAllEnvs();
        await privateDatabase?.drop();
      }
    });

    it("starts six Mainnet turn kinds and records their byte outputs and statements", async () => {
      const observations: Record<string, unknown> = {};
      for (const scenario of cases) {
        const { name, botId, source, route } = scenario;
        let classifierInput = "";
        const classifier: TurnClassifier = {
          classify: async (message, context) => {
            classifierInput = json(context);
            return presetClassificationResult(message, { route, reason: name });
          },
        };
        const context = new ContextPacketBuilder();
        const buildPacket = context.build.bind(context);
        let packet = "";
        context.build = async (input) => {
          const result = await inFlow("packet", () => buildPacket(input));
          packet = json(result.packet);
          if (botId === id(11)) expectVisibleJobs(result.packet, "Mainnet");
          return result;
        };
        const plane = new SokoBotControlPlane(
          waitingRuntime(name),
          context,
          classifier,
        );
        const start = await observing(() =>
          plane.startTurn({
            network: "mainnet",
            userId: OWNER,
            sokoBotId: botId,
            workspaceId,
            clientTurnId: `turn-network-${name}`,
            message: `Check Jobs for ${name}`,
            source,
          }),
        );
        if ("threw" in start.outcome) throw new Error(json(start.outcome));
        expect(classifierInput).toContain("jobIds");
        expect(packet).toContain("generatedAt");

        const started = start.outcome;
        // Record an acknowledged hire so the response has to read the Job.
        await prisma.sokoBotToolCall.create({
          data: {
            id: id(200 + cases.indexOf(scenario)),
            turnId: started.turnId,
            toolCallId: "verified",
            capability: "hire_agent",
            inputHash: "fixture-action-hash",
            input: { agentId: AGENT },
            targetId: JOB,
            status: "COMPLETED",
            verification: "LOCAL_TRANSACTION",
            disposition: "APPLIED",
            createdAt: CLOCK,
            committedAt: CLOCK,
          },
        });
        const action = await observing(() =>
          buildActionResponse(
            mainnet,
            prisma,
            started.turnId,
            "The results are ready.",
            true,
          ),
        );
        if ("threw" in action.outcome) throw new Error(json(action.outcome));
        expect(action.outcome).toHaveProperty("answerText");
        const outputs = {
          packet,
          classification: classifierInput,
          actionResponse: json(action.outcome),
        };
        if (!onSplitLayout) {
          expect(
            Object.fromEntries(
              Object.entries(outputs).map(([field, value]) => [
                field,
                createHash("sha256").update(value).digest("hex"),
              ]),
            ),
            `${name} bytes from origin/main 3da719187`,
          ).toEqual(baseline[name]);
        }
        observations[name] = {
          ...outputs,
          start: start.log,
          action: action.log,
        };
        // Keep each fresh case's previous-turn and pending-intent context isolated.
        await prisma.sokoBotTurn.delete({ where: { id: started.turnId } });
      }
      const path = process.env.SOKO_BOT_NETWORK_READ_RECORDING;
      if (path) writeFileSync(path, `${json(observations)}\n`);
    }, 90_000);

    it("keeps the Mainnet preview and status tool on Mainnet", async () => {
      const turnId = id(30);
      await runningTurn(turnId, "mainnet");
      const status = await observing(() =>
        tool(turnId, "get_job_status", { jobId: JOB }),
      );
      if ("threw" in status.outcome) throw new Error(json(status.outcome));
      const jobStatus = status.outcome;
      expect(jobStatus.result).toMatchObject({
        name: "Mainnet Job",
        status: "completed",
        agent: { name: "Mainnet Agent" },
      });
      const preview = await observing(() =>
        resolveChatResultReference({
          networkScope: mainnet,
          reference: previewRef,
          actor: actor(),
          previewId: SNAPSHOT_ID,
          capturedAt: CLOCK,
        }),
      );
      if ("threw" in preview.outcome) throw new Error(json(preview.outcome));
      expect(preview.outcome.data).toMatchObject({
        title: "Mainnet Job",
        status: "completed",
      });
      const schema = await observing(() =>
        tool(turnId, "get_agent_input_schema", { agentId: AGENT }),
      );
      expect(schema.outcome).toMatchObject({
        result: { input_data: [{ name: "Mainnet Agent" }] },
      });
      const path = process.env.SOKO_BOT_NETWORK_READ_RECORDING;
      if (path)
        writeFileSync(
          `${path}.tools`,
          `${json({ status, preview, schema })}\n`,
        );
    }, 60_000);

    it.runIf(!onSplitLayout)(
      "records the Mainnet decision claim and approved Job input",
      async () => {
        const turnId = id(80);
        const proposal = {
          jobId: INPUT_JOB,
          eventId: "fixture-approved-input-event",
          inputData: { answer: "fixture answer" },
        };
        await runningTurn(turnId, "mainnet", id(12));
        async function pending(decisionId: string) {
          return prisma.sokoBotPendingDecision.create({
            data: {
              id: decisionId,
              turnId,
              workspaceId,
              sokoBotId: id(12),
              requestedByUserId: OWNER,
              toolName: "provide_job_input",
              proposal,
              reason: "Ask the Agent to continue",
              expiresAt: END,
            },
          });
        }
        const claimOnly = await pending(id(81));
        const claim = await observing(() =>
          prepareDecision({} as RuntimeOperations, OWNER, claimOnly.id, true),
        );
        expect(claim.outcome).toMatchObject({ done: false });
        const toApply = await pending(id(82));
        const approved = await observing(() =>
          sokoBotRuntimeService.resolveDecision(OWNER, toApply.id, true),
        );
        expect(approved.outcome).toMatchObject({ status: "ACCEPTED" });
        const path = process.env.SOKO_BOT_NETWORK_READ_RECORDING;
        if (path)
          writeFileSync(
            `${path}.approved`,
            `${json({ claim: claim.log, approved: approved.log })}\n`,
          );
      },
      60_000,
    );

    describe.runIf(onSplitLayout)("equal ids in Mainnet and Preprod", () => {
      let seededPreprod: Promise<void> | undefined;
      function seedPreprod() {
        return (seededPreprod ??= seedNetwork(
          createNetworkScope("preprod"),
          "Preprod",
        ));
      }

      it("scopes packet, classifier, write check and the running turn's HTTP tools", async () => {
        const mainnetStatus = (
          await tool(
            id(30),
            "get_job_status",
            { jobId: JOB },
            "without-preprod",
          )
        ).result;
        const resolveMainnetPreview = () =>
          resolveChatResultReference({
            networkScope: mainnet,
            reference: previewRef,
            actor: actor(),
            previewId: SNAPSHOT_ID,
            capturedAt: CLOCK,
          });
        const mainnetPreview = json(await resolveMainnetPreview());
        const context = new ContextPacketBuilder();
        const { packet: withoutPreprod } = await context.build(
          packetInput(mainnet),
        );
        const classifierBefore = await loadClassificationContext(
          mainnet,
          reader,
          workspaceId,
          "",
        );
        const preprod = createNetworkScope("preprod");
        await seedPreprod();

        expect(
          json(
            (
              await tool(
                id(30),
                "get_job_status",
                { jobId: JOB },
                "with-preprod",
              )
            ).result,
          ),
        ).toBe(json(mainnetStatus));
        expect(json(await resolveMainnetPreview())).toBe(mainnetPreview);
        const { packet: withPreprod } = await context.build(
          packetInput(mainnet),
        );
        expect(json(withPreprod)).toBe(json(withoutPreprod));
        expect(
          json(
            await loadClassificationContext(mainnet, reader, workspaceId, ""),
          ),
        ).toBe(json(classifierBefore));
        expectVisibleJobs(withPreprod, "Mainnet");

        const observed = await observing(() =>
          context.build(packetInput(preprod)),
        );
        if ("threw" in observed.outcome)
          throw new Error(json(observed.outcome));
        const packet = observed.outcome.packet;
        expectVisibleJobs(packet, "Preprod");
        expect(packet.workspace).toEqual(withPreprod.workspace);
        expect(packet.agents).toContainEqual(
          expect.objectContaining({
            id: AGENT,
            name: "Preprod Agent",
            price: expect.objectContaining({ credits: 3 }),
          }),
        );
        expect(withPreprod.agents).toContainEqual(
          expect.objectContaining({
            id: AGENT,
            name: "Mainnet Agent",
            price: expect.objectContaining({ credits: 1.5 }),
          }),
        );
        expect(packet.jobs).toContainEqual(
          expect.objectContaining({
            id: JOB,
            status: "AWAITING_INPUT",
            pendingInput: {
              schema: '[{"id":"answer","type":"string"}]',
              required: true,
            },
            spentCredits: 8,
          }),
        );
        const projectCount = observed.log.filter(
          ({ values }) =>
            values.includes(projectId) &&
            values.includes(emptyProjectId) &&
            values.includes(hiddenProjectId),
        );
        expect(projectCount).toHaveLength(1);
        const candidates = await loadClassificationContext(
          preprod,
          reader,
          workspaceId,
          "",
        );
        expect(candidates.candidates).toContainEqual({
          id: JOB,
          name: "Preprod Job",
          kind: "JOB",
        });
        expect(candidates.candidates).toContainEqual({
          id: AGENT,
          name: "Preprod Agent",
          kind: "AGENT",
        });
        expect(candidates.jobIds).not.toContain(HIDDEN);
        expect(candidates.jobIds).not.toContain("outside-workspace-job");

        const sharedScope = { sokoBotId: id(12), workspaceId, projectId };
        const write = await observing(() =>
          sokoBotWriteScopeRefusal(prisma, mainnet, sharedScope, {
            jobId: SCOPE_JOB,
          }),
        );
        expect(write.outcome).toBe("Job not found");
        await expect(
          sokoBotWriteScopeRefusal(prisma, preprod, sharedScope, {
            jobId: SCOPE_JOB,
          }),
        ).resolves.toBeNull();

        const turnId = id(33);
        await runningTurn(turnId, "preprod");
        await expect(
          tool(turnId, "get_job_status", { jobId: JOB }),
        ).resolves.toMatchObject({
          result: {
            name: "Preprod Job",
            status: "input_required",
            agent: { name: "Preprod Agent" },
          },
        });
        await expect(
          tool(turnId, "get_agent_input_schema", { agentId: AGENT }),
        ).resolves.toMatchObject({
          result: { input_data: [{ id: "brief", name: "Preprod Agent" }] },
        });
        const previewInput = { reference: previewRef };
        for (const call of ["preview", "preview"]) {
          await expect(
            tool(turnId, "preview_result", previewInput, call),
          ).resolves.toMatchObject({
            result: {
              data: { title: "Preprod Job", status: "input_required" },
            },
          });
        }

        await prisma.sokoBotToolCall.create({
          data: {
            turnId,
            toolCallId: "hire-receipt",
            capability: "hire_agent",
            targetId: ACTION_JOB,
            inputHash: "fixture-hire-receipt",
            input: { agentId: PREPROD_ACTION_AGENT },
            status: "COMPLETED",
            verification: "LOCAL_TRANSACTION",
            disposition: "APPLIED",
            committedAt: CLOCK,
          },
        });
        const action = await observing(() =>
          prisma.$transaction((tx) =>
            buildActionResponse(
              preprod,
              tx,
              turnId,
              "The results are ready.",
              true,
            ),
          ),
        );
        if ("threw" in action.outcome) throw new Error(json(action.outcome));
        expect(action.outcome.answerText).toContain(PREPROD_ACTION_AGENT);

        for (const [networkScope, eventId] of [
          [mainnet, "fixture-approved-input-event"],
          [preprod, "fixture-job-recent-event"],
        ] as const) {
          await networkScope.networkDb.jobInput.create({
            data: { id: "fixture-same-input-id", eventId, input: "{}" },
          });
        }
        await prisma.sokoBotToolCall.create({
          data: {
            turnId,
            toolCallId: "input-receipt",
            capability: "provide_job_input",
            targetId: "fixture-same-input-id",
            inputHash: "fixture-input-receipt",
            input: {},
            status: "COMPLETED",
            verification: "LOCAL_TRANSACTION",
            disposition: "APPLIED",
            committedAt: CLOCK,
          },
        });
        const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
          where: { id: turnId },
          include: { sokoBot: { select: { userId: true } } },
        });
        const fallback = await observing(() =>
          prisma.$transaction((tx) =>
            prepareTurnActionResultPreviews(turnId, turn, preprod, tx),
          ),
        );
        expect(fallback.outcome).toBeUndefined();
        const recordingPath = process.env.SOKO_BOT_NETWORK_READ_RECORDING;
        if (recordingPath) {
          writeFileSync(
            `${recordingPath}.readers`,
            `${json({ write: write.log, action: action.log, fallback: fallback.log })}\n`,
          );
        }
        const snapshots = await prisma.sokoBotToolCall.findMany({
          where: { turnId, capability: "preview_result" },
          select: { result: true },
        });
        expect(snapshots).toContainEqual({
          result: expect.objectContaining({
            reference: previewRef,
            data: expect.objectContaining({ title: "Mainnet Job" }),
          }),
        });
        expect(snapshots).not.toContainEqual({
          result: expect.objectContaining({
            reference: { kind: "job", id: INPUT_JOB },
          }),
        });

        const decision = await prisma.sokoBotPendingDecision.create({
          data: {
            id: id(71),
            turnId,
            workspaceId,
            sokoBotId: id(11),
            requestedByUserId: OWNER,
            toolName: "create_task",
            proposal: { name: "Create a test Task" },
            reason: "Test scope",
            expiresAt: END,
          },
        });
        const sharedTurn = await runningTurn(id(34), "mainnet", id(12));
        await prisma.sokoBotDelegation.create({
          data: {
            network: "mainnet",
            turnId: sharedTurn.id,
            toolCallId: "shared-hire",
            kind: "JOB",
            action: "hire_agent",
            jobId: ACTION_JOB,
          },
        });
        const sharedReader = sokoBotTurnReader(OWNER, "TEAMMATE", sharedScope);
        await expect(
          loadClassificationContext(mainnet, sharedReader, workspaceId, ""),
        ).resolves.toMatchObject({
          jobIds: expect.arrayContaining([ACTION_JOB]),
        });
        const preprodShared = await loadClassificationContext(
          preprod,
          sharedReader,
          workspaceId,
          "",
        );
        expect(preprodShared.jobIds).not.toContain(ACTION_JOB);

        const claimed = await prepareDecision(
          {} as RuntimeOperations,
          OWNER,
          decision.id,
          true,
          false,
        );
        expect(claimed.done).toBe(false);
        if (claimed.done)
          throw new Error("Decision did not retain its action context");
        expect(claimed.actionContext.scope.network).toBe("preprod");

        const scheduleId = id(91);
        const authority = resolveUiScheduleAuthority(OWNER, {
          mode: "when_target_settled",
          targetKind: "job",
          targetId: JOB,
        })({
          scheduleId,
          sokoBotId: id(11),
          workspaceId,
          existingAuthority: null,
          botProjectId: null,
          botVersionId: "v36",
          sharedBot: false,
        });
        await prisma.sokoBotSchedule.create({
          data: {
            id: scheduleId,
            sokoBotId: id(11),
            workspaceId,
            name: "Stop when done",
            timezone: "UTC",
            cronExpression: "0 8 * * *",
            prompt: "Check the Job",
            nextRunAt: END,
            authority: authority as Prisma.InputJsonValue,
            runs: {
              create: { turnId, scheduledFor: CLOCK, status: "CLAIMED" },
            },
          },
        });
        const check = (scope: NetworkScope) =>
          requireScheduledRunMayEnd(
            prisma,
            turnId,
            "delete_schedule",
            { scheduleId },
            {
              scope,
              turn: {
                ...claimed.actionContext.turn,
                source: "SCHEDULE",
                versionId: "v36",
              },
              askedByKind: "OWNER",
              grant: { capabilities: ["delete_schedule"] },
            },
            { now: CLOCK },
          );
        await expect(check(mainnet)).resolves.toBeUndefined();
        await expect(check(preprod)).rejects.toThrow(
          "unless its owner authorized a stop rule",
        );
        await prisma.sokoBotTurn.updateMany({
          where: { id: { in: [id(30), turnId] } },
          data: { status: "COMPLETED" },
        });
      }, 90_000);

      it.each([
        ["mainnet", "Mainnet", id(35)],
        ["preprod", "Preprod", id(36)],
      ] as const)(
        "starts a %s turn and returns that Network's classifier and packet rows",
        async (network, label, turnId) => {
          await seedPreprod();
          const context = new ContextPacketBuilder();
          const classifier: TurnClassifier = {
            classify: async (message, input) => {
              expect(input.candidates).toEqual(
                expect.arrayContaining([
                  { kind: "JOB", id: JOB, name: `${label} Job` },
                  { kind: "AGENT", id: AGENT, name: `${label} Agent` },
                ]),
              );
              return presetClassificationResult(message, {
                route: "HIRE_AGENT",
                reason: "Network read fixture",
              });
            },
          };
          const plane = new SokoBotControlPlane(
            waitingRuntime(turnId),
            context,
            classifier,
          );
          // The first read lifts only 30-1's temporary admission refusal.
          const networkAtStart = vi
            .fn<() => Network>()
            .mockReturnValueOnce("mainnet")
            .mockReturnValue(network);
          const started = await plane.startTurn({
            get network() {
              return networkAtStart();
            },
            expectedPreprodGeneration: 7,
            userId: OWNER,
            sokoBotId: id(11),
            workspaceId,
            clientTurnId: turnId,
            message: "Check the visible Jobs",
          });
          const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
            where: { id: started.turnId },
            include: { contextSnapshot: true },
          });
          expect(turn.network).toBe(network);
          expect(turn.contextSnapshot?.packet).toMatchObject({
            jobs: expect.arrayContaining([
              expect.objectContaining({ id: JOB, name: `${label} Job` }),
            ]),
            agents: expect.arrayContaining([
              expect.objectContaining({
                id: AGENT,
                name: `${label} Agent`,
              }),
            ]),
          });
          await prisma.sokoBotTurn.delete({ where: { id: turn.id } });
        },
        60_000,
      );

      it.each([
        ["mainnet", "Mainnet", id(37)],
        ["preprod", "Preprod", id(38)],
      ] as const)(
        "returns %s rows from Agent discovery and posted result references",
        async (network, label, turnId) => {
          await seedPreprod();
          await runningTurn(turnId, network);
          await expect(tool(turnId, "find_agents", {})).resolves.toMatchObject({
            result: {
              agents: expect.arrayContaining([
                expect.objectContaining({
                  id: AGENT,
                  name: `${label} Agent`,
                }),
              ]),
            },
          });
          const posted = await tool(turnId, "post_chat", {
            roomId: id(41),
            content: `Job update from ${label}`,
            resultReferences: [previewRef],
          });
          expect(posted, json(posted)).toMatchObject({
            messageId: expect.any(String),
          });
          const message = await prisma.chatRoomMessage.findUniqueOrThrow({
            where: { id: posted.messageId },
          });
          expect(message.metadata).toMatchObject({
            [RESULT_SNAPSHOTS_KEY]: [
              expect.objectContaining({
                reference: previewRef,
                data: expect.objectContaining({ title: `${label} Job` }),
              }),
            ],
          });
        },
      );

      it.each([true, false])(
        "checks Job write scope on the turn Network (approved=%s)",
        async (approved) => {
          await seedPreprod();
          const runtime = {} as RuntimeOperations;
          for (const [network, turnId] of [
            ["mainnet", id(approved ? 50 : 51)],
            ["preprod", id(approved ? 52 : 53)],
          ] as const) {
            await runningTurn(turnId, network, id(12));
            const authorized = await sokoBotRuntimeService.authorize({
              turnId,
              sessionId: `session-${turnId}`,
            });
            const check = (jobId: string) =>
              prisma.$transaction((tx) =>
                requireMutationAuthority(
                  {
                    requireWriteScope: (...args) =>
                      requireWriteScope(runtime, ...args),
                  },
                  tx,
                  authorized,
                  approved,
                  undefined,
                  { jobId },
                ),
              );
            await expect(check(INPUT_JOB)).resolves.toBeDefined();
            if (network === "preprod") {
              await expect(check(SCOPE_JOB)).resolves.toBeDefined();
            } else {
              await expect(check(SCOPE_JOB)).rejects.toThrow("Job not found");
            }
          }
        },
      );

      it.each([
        ["mainnet", AGENT, INPUT_JOB, id(54)],
        ["preprod", PREPROD_ACTION_AGENT, JOB, id(55)],
      ] as const)(
        "finishes and settles a %s turn using its hire and Job input receipts",
        async (network, agentId, inputJobId, turnId) => {
          await seedPreprod();
          const turn = await runningTurn(turnId, network);
          const sessionId = `session-${turnId}`;
          await prisma.sokoBotTurn.update({
            where: { id: turnId },
            data: { leaseToken: turnId, route: "HIRE_AGENT" },
          });
          await prisma.sokoBotToolCall.createMany({
            data: [
              { capability: "hire_agent", targetId: ACTION_JOB },
              { capability: "provide_job_input", targetId: "settled-input" },
            ].map(({ capability, targetId }) => ({
              turnId,
              toolCallId: capability,
              capability,
              targetId,
              inputHash: capability,
              input: {},
              status: "COMPLETED",
              verification: "LOCAL_TRANSACTION",
              disposition: "APPLIED",
              committedAt: CLOCK,
            })),
          });
          // The split preview reader resolves the receipt's input id first.
          // Authorization for the resulting card is still pinned to Mainnet.
          const db = createNetworkScope(network).networkDb;
          await db.jobEvent.create({
            data: {
              id: "settled-input-event",
              jobId: inputJobId,
              status: "COMPLETED",
              createdAt: new Date(CLOCK.getTime() - 1000),
              input: { create: { id: "settled-input", input: "{}" } },
            },
          });
          await announceTurn(
            new RuntimeEventLog(turnId, sessionId),
            turn.userMessage,
          );
          await completeSandboxTurn(
            { turnId, sessionId, expiresAt: END.getTime() },
            {
              text: "",
              finishReason: "stop",
            },
          );
          const before = await prisma.sokoBotTurn.findUniqueOrThrow({
            where: { id: turnId },
          });
          expect(before.responseContract).toMatchObject({
            answerText: expect.stringContaining(agentId),
          });
          await new SokoBotControlPlane(
            new SandboxSokoBotRuntime(),
          ).reconcileTurn(turnId, undefined, turnId);
          const after = await prisma.sokoBotTurn.findUniqueOrThrow({
            where: { id: turnId },
          });
          expect(after.status).toBe("COMPLETED");
          expect(after.finalAnswer).toContain(agentId);
          const cards = await prisma.sokoBotToolCall.findMany({
            where: { turnId, capability: "preview_result" },
            select: { result: true },
          });
          expect(cards).toContainEqual({
            result: expect.objectContaining({
              reference: { kind: "job", id: inputJobId },
            }),
          });
          expect(cards).not.toContainEqual({
            result: expect.objectContaining({
              reference: {
                kind: "job",
                id: network === "mainnet" ? JOB : INPUT_JOB,
              },
            }),
          });
        },
        60_000,
      );

      it("hides another member's Job and private Tasks from the split status tool", async () => {
        await seedPreprod();
        const turnId = id(56);
        await runningTurn(turnId, "preprod");
        for (const jobId of [ACTION_JOB, HIDDEN]) {
          await expect(
            tool(turnId, "get_job_status", { jobId }, jobId),
          ).resolves.toMatchObject({ result: null });
        }
      });

      it("excludes other Projects and the owner's private Task from split readers", async () => {
        await seedPreprod();
        const preprod = createNetworkScope("preprod");
        const ownerPrivateTask = await prisma.task.create({
          data: {
            ownerId: OWNER,
            name: "Owner's private Task",
            visibility: "PRIVATE",
            workspaceId,
            projectId,
          },
        });
        const otherProjectTask = await prisma.task.create({
          data: {
            ownerId: OWNER,
            name: "Other Project Task",
            visibility: "PUBLIC",
            workspaceId,
            projectId: emptyProjectId,
          },
        });
        const ownerPrivateJob = "owner-private-job";
        const otherProjectJob = "other-project-job";
        await preprod.networkDb.job.createMany({
          data: [
            { id: ownerPrivateJob, taskId: ownerPrivateTask.id, projectId },
            {
              id: otherProjectJob,
              taskId: otherProjectTask.id,
              projectId: emptyProjectId,
            },
          ].map((job) => ({
            ...job,
            agentJobId: job.id,
            agentId: AGENT,
            ownerId: OWNER,
            workspaceId,
            organizationId: ORG,
            jobType: "FREE",
            createdAt: CLOCK,
            updatedAt: CLOCK,
          })),
        });
        const sharedTurn = id(57);
        await runningTurn(sharedTurn, "preprod", id(12));
        await expect(
          tool(
            sharedTurn,
            "get_job_status",
            { jobId: INPUT_JOB },
            "own-project",
          ),
        ).resolves.toMatchObject({ result: { name: "Approved input Job" } });
        await expect(
          tool(
            sharedTurn,
            "get_job_status",
            { jobId: otherProjectJob },
            "other-project",
          ),
        ).resolves.toMatchObject({ result: null });
        const context = new ContextPacketBuilder();
        const owner = await context.build(packetInput(preprod));
        const teammate = await context.build({
          ...packetInput(preprod),
          audience: "TEAMMATE",
        });
        expect(owner.packet.jobs.map(({ id }) => id)).toContain(
          ownerPrivateJob,
        );
        expect(teammate.packet.jobs.map(({ id }) => id)).toContain(
          otherProjectJob,
        );
        expect(teammate.packet.jobs.map(({ id }) => id)).not.toContain(
          ownerPrivateJob,
        );
      });

      it("round-trips a split Job attachment size above JavaScript's safe integer range", async () => {
        await seedPreprod();
        const preprod = createNetworkScope("preprod");
        const size = 9_007_199_254_740_995n;
        await preprod.networkDb.blob.create({
          data: {
            eventId: "fixture-job-recent-event",
            status: "READY",
            sourceUrl: "https://attachment.example.test/output",
            size,
          },
        });
        const row = await readSplitBotJob(
          preprod,
          preprod.networkDb,
          JOB,
          workspaceId,
        );
        expect(row?.events[0]?.blobs[0]?.size).toBe(size);
      });
    });
  },
);
