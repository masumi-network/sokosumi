import { randomUUID } from "node:crypto";
import type { SokoBotDelegation } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as env from "@/config/env";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { Network } from "@/lib/network";
import { reserveEventOccurrence } from "@/lib/soko-bot/event-inbox";
import { expectCoreLog } from "@/test/core-log";
import { onSplitLayout } from "@/test/split-layout";
import * as billing from "./soko-bot-billing.service";
import { sokoBotControlPlane } from "./soko-bot-control-plane.service";
import { sokoBotEventsSyncService } from "./soko-bot-events-sync.service";
import * as proactive from "./soko-bot-proactive.service";

vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

let ownerId: string;
let workspaceId: string;
let botId: string;
let parentId: string;
let cleanUpJobs: (() => Promise<void>)[];

function turnData(clientTurnId: string, network: Network) {
  return {
    network,
    sokoBotId: botId,
    requestedByUserId: ownerId,
    workspaceId,
    source: "EVENT" as const,
    status: "COMPLETED" as const,
    clientTurnId,
    userMessage: "Inbox test",
    capabilityNames: [],
    deadlineAt: new Date(),
  };
}

beforeEach(async () => {
  cleanUpJobs = [];
  ownerId = randomUUID();
  workspaceId = randomUUID();
  await prisma.user.create({
    data: {
      id: ownerId,
      name: "Inbox owner",
      email: `${ownerId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      workspace: { create: { id: workspaceId } },
    },
  });
  botId = (
    await prisma.sokoBot.create({ data: { userId: ownerId, workspaceId } })
  ).id;
  parentId = (
    await prisma.sokoBotTurn.create({ data: turnData("source", "mainnet") })
  ).id;
  vi.spyOn(proactive, "proactiveGate").mockResolvedValue({
    ok: true,
    usedToday: 0,
    limit: 20,
  });
  // Exercise the real inbox reservation inside a turn transaction, without starting a bot runtime.
  vi.spyOn(sokoBotControlPlane, "startTurn").mockImplementation(async (input) =>
    prisma.$transaction(async (tx) => {
      const turn = await tx.sokoBotTurn.create({
        data: turnData(input.clientTurnId, input.network),
      });
      for (const occurrence of input.eventBatch ?? [])
        await reserveEventOccurrence(
          tx,
          botId,
          turn.id,
          input.network,
          occurrence,
        );
      return {
        turnId: turn.id,
        sokoBotId: botId,
        status: turn.status,
        route: "EVENT",
        capabilities: [],
        duplicate: false,
        sessionId: turn.id,
      };
    }),
  );
}, 30_000);

afterEach(async () => {
  for (const cleanUp of cleanUpJobs) await cleanUp();
  vi.restoreAllMocks();
  await prisma.sokoBot.deleteMany({ where: { id: botId } });
  await prisma.chatRoom.deleteMany({ where: { createdByUserId: ownerId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

async function source(
  kind: "JOB" | "TASK",
  network: Network,
  entityId: string,
  eventId?: string,
) {
  const delegation = await prisma.sokoBotDelegation.create({
    data: {
      turnId: parentId,
      toolCallId: randomUUID(),
      kind,
      action: "delegate",
      network,
      lastSeenStatus: "RUNNING",
    },
    include: { turn: { include: { sokoBot: true } } },
  });
  const entity = {
    id: entityId,
    name: "work",
    workspaceId,
    ownerId,
    taskId: null as string | null,
    events: eventId
      ? [
          {
            id: eventId,
            status: "COMPLETED",
            createdAt: new Date("2100-01-01"),
          },
        ]
      : [],
  };
  return {
    ...delegation,
    jobId: kind === "JOB" ? entityId : null,
    job: kind === "JOB" ? entity : null,
    task:
      kind === "TASK"
        ? { ...entity, status: "INPUT_REQUIRED", visibility: "PUBLIC" }
        : null,
  };
}

type ScannedRow = SokoBotDelegation & {
  job?: {
    id: string;
    name: string | null;
    workspaceId: string;
    ownerId: string | null;
    taskId?: string | null;
    events: { id: string; status: string; createdAt: Date }[];
  } | null;
};

async function scan(rows: ScannedRow[]) {
  // Ticket 30-3 owns the Preprod Job event wake. Deliver observations at the
  // page-read boundary; grouping, consumed lookups, turns and inbox use PostgreSQL.
  vi.spyOn(prisma.sokoBotDelegation, "findMany").mockResolvedValueOnce(
    rows.map(({ job, ...rest }) => ({
      ...rest,
      jobId: job ? job.id : rest.jobId,
    })),
  );
  const byId = new Map(
    rows.flatMap((row) =>
      row.job ? [[row.job.id, { taskId: null, ...row.job }] as const] : [],
    ),
  );
  const jobSpy = vi
    .spyOn(createNetworkScope("mainnet").networkDb.job, "findMany")
    .mockImplementation((async (args?: {
      where?: { id?: { in?: string[] } };
    }) =>
      (args?.where?.id?.in ?? []).flatMap((id) => {
        const job = byId.get(id);
        return job ? [job] : [];
      })) as never);
  try {
    return await sokoBotEventsSyncService.syncDelegatedWork({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      sokoBotId: botId,
    });
  } finally {
    jobSpy.mockRestore();
  }
}

async function oldInsert(eventId: string, purpose: string) {
  return prisma.$executeRaw`INSERT INTO ${sharedTable("soko_bot_event_inbox")}
    (id,"botId","turnId","entityId","eventId",purpose)
    VALUES (${randomUUID()}::uuid,${botId}::uuid,${parentId}::uuid,'job-A',${eventId},${purpose})`;
}

it("rejects a network on a Task and an unknown network on a Job", async () => {
  for (const [purpose, network] of [
    ["TASK_EVENT", "preprod"],
    ["JOB_EVENT", "testnet"],
  ]) {
    await expect(
      prisma.$executeRaw`INSERT INTO ${sharedTable("soko_bot_event_inbox")}
        (id,"botId","turnId","entityId","eventId",purpose,network)
        VALUES (${randomUUID()}::uuid,${botId}::uuid,${parentId}::uuid,'entity','evt',${purpose},${network})`,
    ).rejects.toMatchObject({
      meta: { driverAdapterError: { cause: { originalCode: "23514" } } },
    });
  }
});

it("retries a status-only Mainnet Task each tick when taskboard already reserved its synthetic ID", async () => {
  const task = await source("TASK", "mainnet", "task-B");
  await reserveEventOccurrence(prisma, botId, parentId, "mainnet", {
    eventId: "task-B:INPUT_REQUIRED",
    entityId: "task-B",
    purpose: "TASK_EVENT",
    status: "INPUT_REQUIRED",
    designatedHandlerBotId: botId,
  });
  expectCoreLog(
    "error",
    "Could not wake a Soko Bot for changes in its delegated work",
    2,
  );
  for (let tick = 0; tick < 2; tick++) {
    expect(await scan([task])).toMatchObject({ woken: 0, failed: 1 });
    expect(
      await prisma.sokoBotDelegation.findUniqueOrThrow({
        where: { id: task.id },
        select: { lastSeenStatus: true },
      }),
    ).toEqual({ lastSeenStatus: "RUNNING" });
  }
});

it.each(["job-A", "different-job"])(
  "wakes each Network once when Preprod entity is %s",
  async (preprodEntity) => {
    const main = await source("JOB", "mainnet", "job-A", "evt-2");
    const pre = await source("JOB", "preprod", preprodEntity, "evt-2");
    expect(await scan([main, pre])).toMatchObject({ woken: 2, failed: 0 });
    const rows = await prisma.sokoBotEventInbox.findMany({
      where: { botId },
      orderBy: { network: "asc" },
      select: {
        network: true,
        eventId: true,
        turn: { select: { clientTurnId: true } },
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      network: "mainnet",
      eventId: "evt-2",
      turn: {
        clientTurnId:
          "event:a5637970a508ef2171b7437651bab62d60c4205d46f1515b450c701b8875584b",
      },
    });
    expect(rows[1]).toMatchObject({ network: "preprod", eventId: "evt-2" });
    expect(rows[1].turn.clientTurnId).not.toEqual(rows[0].turn.clientTurnId);
    expect(await scan([pre, main])).toMatchObject({ woken: 0, failed: 0 });
  },
);

it("keeps a legacy Mainnet Job consumed while its Preprod namesake and a shared Task are new", async () => {
  await oldInsert("same", "JOB_EVENT");
  const main = await source("JOB", "mainnet", "job-A", "same");
  const pre = await source("JOB", "preprod", "job-A", "same");
  const task = await source("TASK", "preprod", "task-B", "same");
  expect(await scan([main, pre, task])).toMatchObject({ woken: 2, failed: 0 });
  expect(await scan([main, pre, task])).toMatchObject({ woken: 0, failed: 0 });
  const entries = await prisma.sokoBotEventInbox.findMany({
    where: { botId },
    select: { network: true, purpose: true, eventId: true },
  });
  expect(entries).toHaveLength(3);
  expect(entries).toEqual(
    expect.arrayContaining([
      { network: null, purpose: "TASK_EVENT", eventId: "same" },
      { network: null, purpose: "JOB_EVENT", eventId: "same" },
      { network: "preprod", purpose: "JOB_EVENT", eventId: "same" },
    ]),
  );
  const occurrence = {
    eventId: "same",
    entityId: "job-A",
    purpose: "JOB_EVENT",
    status: "COMPLETED",
    designatedHandlerBotId: botId,
  };
  await expect(
    reserveEventOccurrence(prisma, botId, parentId, "mainnet", occurrence),
  ).rejects.toMatchObject({ code: "P2002" });
  await expect(
    reserveEventOccurrence(prisma, botId, parentId, "preprod", {
      ...occurrence,
      purpose: "TASK_EVENT",
    }),
  ).rejects.toMatchObject({ code: "P2002" });
});

it("keeps one mixed Mainnet wake and the deployed batch ID", async () => {
  const job = await source("JOB", "mainnet", "job-A", "evt-2");
  const task = await source("TASK", "mainnet", "task-B", "evt-1");
  expect(await scan([task, job])).toMatchObject({ woken: 1, failed: 0 });
  const rows = await prisma.sokoBotEventInbox.findMany({
    where: { botId },
    select: { turn: { select: { clientTurnId: true } } },
  });
  const deployedId =
    "event:db7562d831e3daef72210c64ee7b24f2e66cc6c7b4a5ae3b512cd6a6926c33a0";
  expect(rows.map((row) => row.turn.clientTurnId)).toEqual([
    deployedId,
    deployedId,
  ]);
  expect(await scan([job, task])).toMatchObject({ woken: 0, failed: 0 });
});

it("keeps the Mainnet-only scanner gated and consumes colliding physical Job events on the split layout", async () => {
  if (onSplitLayout)
    vi.spyOn(env, "getEnv").mockReturnValue({
      ...env.getEnv(),
      NETWORK_PREPROD_ENABLED: true,
    });
  const jobId = randomUUID();
  const eventId = randomUUID();
  async function persistedJob(network: Network) {
    const db = createNetworkScope(network).networkDb;
    const agent = await db.agent.create({
      data: {
        blockchainIdentifier: randomUUID(),
        name: "Inbox Agent",
        isShown: true,
        lastUptimeCheck: new Date(),
        uptimeCount: 1,
        uptimeCheckCount: 1,
        pricing: { create: { pricingType: "FREE" } },
      },
    });
    cleanUpJobs.push(async () => {
      await db.job.deleteMany({ where: { agentId: agent.id } });
      await db.agent.delete({ where: { id: agent.id } });
      await db.agentPricing.delete({ where: { id: agent.pricingId } });
    });
    return db.job.create({
      data: {
        id: jobId,
        name: "Agent Job",
        workspaceId,
        ownerId,
        agentId: agent.id,
        agentJobId: randomUUID(),
        jobType: "FREE",
        events: {
          create: {
            id: eventId,
            status: "COMPLETED",
            createdAt: new Date("2100-01-01"),
          },
        },
      },
      include: { events: true },
    });
  }
  const mainJob = await persistedJob("mainnet");
  const main = await source("JOB", "mainnet", jobId, eventId);
  const pre = await source("JOB", "preprod", jobId, eventId);
  await prisma.sokoBotDelegation.updateMany({
    where: { id: { in: [main.id, pre.id] } },
    data: { jobId },
  });
  if (onSplitLayout) {
    const preJob = await persistedJob("preprod");
    const observations = [
      { ...main, job: mainJob },
      { ...pre, job: preJob },
    ];
    expect(await scan(observations)).toMatchObject({ woken: 2, failed: 0 });
    expect(await scan(observations)).toMatchObject({ woken: 0, failed: 0 });
  } else {
    vi.mocked(sokoBotControlPlane.startTurn).mockRestore();
    vi.spyOn(billing, "requireSokoBotTurnFunding").mockResolvedValue();
    // The production source only delivers Mainnet even when a Preprod
    // delegation points at the same Job id in today's single schema.
    const deliver = () =>
      sokoBotEventsSyncService.syncDelegatedWork({
        abortSignal: new AbortController().signal,
        shouldContinue: () => true,
        sokoBotId: botId,
      });
    expect(await deliver()).toMatchObject({ scanned: 1, woken: 1, failed: 0 });
    expect(await deliver()).toMatchObject({ scanned: 1, woken: 0, failed: 0 });
    expect(
      await prisma.sokoBotEventInbox.findMany({
        where: { botId },
        select: { network: true, eventId: true },
      }),
    ).toEqual([{ network: "mainnet", eventId }]);
  }
});
