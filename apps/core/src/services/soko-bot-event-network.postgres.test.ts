/**
 * The Job event wake reads each Job through its delegation's Network (ticket
 * 24, slice 6), on a real PostgreSQL: the scan, the per-Network Job load, the
 * pickup rule that leaves Preprod Job delegations out while a fresh Preprod
 * turn is refused, the refusals of `startTurn`, and the failed-turn lookup of
 * a follow-up retry. `startTurn` is replaced at its boundary by a recorder
 * that reserves the inbox rows in a turn transaction, as the real one does;
 * where a case needs the 30-1 guard itself, Preprod inputs reach the real one.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/network", async (original) => {
  const network = await original<typeof import("@/lib/network")>();
  return {
    ...network,
    isPreprodOn: () => flag.on,
    requireNetworkOn: (value: unknown) =>
      flag.on ? network.requireNetwork(value) : network.requireNetworkOn(value),
  };
});
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

import {
  PREPROD_GENERATION_KEY,
  PREPROD_PAUSE_KEY,
  raisePreprodGeneration,
} from "@/helpers/preprod-control";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { Network } from "@/lib/network";
import { reserveEventOccurrence } from "@/lib/soko-bot/event-inbox";
import { FOLLOW_UP_RETRY_SUFFIX } from "@/lib/soko-bot/follow-up-retry";
import * as scheduleResume from "@/lib/soko-bot/schedule-resume";
import type { StartSokoBotTurnInput } from "@/lib/soko-bot/turn-start";
import { expectCoreLog } from "@/test/core-log";
import { recordStatements } from "@/test/record-statements";
import { onSplitLayout } from "@/test/split-layout";
import { sokoBotControlPlane } from "./soko-bot-control-plane.service";
import {
  SOKO_EVENTS_SYNC_KEY,
  sokoBotEventsSyncService,
} from "./soko-bot-events-sync.service";
import * as proactive from "./soko-bot-proactive.service";
import { planTurnIds } from "./soko-bot-runtime/media-checks";

const LATER = new Date("2100-01-01T00:00:00Z");
const GENERATION = 7;

let cleanUps: (() => Promise<unknown>)[];
/** Jobs go first: they reference workspaces of users created after their Agent. */
let jobCleanUps: (() => Promise<unknown>)[];
let starts: StartSokoBotTurnInput[];
let owner: string;
let workspaceId: string;

async function createUser(workspace?: string) {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: "Event Network owner",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(workspace ? { workspace: { create: { id: workspace } } } : {}),
    },
  });
  cleanUps.push(async () => {
    await prisma.chatRoom.deleteMany({ where: { createdByUserId: id } });
    await prisma.user.deleteMany({ where: { id } });
  });
  return id;
}

/** A bot and the turn its delegations came from. */
async function createBot(botUserId: string | null, requestedBy = owner) {
  const bot = await prisma.sokoBot.create({
    data: { userId: botUserId, workspaceId },
  });
  // Runs before the users' clean-up: clean-ups run last first.
  cleanUps.push(() => prisma.sokoBot.deleteMany({ where: { id: bot.id } }));
  const turn = await prisma.sokoBotTurn.create({
    data: turnData(bot.id, requestedBy, `source-${randomUUID()}`, "mainnet"),
  });
  return { botId: bot.id, turnId: turn.id };
}

function turnData(
  sokoBotId: string,
  requestedByUserId: string | null,
  clientTurnId: string,
  network: Network,
  preprodGeneration?: number | null,
) {
  return {
    network,
    preprodGeneration:
      network === "preprod" ? (preprodGeneration ?? null) : null,
    sokoBotId,
    requestedByUserId,
    workspaceId,
    source: "EVENT" as const,
    status: "COMPLETED" as const,
    clientTurnId,
    userMessage: "Event Network test",
    capabilityNames: [],
    deadlineAt: new Date(),
  };
}

const agents = new Map<Network, string>();
async function agentOn(network: Network) {
  const known = agents.get(network);
  if (known) return known;
  const db = createNetworkScope(network).networkDb;
  const agent = await db.agent.create({
    data: {
      blockchainIdentifier: randomUUID(),
      name: "Event Network Agent",
      isShown: true,
      lastUptimeCheck: new Date(),
      uptimeCount: 1,
      uptimeCheckCount: 1,
      pricing: { create: { pricingType: "FREE" } },
    },
  });
  agents.set(network, agent.id);
  jobCleanUps.push(async () => {
    const own = createNetworkScope(network).networkDb;
    await own.job.deleteMany({ where: { agentId: agent.id } });
    await own.agent.delete({ where: { id: agent.id } });
    await own.agentPricing.delete({ where: { id: agent.pricingId } });
  });
  return agent.id;
}

async function createJob(
  network: Network,
  options: {
    id?: string;
    name?: string;
    status?: "COMPLETED" | "FAILED" | "AWAITING_INPUT" | "RUNNING";
    eventId?: string;
    ownerId?: string;
    taskId?: string | null;
  } = {},
) {
  const id = options.id ?? randomUUID();
  const eventId = options.eventId ?? randomUUID();
  // On the split layout a delegation's Job key still references mainnet.Job,
  // so a Preprod Job delegation needs a Mainnet namesake (a RUNNING one here).
  if (
    network === "preprod" &&
    onSplitLayout &&
    !(await createNetworkScope("mainnet").networkDb.job.findUnique({
      where: { id },
    }))
  )
    await createJob("mainnet", {
      id,
      name: "Mainnet namesake",
      status: "RUNNING",
      ownerId: options.ownerId,
    });
  await createNetworkScope(network).networkDb.job.create({
    data: {
      id,
      name: options.name ?? `Job ${id}`,
      workspaceId,
      ownerId: options.ownerId ?? owner,
      agentId: await agentOn(network),
      agentJobId: randomUUID(),
      jobType: "FREE",
      taskId: options.taskId ?? null,
      events: {
        create: {
          id: eventId,
          status: options.status ?? "COMPLETED",
          createdAt: LATER,
        },
      },
    },
  });
  return { id, eventId };
}

async function createTask(
  options: {
    id?: string;
    name?: string;
    status?: "INPUT_REQUIRED" | "COMPLETED";
    visibility?: "PUBLIC" | "PRIVATE";
    ownerId?: string;
    eventId?: string | null;
  } = {},
) {
  const task = await prisma.task.create({
    data: {
      ...(options.id !== undefined ? { id: options.id } : {}),
      workspaceId,
      ownerId: options.ownerId ?? owner,
      name: options.name ?? "Event Network Task",
      status: options.status ?? "INPUT_REQUIRED",
      visibility: options.visibility ?? "PUBLIC",
    },
  });
  cleanUps.push(() => prisma.task.deleteMany({ where: { id: task.id } }));
  if (options.eventId !== null)
    await prisma.taskEvent.create({
      data: {
        id: options.eventId ?? randomUUID(),
        taskId: task.id,
        status: task.status,
        comment: "A Coworker note",
        createdAt: LATER,
      },
    });
  return task.id;
}

function delegate(
  turnId: string,
  network: Network | null,
  work: { jobId: string } | { taskId: string },
  generation: number | null = network === "preprod" ? GENERATION : null,
) {
  return prisma.sokoBotDelegation.create({
    data: {
      turnId,
      toolCallId: randomUUID(),
      kind: "jobId" in work ? "JOB" : "TASK",
      action: "delegate",
      network,
      preprodGeneration: generation,
      lastSeenStatus: "RUNNING",
      ...work,
    },
  });
}

const tick = (sokoBotId?: string) =>
  sokoBotEventsSyncService.syncDelegatedWork({
    abortSignal: new AbortController().signal,
    shouldContinue: () => true,
    ...(sokoBotId ? { sokoBotId } : {}),
  });

/**
 * The recorder: each input as `startTurn` received it, and the turn with its
 * inbox rows in one transaction. `real` sends an input on to the real one.
 */
function recordStarts(
  real: (input: StartSokoBotTurnInput) => boolean = () => false,
  before?: (input: StartSokoBotTurnInput) => Promise<unknown>,
) {
  const realStart = sokoBotControlPlane.startTurn.bind(sokoBotControlPlane);
  vi.spyOn(sokoBotControlPlane, "startTurn").mockImplementation(
    async (input) => {
      starts.push(structuredClone(input));
      await before?.(input);
      if (real(input)) return realStart(input);
      return prisma.$transaction(async (tx) => {
        const turn = await tx.sokoBotTurn.create({
          data: turnData(
            input.sokoBotId ?? "",
            input.userId,
            input.clientTurnId,
            input.network,
            input.expectedPreprodGeneration,
          ),
        });
        for (const occurrence of input.eventBatch ?? []) {
          await reserveEventOccurrence(
            tx,
            turn.sokoBotId,
            turn.id,
            input.network,
            occurrence,
          );
          // As the real start does in the same transaction.
          await tx.sokoBotDelegation.updateMany({
            where: { id: { in: occurrence.delegationIds ?? [] } },
            data: {
              lastSeenStatus: occurrence.status,
              lastSeenEventId: occurrence.eventId,
              ...(occurrence.delegationEventAt !== undefined
                ? { lastSeenEventAt: occurrence.delegationEventAt }
                : {}),
            },
          });
        }
        return {
          turnId: turn.id,
          sokoBotId: turn.sokoBotId,
          status: turn.status,
          route: "EVENT",
          capabilities: [],
          duplicate: false,
          sessionId: turn.id,
        };
      });
    },
  );
}

async function setControl(pause: string, generation: string) {
  const keys = [PREPROD_PAUSE_KEY, PREPROD_GENERATION_KEY];
  const before = await prisma.syncMetadata.findMany({
    where: { key: { in: keys } },
  });
  cleanUps.push(async () => {
    await prisma.syncMetadata.deleteMany({ where: { key: { in: keys } } });
    await prisma.syncMetadata.createMany({ data: before });
  });
  for (const [key, cursorId] of [
    [PREPROD_PAUSE_KEY, pause],
    [PREPROD_GENERATION_KEY, generation],
  ])
    await prisma.syncMetadata.upsert({
      where: { key },
      create: { key, cursorId, lastSyncedAt: new Date() },
      update: { cursorId },
    });
}

const liftGuard = () =>
  vi.spyOn(scheduleResume, "freshPreprodTurnsDeferred").mockReturnValue(false);

const row = (id: string) =>
  prisma.sokoBotDelegation.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  cleanUps = [];
  jobCleanUps = [];
  starts = [];
  agents.clear();
  flag.on = false;
  workspaceId = randomUUID();
  owner = await createUser(workspaceId);
  vi.spyOn(proactive, "proactiveGate").mockResolvedValue({
    ok: true,
    usedToday: 0,
    limit: 20,
  });
  // The scan's cutover is older than every event here.
  await prisma.syncMetadata.upsert({
    where: { key: SOKO_EVENTS_SYNC_KEY },
    create: { key: SOKO_EVENTS_SYNC_KEY, lastSyncedAt: new Date() },
    update: {},
  });
}, 30_000);

afterEach(async () => {
  vi.restoreAllMocks();
  flag.on = onSplitLayout;
  for (const cleanUp of [...jobCleanUps, ...cleanUps.reverse()])
    await cleanUp();
  flag.on = false;
}, 60_000);

describe("Mainnet, on each layout", () => {
  it("wakes Mainnet and NULL-tagged Jobs from mainnet, and a preprod-tagged Task as Mainnet, in one wake", async () => {
    const { botId, turnId } = await createBot(owner);
    const stranger = await createUser();
    const parent = await createTask({ name: "Parent Task", eventId: null });
    const hidden = await createTask({
      name: "Hidden parent",
      visibility: "PRIVATE",
      ownerId: stranger,
      eventId: null,
    });
    const tagged = await createJob("mainnet", {
      name: "Tagged Mainnet Job",
      taskId: parent,
    });
    const legacy = await createJob("mainnet", {
      name: "Legacy Job",
      status: "FAILED",
    });
    const behindPrivate = await createJob("mainnet", {
      name: "Job of a hidden Task",
      taskId: hidden,
    });
    const foreign = await createJob("mainnet", {
      name: "Someone else's Job",
      ownerId: stranger,
    });
    const task = await createTask({ name: "Preprod-tagged Task" });
    const statusOnly = await createTask({
      name: "Status-only Task",
      eventId: null,
    });
    const rows = [
      await delegate(turnId, "mainnet", { jobId: tagged.id }),
      await delegate(turnId, null, { jobId: legacy.id }),
      await delegate(turnId, "mainnet", { jobId: behindPrivate.id }),
      await delegate(turnId, "mainnet", { jobId: foreign.id }),
      await delegate(turnId, "preprod", { taskId: task }),
      await delegate(turnId, null, { taskId: statusOnly }),
    ];
    recordStarts();

    expect(await tick(botId)).toMatchObject({ scanned: 6, woken: 1 });
    expect(starts).toHaveLength(1);
    const [start] = starts;
    expect(start.network).toBe("mainnet");
    expect("expectedPreprodGeneration" in start).toBe(false);
    expect(start.message).toContain(
      `Job "Tagged Mainnet Job" (id ${tagged.id}) is now COMPLETED`,
    );
    expect(start.message).toContain(
      `Job "Legacy Job" (id ${legacy.id}) is now FAILED`,
    );
    expect(start.message).toContain(`Task "Preprod-tagged Task"`);
    expect(start.message).toContain(`Task "Status-only Task"`);
    expect(start.message).not.toContain("Job of a hidden Task");
    expect(start.message).not.toContain("Someone else's Job");
    expect(
      await prisma.sokoBotEventInbox.findMany({
        where: { botId },
        orderBy: { eventId: "asc" },
        select: { eventId: true, purpose: true, network: true },
      }),
    ).toEqual(
      [
        { eventId: tagged.eventId, purpose: "JOB_EVENT", network: "mainnet" },
        { eventId: legacy.eventId, purpose: "JOB_EVENT", network: "mainnet" },
        {
          eventId: `${statusOnly}:INPUT_REQUIRED`,
          purpose: "TASK_EVENT",
          network: null,
        },
        {
          eventId: (
            await prisma.taskEvent.findFirstOrThrow({ where: { taskId: task } })
          ).id,
          purpose: "TASK_EVENT",
          network: null,
        },
      ].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    );
    // A redelivery starts nothing; the left-out Jobs stay unseen.
    expect(await tick(botId)).toMatchObject({ woken: 0 });
    expect(starts).toHaveLength(1);
    expect((await row(rows[2].id)).lastSeenStatus).toBe("RUNNING");
    expect((await row(rows[3].id)).lastSeenStatus).toBe("RUNNING");
  });

  it("wakes each member of a shared bot for that member's own Jobs", async () => {
    const other = await createUser();
    const shared = await createBot(null, owner);
    const otherTurn = await prisma.sokoBotTurn.create({
      data: turnData(shared.botId, other, `source-${randomUUID()}`, "mainnet"),
    });
    const mine = await createJob("mainnet", { name: "Owner's Job" });
    const theirs = await createJob("mainnet", {
      name: "Member's Job",
      ownerId: other,
    });
    const crossed = await createJob("mainnet", {
      name: "Member's Job on the owner's turn",
      ownerId: other,
    });
    await delegate(shared.turnId, "mainnet", { jobId: mine.id });
    await delegate(otherTurn.id, "mainnet", { jobId: theirs.id });
    await delegate(shared.turnId, null, { jobId: crossed.id });
    recordStarts();

    expect(await tick(shared.botId)).toMatchObject({ woken: 2 });
    const byUser = new Map(starts.map((start) => [start.userId, start]));
    expect(byUser.get(owner)?.message).toContain("Owner's Job");
    expect(byUser.get(owner)?.message).not.toContain("Member's Job");
    expect(byUser.get(other)?.message).toContain(
      `Member's Job" (id ${theirs.id})`,
    );
  });

  it("reads a page's Jobs in the same number of statements for one delegation or six", async () => {
    const { botId, turnId } = await createBot(owner);
    const counts: number[] = [];
    for (const size of [1, 6]) {
      for (let index = counts.length ? 1 : 0; index < size; index++) {
        const parent = await createTask({ eventId: null });
        const job = await createJob("mainnet", { taskId: parent });
        const delegation = await delegate(turnId, "mainnet", {
          jobId: job.id,
        });
        // Already seen: nothing per delegation follows the page's reads.
        await prisma.sokoBotDelegation.update({
          where: { id: delegation.id },
          data: { lastSeenStatus: "COMPLETED", lastSeenEventId: job.eventId },
        });
      }
      const recorded = recordStatements();
      expect(await tick(botId)).toMatchObject({ scanned: size, woken: 0 });
      recorded.restore();
      counts.push(recorded.texts.length);
    }
    expect(counts[1]).toBe(counts[0]);
  });

  it("never reads a Preprod Job delegation while Preprod is off", async () => {
    const { botId, turnId } = await createBot(owner);
    // Written while Preprod was on; read while it is off.
    flag.on = onSplitLayout;
    const preprodJob = await createJob(onSplitLayout ? "preprod" : "mainnet", {
      name: "Preprod Job",
    });
    flag.on = false;
    const mainnetJob = await createJob("mainnet", { name: "Mainnet Job" });
    const preprod = await delegate(turnId, "preprod", { jobId: preprodJob.id });
    await delegate(turnId, "mainnet", { jobId: mainnetJob.id });
    const before = await row(preprod.id);
    recordStarts();

    expect(await tick(botId)).toMatchObject({ scanned: 1, woken: 1 });
    expect(starts.map((start) => start.network)).toEqual(["mainnet"]);
    expect(starts[0].message).not.toContain("Preprod Job");
    expect(await row(preprod.id)).toEqual(before);
  });

  it("hydrates distinct Jobs per page across several full pages of a bot-scoped scan", async () => {
    const { botId, turnId } = await createBot(owner);
    const agentId = await agentOn("mainnet");
    const total = 1001;
    const jobData = [];
    const eventData = [];
    const delegationData = [];
    for (let index = 0; index < total; index++) {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const jobId = `scoped-job-${String(index + 1).padStart(4, "0")}`;
      const eventId = `scoped-evt-${String(index + 1).padStart(4, "0")}`;
      const pending = index === 0 || index === total - 1;
      jobData.push({
        id: jobId,
        name: `Scoped Job ${index + 1}`,
        workspaceId,
        ownerId: owner,
        agentId,
        agentJobId: `agent-${jobId}`,
        jobType: "FREE" as const,
      });
      eventData.push({
        id: eventId,
        jobId,
        status: pending ? ("COMPLETED" as const) : ("RUNNING" as const),
        createdAt: new Date(LATER.getTime() + index * 1000),
      });
      delegationData.push({
        id,
        turnId,
        toolCallId: `tool-${jobId}`,
        kind: "JOB" as const,
        action: "delegate",
        network: "mainnet",
        jobId,
        lastSeenStatus: "RUNNING",
        lastSeenEventId: pending ? null : eventId,
      });
    }
    const db = createNetworkScope("mainnet").networkDb;
    await db.job.createMany({ data: jobData });
    await db.jobEvent.createMany({ data: eventData });
    await prisma.sokoBotDelegation.createMany({ data: delegationData });
    recordStarts();

    const recorded = recordStatements();
    const result = await tick(botId);
    recorded.restore();

    expect(result).toMatchObject({ scanned: total, woken: 1, failed: 0 });
    const jobBindCounts = recorded.texts.flatMap((sql, index) =>
      sql.includes('FROM "public"."Job"') ||
      sql.includes('FROM "mainnet"."Job"')
        ? [recorded.statements[index].length]
        : [],
    );
    // Prisma binds each page's Job IDs plus its OFFSET parameter (at most 501).
    expect(jobBindCounts).toEqual([501, 501, 2]);
    expect(starts).toHaveLength(1);
    expect(starts[0].eventBatch?.map((item) => item.entityId)).toEqual([
      "scoped-job-0001",
      "scoped-job-1001",
    ]);
  }, 60_000);

  it("keeps empty-string Job and private parent Task IDs matching origin/main", async () => {
    const { botId, turnId } = await createBot(owner);
    const stranger = await createUser();
    await createJob("mainnet", {
      id: "",
      name: "mainnet ",
      status: "FAILED",
      eventId: "empty-job-e",
    });
    const emptyJobDelegation = await delegate(turnId, "mainnet", { jobId: "" });
    await createTask({
      id: "",
      name: "Private empty-id parent",
      visibility: "PRIVATE",
      ownerId: stranger,
      eventId: null,
    });
    await createJob("mainnet", {
      id: "private-parent-edge",
      name: "mainnet private-parent-edge",
      status: "FAILED",
      eventId: "E-private-parent-edge",
      taskId: "",
    });
    const privateParentDelegation = await delegate(turnId, "mainnet", {
      jobId: "private-parent-edge",
    });
    const beforePrivate = await row(privateParentDelegation.id);
    recordStarts();

    expect(await tick(botId)).toMatchObject({
      scanned: 2,
      woken: 1,
      deferred: 0,
      failed: 0,
    });
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      network: "mainnet",
      userId: owner,
      sokoBotId: botId,
      workspaceId,
      clientTurnId:
        "event:4bee746f5d662d0fb710cb4bab5acf671ab447225fbe789113d0f42c03c7aa22",
      source: "EVENT",
      eventBatch: [
        {
          eventId: "empty-job-e",
          entityId: "",
          purpose: "JOB_EVENT",
          status: "FAILED",
          designatedHandlerBotId: botId,
          delegationEventAt: LATER,
          delegationIds: [emptyJobDelegation.id],
        },
      ],
    });
    expect(starts[0].message).toContain(
      '- Job "mainnet " (id ) is now FAILED (was RUNNING).',
    );
    expect(starts[0].message).not.toContain("private-parent-edge");
    expect(await row(privateParentDelegation.id)).toEqual(beforePrivate);
  });
});

describe("the failed-turn lookup of a follow-up retry", () => {
  it("collects the failed turns of the retry's own Network only", async () => {
    const { botId } = await createBot(owner);
    const jobId = "job-on-both";
    const turn = async (network: Network, status: "FAILED" | "RUNNING") =>
      (
        await prisma.sokoBotTurn.create({
          data: {
            ...turnData(botId, owner, randomUUID(), network, GENERATION),
            status,
          },
        })
      ).id;
    const inbox = (
      turnId: string,
      network: Network | null,
      eventId: string,
      entityId = jobId,
      purpose = "JOB_EVENT",
    ) =>
      prisma.sokoBotEventInbox.create({
        data: {
          botId,
          turnId,
          network,
          eventId,
          entityId,
          purpose,
          designatedHandlerBotId: botId,
        },
      });
    const mainnetFailed = await turn("mainnet", "FAILED");
    const legacyFailed = await turn("mainnet", "FAILED");
    const preprodFailed = await turn("preprod", "FAILED");
    const taskFailed = await turn("mainnet", "FAILED");
    await inbox(mainnetFailed, "mainnet", "evt");
    await inbox(legacyFailed, null, "evt-legacy");
    await inbox(preprodFailed, "preprod", "evt");
    await inbox(taskFailed, null, "task-evt", "task-on-both", "TASK_EVENT");
    const retry = async (network: Network) => {
      const id = await turn(network, "RUNNING");
      await inbox(id, network, `evt${FOLLOW_UP_RETRY_SUFFIX}`);
      await inbox(
        id,
        null,
        `task-evt-${network}${FOLLOW_UP_RETRY_SUFFIX}`,
        "task-on-both",
        "TASK_EVENT",
      );
      return id;
    };
    const lookup = async (network: Network) => {
      const id = await retry(network);
      const found = await planTurnIds({
        turn: { id, sokoBotId: botId },
        scope: { network },
      } as Parameters<typeof planTurnIds>[0]);
      return { id, found: found.slice().sort() };
    };

    const preprod = await lookup("preprod");
    expect(preprod.found).toEqual(
      [preprod.id, preprodFailed, taskFailed].sort(),
    );
    const mainnet = await lookup("mainnet");
    expect(mainnet.found).toEqual(
      [mainnet.id, mainnetFailed, legacyFailed, taskFailed].sort(),
    );
  });
});

describe.runIf(onSplitLayout)("Preprod on, three schemas", () => {
  beforeEach(() => {
    flag.on = true;
  });

  it("with the 30-1 guard, leaves Preprod Job delegations out whether Preprod is open, paused or unreadable", async () => {
    const { botId, turnId } = await createBot(owner);
    const preprodJob = await createJob("preprod", { name: "Preprod Job" });
    const preprod = await delegate(turnId, "preprod", { jobId: preprodJob.id });
    const before = await row(preprod.id);
    recordStarts();
    for (const [pause, generation] of [
      ["open", String(GENERATION)],
      ["paused", String(GENERATION)],
      ["open", "not a count"],
    ]) {
      await setControl(pause, generation);
      const mainnetJob = await createJob("mainnet");
      await delegate(turnId, "mainnet", { jobId: mainnetJob.id });
      starts = [];
      expect(await tick(botId)).toMatchObject({ woken: 1, failed: 0 });
      expect(starts.map((start) => start.network)).toEqual(["mainnet"]);
      expect(await row(preprod.id)).toEqual(before);
    }
  });

  describe("with the guard lifted at the pickup", () => {
    beforeEach(async () => {
      liftGuard();
      await setControl("open", String(GENERATION));
    });

    it("wakes one Job id and event id on both Networks twice, each with its own Job, Network and generation; a redelivery wakes none", async () => {
      const { botId, turnId } = await createBot(owner);
      const jobId = randomUUID();
      const eventId = randomUUID();
      await createJob("mainnet", {
        id: jobId,
        eventId,
        name: "Mainnet namesake",
        status: "COMPLETED",
      });
      await createJob("preprod", {
        id: jobId,
        eventId,
        name: "Preprod namesake",
        status: "FAILED",
      });
      await delegate(turnId, "mainnet", { jobId });
      await delegate(turnId, "preprod", { jobId });
      recordStarts();

      expect(await tick(botId)).toMatchObject({ scanned: 2, woken: 2 });
      const byNetwork = new Map(starts.map((start) => [start.network, start]));
      const mainnet = byNetwork.get("mainnet");
      const preprod = byNetwork.get("preprod");
      expect(mainnet && "expectedPreprodGeneration" in mainnet).toBe(false);
      expect(preprod?.expectedPreprodGeneration).toBe(GENERATION);
      expect(mainnet?.message).toContain(
        `Job "Mainnet namesake" (id ${jobId}) is now COMPLETED`,
      );
      expect(preprod?.message).toContain(
        `Job "Preprod namesake" (id ${jobId}) is now FAILED`,
      );
      expect(mainnet?.clientTurnId).not.toBe(preprod?.clientTurnId);
      expect(
        await prisma.sokoBotEventInbox.findMany({
          where: { botId },
          orderBy: { network: "asc" },
          select: { network: true, eventId: true },
        }),
      ).toEqual([
        { network: "mainnet", eventId },
        { network: "preprod", eventId },
      ]);

      starts = [];
      expect(await tick(botId)).toMatchObject({ woken: 0 });
      expect(starts).toEqual([]);
    });

    it("reads a Job's events after the last seen one from the Job's own Network", async () => {
      const { botId, turnId } = await createBot(owner);
      const jobId = randomUUID();
      await createJob("mainnet", { id: jobId, status: "AWAITING_INPUT" });
      await createJob("preprod", { id: jobId, status: "FAILED" });
      for (const network of ["mainnet", "preprod"] as const) {
        const delegation = await delegate(turnId, network, { jobId });
        await prisma.sokoBotDelegation.update({
          where: { id: delegation.id },
          data: {
            lastSeenEventId: randomUUID(),
            lastSeenEventAt: new Date("2099-01-01T00:00:00Z"),
          },
        });
      }
      recordStarts();

      expect(await tick(botId)).toMatchObject({ woken: 2 });
      expect(
        new Map(starts.map((start) => [start.network, start.message])),
      ).toEqual(
        new Map([
          ["mainnet", expect.stringContaining("is now AWAITING_INPUT")],
          ["preprod", expect.stringContaining("is now FAILED")],
        ]),
      );
    });

    it("leaves Preprod Job delegations out while Preprod is paused or unreadable, and of an older generation", async () => {
      const { botId, turnId } = await createBot(owner);
      const older = await delegate(
        turnId,
        "preprod",
        { jobId: (await createJob("preprod")).id },
        GENERATION - 1,
      );
      const current = await delegate(turnId, "preprod", {
        jobId: (await createJob("preprod")).id,
      });
      const before = [await row(older.id), await row(current.id)];
      recordStarts();
      expectCoreLog("error", "Could not read the Preprod pause and generation");
      for (const [pause, generation] of [
        ["paused", String(GENERATION)],
        ["open", "not a count"],
      ]) {
        await setControl(pause, generation);
        expect(await tick(botId)).toMatchObject({ scanned: 0, woken: 0 });
      }
      expect(starts).toEqual([]);
      expect([await row(older.id), await row(current.id)]).toEqual(before);

      await setControl("open", String(GENERATION));
      expect(await tick(botId)).toMatchObject({ scanned: 1, woken: 1 });
      expect(starts.map((start) => start.expectedPreprodGeneration)).toEqual([
        GENERATION,
      ]);
      expect(await row(older.id)).toEqual(before[0]);
    });

    it("finishes the row when the generation is raised before the start, and leaves it when Preprod pauses", async () => {
      const { botId, turnId } = await createBot(owner);
      const job = await createJob("preprod");
      const delegation = await delegate(turnId, "preprod", { jobId: job.id });
      const before = await row(delegation.id);

      // Paused between the pickup and the start: retryable, the row stays.
      recordStarts(
        (input) => input.network === "preprod",
        () => setControl("paused", String(GENERATION)),
      );
      expect(await tick(botId)).toMatchObject({ woken: 0, deferred: 1 });
      expect(await row(delegation.id)).toEqual(before);
      vi.mocked(sokoBotControlPlane.startTurn).mockRestore();

      // The 30-1 guard itself, reached: retryable, the row stays.
      await setControl("open", String(GENERATION));
      recordStarts((input) => input.network === "preprod");
      expect(await tick(botId)).toMatchObject({ woken: 0, deferred: 1 });
      expect(await row(delegation.id)).toEqual(before);
      vi.mocked(sokoBotControlPlane.startTurn).mockRestore();

      // Raised between the pickup and the start: final, the change is spent.
      recordStarts(
        (input) => input.network === "preprod",
        () => raisePreprodGeneration(),
      );
      expect(await tick(botId)).toMatchObject({ woken: 0, failed: 1 });
      expect(await row(delegation.id)).toMatchObject({
        lastSeenStatus: "COMPLETED",
        lastSeenEventId: job.eventId,
        lastSeenEventAt: LATER,
      });
      expect(
        await prisma.sokoBotTurn.count({
          where: { sokoBotId: botId, source: "EVENT", network: "preprod" },
        }),
      ).toBe(0);
      // The raised generation leaves the row out from now on.
      starts = [];
      expect(await tick(botId)).toMatchObject({ scanned: 0 });
      expect(starts).toEqual([]);
    });

    it("keeps a Mainnet 'preprod:'-prefixed Job ID separate from a Preprod Job ID on the same page", async () => {
      const { botId, turnId } = await createBot(owner);
      await createJob("mainnet", {
        id: "preprod:custom",
        name: "mainnet preprod:custom",
        status: "COMPLETED",
        eventId: "main-evt",
      });
      await createJob("preprod", {
        id: "custom",
        name: "preprod custom",
        status: "FAILED",
        eventId: "pre-evt",
      });
      await delegate(turnId, "mainnet", { jobId: "preprod:custom" });
      await delegate(turnId, "preprod", { jobId: "custom" });
      recordStarts();

      expect(await tick(botId)).toMatchObject({ scanned: 2, woken: 2 });
      const byNetwork = new Map(starts.map((start) => [start.network, start]));
      const mainnet = byNetwork.get("mainnet");
      const preprod = byNetwork.get("preprod");
      expect(mainnet?.message).toContain(
        'Job "mainnet preprod:custom" (id preprod:custom) is now COMPLETED',
      );
      expect(mainnet?.eventBatch).toEqual([
        expect.objectContaining({
          entityId: "preprod:custom",
          eventId: "main-evt",
          status: "COMPLETED",
        }),
      ]);
      expect(preprod?.expectedPreprodGeneration).toBe(GENERATION);
      expect(preprod?.message).toContain(
        'Job "preprod custom" (id custom) is now FAILED',
      );
      expect(preprod?.eventBatch).toEqual([
        expect.objectContaining({
          entityId: "custom",
          eventId: "pre-evt",
          status: "FAILED",
        }),
      ]);
      expect(
        await prisma.sokoBotEventInbox.findMany({
          where: { botId },
          orderBy: { network: "asc" },
          select: { network: true, entityId: true, eventId: true },
        }),
      ).toEqual([
        { network: "mainnet", entityId: "preprod:custom", eventId: "main-evt" },
        { network: "preprod", entityId: "custom", eventId: "pre-evt" },
      ]);
    });

    it("stages Preprod consumed-prefix cursor updates until a pending start is admitted", async () => {
      const { botId, turnId } = await createBot(owner);
      const t1 = new Date("2090-01-01T00:00:01Z");
      const t2 = new Date("2090-01-01T00:00:02Z");
      const t3 = new Date("2090-01-01T00:00:03Z");
      const preprodDb = createNetworkScope("preprod").networkDb;

      const timeline = await createJob("preprod", {
        id: "timeline",
        name: "preprod timeline",
        status: "RUNNING",
        eventId: "pp-before",
      });
      await preprodDb.jobEvent.update({
        where: { id: "pp-before" },
        data: { createdAt: t1 },
      });
      await preprodDb.jobEvent.createMany({
        data: [
          {
            id: "pp-consumed",
            jobId: timeline.id,
            status: "AWAITING_INPUT",
            createdAt: t2,
          },
          {
            id: "pp-pending",
            jobId: timeline.id,
            status: "AWAITING_INPUT",
            createdAt: t3,
          },
        ],
      });
      const pendingDelegation = await delegate(turnId, "preprod", {
        jobId: timeline.id,
      });
      await prisma.sokoBotDelegation.update({
        where: { id: pendingDelegation.id },
        data: { lastSeenEventId: "pp-before", lastSeenEventAt: t1 },
      });
      await reserveEventOccurrence(prisma, botId, turnId, "preprod", {
        eventId: "pp-consumed",
        entityId: timeline.id,
        purpose: "JOB_EVENT",
        status: "AWAITING_INPUT",
        designatedHandlerBotId: botId,
      });

      const consumedOnly = await createJob("preprod", {
        id: "consumed-only",
        name: "preprod consumed-only",
        status: "RUNNING",
        eventId: "pp2-before",
      });
      await preprodDb.jobEvent.update({
        where: { id: "pp2-before" },
        data: { createdAt: t1 },
      });
      await preprodDb.jobEvent.create({
        data: {
          id: "pp2-consumed",
          jobId: consumedOnly.id,
          status: "COMPLETED",
          createdAt: t2,
        },
      });
      const consumedOnlyDelegation = await delegate(turnId, "preprod", {
        jobId: consumedOnly.id,
      });
      await prisma.sokoBotDelegation.update({
        where: { id: consumedOnlyDelegation.id },
        data: { lastSeenEventId: "pp2-before", lastSeenEventAt: t1 },
      });
      await reserveEventOccurrence(prisma, botId, turnId, "preprod", {
        eventId: "pp2-consumed",
        entityId: consumedOnly.id,
        purpose: "JOB_EVENT",
        status: "COMPLETED",
        designatedHandlerBotId: botId,
      });

      const beforePending = await row(pendingDelegation.id);
      const beforeConsumedOnly = await row(consumedOnlyDelegation.id);

      // Pause after the proactive gate, before the consumed lookup.
      vi.spyOn(proactive, "proactiveGate").mockImplementationOnce(async () => {
        await setControl("paused", String(GENERATION));
        return { ok: true, usedToday: 0, limit: 20 };
      });
      recordStarts((input) => input.network === "preprod");
      expect(await tick(botId)).toMatchObject({
        scanned: 2,
        woken: 0,
        deferred: 1,
        failed: 0,
      });
      expect(await row(pendingDelegation.id)).toEqual(beforePending);
      expect(await row(consumedOnlyDelegation.id)).toEqual(beforeConsumedOnly);
      vi.mocked(sokoBotControlPlane.startTurn).mockRestore();

      // Pause right before startTurn refuses the pending event.
      await setControl("open", String(GENERATION));
      recordStarts(
        (input) => input.network === "preprod",
        () => setControl("paused", String(GENERATION)),
      );
      expect(await tick(botId)).toMatchObject({
        scanned: 2,
        woken: 0,
        deferred: 1,
        failed: 0,
      });
      expect(await row(pendingDelegation.id)).toEqual(beforePending);
      expect(await row(consumedOnlyDelegation.id)).toEqual(beforeConsumedOnly);
      vi.mocked(sokoBotControlPlane.startTurn).mockRestore();

      // Reopen: the pending event wakes once with the original status and both
      // rows advance to their final cursors without regressing the admitted row.
      await setControl("open", String(GENERATION));
      starts = [];
      recordStarts();
      expect(await tick(botId)).toMatchObject({
        scanned: 2,
        woken: 1,
        deferred: 0,
        failed: 0,
      });
      expect(starts).toHaveLength(1);
      expect(starts[0].message).toContain(
        'Job "preprod timeline" (id timeline) is now AWAITING_INPUT (was RUNNING).',
      );
      expect(starts[0].eventBatch).toEqual([
        expect.objectContaining({
          eventId: "pp-pending",
          entityId: "timeline",
          status: "AWAITING_INPUT",
        }),
      ]);
      expect(await row(pendingDelegation.id)).toMatchObject({
        lastSeenStatus: "AWAITING_INPUT",
        lastSeenEventId: "pp-pending",
        lastSeenEventAt: t3,
      });
      expect(await row(consumedOnlyDelegation.id)).toMatchObject({
        lastSeenStatus: "COMPLETED",
        lastSeenEventId: "pp2-consumed",
        lastSeenEventAt: t2,
      });

      starts = [];
      expect(await tick(botId)).toMatchObject({ woken: 0 });
      expect(starts).toEqual([]);
    });
  });

  it.each([0, 1, 20, 500])(
    "starts every waiting Mainnet wake on the first tick behind %i older Preprod Job delegations",
    async (preprodCount) => {
      await setControl("open", String(GENERATION));
      const cursor = await prisma.syncMetadata.findUniqueOrThrow({
        where: { key: SOKO_EVENTS_SYNC_KEY },
      });
      await prisma.syncMetadata.update({
        where: { key: SOKO_EVENTS_SYNC_KEY },
        data: { cursorId: null },
      });
      cleanUps.push(() =>
        prisma.syncMetadata.update({
          where: { key: SOKO_EVENTS_SYNC_KEY },
          data: { cursorId: cursor.cursorId },
        }),
      );
      // Older: created first, so their ids sort first in the scan.
      // Each bot in its own user's workspace, as the real start requires.
      workspaceId = randomUUID();
      const preprodUser = await createUser(workspaceId);
      const preprodBot = await createBot(preprodUser, preprodUser);
      const preprodJob = await createJob("preprod", { ownerId: preprodUser });
      await prisma.sokoBotDelegation.createMany({
        data: Array.from({ length: preprodCount }, () => ({
          turnId: preprodBot.turnId,
          toolCallId: randomUUID(),
          kind: "JOB" as const,
          action: "delegate",
          network: "preprod",
          preprodGeneration: GENERATION,
          lastSeenStatus: "RUNNING",
          jobId: preprodJob.id,
        })),
      });
      const preprodRows = () =>
        prisma.sokoBotDelegation.findMany({
          where: { turnId: preprodBot.turnId },
          orderBy: { id: "asc" },
        });
      const before = await preprodRows();
      const mainnetBots = new Set<string>();
      for (let index = 0; index < 20; index++) {
        workspaceId = randomUUID();
        const user = await createUser(workspaceId);
        const bot = await createBot(user, user);
        mainnetBots.add(bot.botId);
        await delegate(bot.turnId, "mainnet", {
          jobId: (await createJob("mainnet", { ownerId: user })).id,
        });
      }
      recordStarts((input) => input.network === "preprod");

      const perTick: number[] = [];
      for (let index = 0; index < 4; index++) {
        starts = [];
        await tick();
        perTick.push(
          starts.filter(
            (start) =>
              start.network === "mainnet" &&
              mainnetBots.has(start.sokoBotId ?? ""),
          ).length,
        );
      }
      expect(perTick).toEqual([20, 0, 0, 0]);
      expect(await preprodRows()).toEqual(before);
    },
    120_000,
  );
});
