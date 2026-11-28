/**
 * The Job event wake loads each scanned page's Jobs from the Mainnet client
 * and parent Tasks from the shared client (ticket 24, slice 6), leaves Preprod
 * Job delegations out of the scan while fresh Preprod turns are deferred
 * (slice 30-3 builds the admitted Preprod wake), and scopes the failed-turn
 * lookup of a follow-up retry by Network.
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
    eventAt?: Date;
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
          createdAt: options.eventAt ?? LATER,
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
    eventAt?: Date;
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
        createdAt: options.eventAt ?? LATER,
      },
    });
  return task.id;
}

function delegate(
  turnId: string,
  network: Network | null,
  work:
    | { jobId: string }
    | { taskId: string }
    | { taskId: string; jobId: string },
  generation: number | null = network === "preprod" ? GENERATION : null,
) {
  return prisma.sokoBotDelegation.create({
    data: {
      turnId,
      toolCallId: randomUUID(),
      kind: "taskId" in work ? "TASK" : "JOB",
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
 * inbox rows in one transaction. `before` can inject a failure or side effect.
 */
function recordStarts(
  before?: (input: StartSokoBotTurnInput) => Promise<unknown>,
) {
  vi.spyOn(sokoBotControlPlane, "startTurn").mockImplementation(
    async (input) => {
      starts.push(structuredClone(input));
      await before?.(input);
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

  it("enforces Mainnet Job ownership and parent visibility on dual-linked Task+Job rows", async () => {
    const { botId, turnId } = await createBot(owner);
    const stranger = await createUser();
    const accessibleTask = await createTask({
      id: "dual-shared-task",
      name: "Shared dual Task",
      eventId: "T-dual-shared-task",
    });
    const otherOwnersJob = await createJob("mainnet", {
      id: "dual-other-owners-job",
      name: "Other owner's Job",
      ownerId: stranger,
    });
    const privateParent = await createTask({
      name: "Private dual parent",
      visibility: "PRIVATE",
      ownerId: stranger,
      eventId: null,
    });
    const hiddenParentJob = await createJob("mainnet", {
      name: "Job behind hidden parent",
      ownerId: owner,
      taskId: privateParent,
    });

    const foreignDual = await delegate(
      turnId,
      "preprod",
      { taskId: accessibleTask, jobId: otherOwnersJob.id },
      null,
    );
    const hiddenDual = await delegate(
      turnId,
      "preprod",
      { taskId: accessibleTask, jobId: hiddenParentJob.id },
      null,
    );
    const beforeForeign = await row(foreignDual.id);
    const beforeHidden = await row(hiddenDual.id);
    recordStarts();

    // Negative controls: both dual-linked rows are suppressed even with Preprod off.
    expect(await tick(botId)).toMatchObject({ scanned: 2, woken: 0 });
    expect(await tick(botId)).toMatchObject({ scanned: 2, woken: 0 });
    expect(starts).toEqual([]);
    expect(await row(foreignDual.id)).toEqual(beforeForeign);
    expect(await row(hiddenDual.id)).toEqual(beforeHidden);

    // Positive control: an owner-matching Job on a dual-linked row wakes once.
    const ownJob = await createJob("mainnet", {
      name: "Owner-matching dual Job",
      ownerId: owner,
    });
    const ownDual = await delegate(
      turnId,
      "preprod",
      { taskId: accessibleTask, jobId: ownJob.id },
      null,
    );
    expect(await tick(botId)).toMatchObject({ scanned: 3, woken: 1 });
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      network: "mainnet",
      eventBatch: [
        expect.objectContaining({
          entityId: accessibleTask,
          eventId: "T-dual-shared-task",
          purpose: "TASK_EVENT",
          delegationIds: [ownDual.id],
        }),
      ],
    });
    expect(await tick(botId)).toMatchObject({ scanned: 3, woken: 0 });
    expect(await row(foreignDual.id)).toEqual(beforeForeign);
    expect(await row(hiddenDual.id)).toEqual(beforeHidden);
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

  it("reads later Mainnet Job events and commits consumed prefixes before a failed start", async () => {
    const { botId, turnId } = await createBot(owner);
    const t1 = new Date("2090-01-01T00:00:01Z");
    const t2 = new Date("2090-01-01T00:00:02Z");
    const t3 = new Date("2090-01-01T00:00:03Z");
    const mainnetDb = createNetworkScope("mainnet").networkDb;

    const job = await createJob("mainnet", {
      name: "Cursor Job",
      status: "RUNNING",
      eventId: "main-before",
      eventAt: t1,
    });
    await mainnetDb.jobEvent.createMany({
      data: [
        {
          id: "main-consumed",
          jobId: job.id,
          status: "AWAITING_INPUT",
          createdAt: t2,
        },
        {
          id: "main-pending",
          jobId: job.id,
          status: "FAILED",
          createdAt: t3,
        },
      ],
    });
    const delegation = await delegate(turnId, "mainnet", { jobId: job.id });
    await prisma.sokoBotDelegation.update({
      where: { id: delegation.id },
      data: { lastSeenEventId: "main-before", lastSeenEventAt: t1 },
    });
    await reserveEventOccurrence(prisma, botId, turnId, "mainnet", {
      eventId: "main-consumed",
      entityId: job.id,
      purpose: "JOB_EVENT",
      status: "AWAITING_INPUT",
      designatedHandlerBotId: botId,
    });

    expectCoreLog(
      "error",
      "Could not wake a Soko Bot for changes in its delegated work",
      1,
    );
    let failOnce = true;
    recordStarts(async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error("Injected Mainnet start failure");
      }
    });

    // Tick 1: Mainnet commits consumedPrefix before startTurn, even when startTurn throws.
    expect(await tick(botId)).toMatchObject({
      scanned: 1,
      woken: 0,
      failed: 1,
    });
    expect(await row(delegation.id)).toMatchObject({
      lastSeenStatus: "AWAITING_INPUT",
      lastSeenEventId: "main-consumed",
      lastSeenEventAt: t2,
    });

    // Tick 2: pending event wakes once; tick 3 wakes none.
    expect(await tick(botId)).toMatchObject({
      scanned: 1,
      woken: 1,
      failed: 0,
    });
    expect(starts.at(-1)?.eventBatch).toEqual([
      expect.objectContaining({
        eventId: "main-pending",
        entityId: job.id,
        status: "FAILED",
      }),
    ]);
    expect(await row(delegation.id)).toMatchObject({
      lastSeenStatus: "FAILED",
      lastSeenEventId: "main-pending",
      lastSeenEventAt: t3,
    });
    expect(await tick(botId)).toMatchObject({ scanned: 1, woken: 0 });
  });

  it("skips a Job deleted between the delegation page read and hydration", async () => {
    const { botId, turnId } = await createBot(owner);
    const doomed = await createJob("mainnet", { name: "Deleted mid-tick" });
    const survivor = await createJob("mainnet", { name: "Surviving Job" });
    await delegate(turnId, "mainnet", { jobId: doomed.id });
    await delegate(turnId, "mainnet", { jobId: survivor.id });
    recordStarts();

    const realFindMany = prisma.sokoBotDelegation.findMany.bind(
      prisma.sokoBotDelegation,
    );
    let deleted = false;
    const scanSpy = vi
      .spyOn(prisma.sokoBotDelegation, "findMany")
      .mockImplementation((async (
        args?: Parameters<typeof realFindMany>[0],
      ) => {
        const page = await realFindMany(args);
        if (!deleted) {
          deleted = true;
          await createNetworkScope("mainnet").networkDb.job.delete({
            where: { id: doomed.id },
          });
        }
        return page;
      }) as typeof prisma.sokoBotDelegation.findMany);

    expect(await tick(botId)).toMatchObject({
      scanned: 2,
      woken: 1,
      failed: 0,
    });
    scanSpy.mockRestore();
    expect(starts).toHaveLength(1);
    expect(starts[0].eventBatch?.map((item) => item.entityId)).toEqual([
      survivor.id,
    ]);
    expect(await tick(botId)).toMatchObject({ scanned: 1, woken: 0 });
  });

  it("never selects, loads, writes, or starts a Preprod Job delegation while Preprod is off", async () => {
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
    expect(await tick(botId)).toMatchObject({ scanned: 1, woken: 0 });
    expect(starts.map((start) => start.network)).toEqual(["mainnet"]);
    expect(starts[0].message).not.toContain("Preprod Job");
    expect(await row(preprod.id)).toEqual(before);
  });

  it("keeps a Mainnet 'preprod:'-prefixed Job ID separate without colliding with an excluded Preprod Job", async () => {
    const { botId, turnId } = await createBot(owner);
    await createJob("mainnet", {
      id: "preprod:custom",
      name: "mainnet preprod:custom",
      status: "COMPLETED",
      eventId: "main-evt",
    });
    flag.on = onSplitLayout;
    await createJob(onSplitLayout ? "preprod" : "mainnet", {
      id: "custom",
      name: "preprod custom",
      status: "FAILED",
      eventId: "pre-evt",
    });
    flag.on = false;
    await delegate(turnId, "mainnet", { jobId: "preprod:custom" });
    const preprodRow = await delegate(turnId, "preprod", { jobId: "custom" });
    const beforePreprod = await row(preprodRow.id);
    recordStarts();

    expect(await tick(botId)).toMatchObject({ scanned: 1, woken: 1 });
    expect(starts).toHaveLength(1);
    expect(starts[0].network).toBe("mainnet");
    expect(starts[0].eventBatch).toEqual([
      expect.objectContaining({
        entityId: "preprod:custom",
        eventId: "main-evt",
        status: "COMPLETED",
      }),
    ]);
    expect(await row(preprodRow.id)).toEqual(beforePreprod);
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

describe.runIf(onSplitLayout)("Preprod exclusion on split layout", () => {
  beforeEach(() => {
    flag.on = true;
  });

  it("never selects, loads, writes, or starts Preprod Job delegations over several ticks, across pause and generation changes", async () => {
    const { botId, turnId } = await createBot(owner);
    const preprodJob = await createJob("preprod", { name: "Preprod Job" });
    const preprod = await delegate(turnId, "preprod", { jobId: preprodJob.id });
    const before = await row(preprod.id);
    recordStarts();

    const transitions: (() => Promise<unknown>)[] = [
      () => setControl("open", String(GENERATION)),
      () => setControl("paused", String(GENERATION)),
      () => setControl("open", "not a count"),
      async () => {
        await setControl("open", String(GENERATION));
        await raisePreprodGeneration();
      },
    ];
    for (const [index, transition] of transitions.entries()) {
      await transition();
      const mainnetJob = await createJob("mainnet", {
        name: `Mainnet Job ${index}`,
      });
      await delegate(turnId, "mainnet", { jobId: mainnetJob.id });
      starts = [];
      const recorded = recordStatements();
      expect(await tick(botId)).toMatchObject({
        scanned: index + 1,
        woken: 1,
        failed: 0,
      });
      recorded.restore();
      expect(
        recorded.texts.some(
          (sql) =>
            sql.includes('"preprod"."Job"') ||
            sql.includes('"preprod"."jobEvent"'),
        ),
      ).toBe(false);
      expect(starts.map((start) => start.network)).toEqual(["mainnet"]);
      expect(await row(preprod.id)).toEqual(before);
    }
  });

  it.each([0, 1, 200])(
    "starts all 20 waiting Mainnet wakes on a saturated 500-row page behind %i older Preprod Job delegations",
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
      // Older Preprod rows sort first by UUID when created with low prefix.
      workspaceId = randomUUID();
      const preprodUser = await createUser(workspaceId);
      const preprodBot = await createBot(preprodUser, preprodUser);
      const preprodJob = await createJob("preprod", { ownerId: preprodUser });
      await prisma.sokoBotDelegation.createMany({
        data: Array.from({ length: preprodCount }, (_, index) => ({
          id: `00000000-0000-4000-8000-0000000${String(index + 1).padStart(5, "0")}`,
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
          where: { turnId: preprodBot.turnId, network: "preprod" },
          orderBy: { id: "asc" },
        });
      const before = await preprodRows();

      // Fill the 500-row page with 480 already-seen Mainnet rows + 20 ready Mainnet bots.
      const seenJob = await createJob("mainnet", {
        ownerId: preprodUser,
        status: "RUNNING",
      });
      await prisma.sokoBotDelegation.createMany({
        data: Array.from({ length: 480 }, (_, index) => ({
          id: `00000000-0000-4000-8000-0000010${String(index + 1).padStart(5, "0")}`,
          turnId: preprodBot.turnId,
          toolCallId: randomUUID(),
          kind: "JOB" as const,
          action: "delegate",
          network: "mainnet",
          lastSeenStatus: "RUNNING",
          lastSeenEventId: seenJob.eventId,
          jobId: seenJob.id,
        })),
      });
      const mainnetBots = new Set<string>();
      for (let index = 0; index < 20; index++) {
        workspaceId = randomUUID();
        const user = await createUser(workspaceId);
        const bot = await createBot(user, user);
        mainnetBots.add(bot.botId);
        const job = await createJob("mainnet", { ownerId: user });
        await prisma.sokoBotDelegation.create({
          data: {
            id: `00000000-0000-4000-8000-0000020${String(index + 1).padStart(5, "0")}`,
            turnId: bot.turnId,
            toolCallId: randomUUID(),
            kind: "JOB",
            action: "delegate",
            network: "mainnet",
            lastSeenStatus: "RUNNING",
            jobId: job.id,
          },
        });
      }
      recordStarts();

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
