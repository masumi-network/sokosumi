import { randomUUID } from "node:crypto";
import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import prisma from "@/lib/db/prisma";

import { syncTaskInterest } from "./task-interest-delivery.service";

// Outbound side effects only: the row, the push, the chat post and the
// model turn. Selection, channel choice and the ledger run against the real
// database.
const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
  postSokoBotOwnerNotice: vi.fn(),
  startTaskSummaryTurn: vi.fn(),
}));
vi.mock("@/helpers/notifications", () => ({
  createNotification: mocks.createNotification,
}));
vi.mock("@/services/soko-bot-chat.service", () => ({
  postSokoBotOwnerNotice: mocks.postSokoBotOwnerNotice,
}));
vi.mock("@/services/task-interest-summary", () => ({
  startTaskSummaryTurn: mocks.startTaskSummaryTurn,
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const users = {
  owner: randomUUID(),
  follower: randomUUID(),
  archivedBotFollower: randomUUID(),
  plain: randomUUID(),
  actor: randomUUID(),
  late: randomUUID(),
  leaver: randomUUID(),
};
const organizationId = randomUUID();
const workspaceId = randomUUID();
const followerBotId = randomUUID();
const archivedBotId = randomUUID();
const tick = (now?: Date) =>
  syncTaskInterest({
    shouldContinue: () => true,
    abortSignal: new AbortController().signal,
    now,
  });

const bellUsers = () =>
  mocks.createNotification.mock.calls.map(([input]) => input.userId).sort();
const botUsers = () =>
  mocks.postSokoBotOwnerNotice.mock.calls.map(([input]) => input.sokoBotId);

async function createTask(
  name: string,
  data: { dueOn?: Date; visibility?: TaskVisibility; status?: TaskStatus } = {},
) {
  return prisma.task.create({
    data: {
      name,
      workspaceId,
      organizationId,
      ownerId: users.owner,
      status: data.status ?? TaskStatus.RUNNING,
      visibility: data.visibility ?? TaskVisibility.PUBLIC,
      dueOn: data.dueOn,
    },
  });
}

async function follow(
  taskId: string,
  userId: string,
  options: { subscribed?: boolean; joinedAt?: Date } = {},
) {
  await prisma.taskParticipant.create({
    data: {
      taskId,
      userId,
      subscribedAt: options.subscribed ? new Date() : null,
      ...(options.joinedAt ? { createdAt: options.joinedAt } : {}),
    },
  });
}

describe.skipIf(!enabled)("Task interest delivery", () => {
  beforeAll(async () => {
    for (const id of Object.values(users)) {
      await prisma.user.create({
        data: {
          id,
          name: `Interest ${id.slice(0, 4)}`,
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Acme",
        slug: `acme-${organizationId}`,
        createdAt: new Date(),
        members: {
          create: Object.values(users)
            .filter((id) => id !== users.leaver)
            .map((userId) => ({ userId, role: "member" })),
        },
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.sokoBot.createMany({
      data: [
        {
          id: followerBotId,
          userId: users.follower,
          workspaceId,
          name: "Atlas",
          ingestTimezone: "America/New_York",
        },
        {
          id: archivedBotId,
          userId: users.archivedBotFollower,
          workspaceId,
          name: "Old",
          archivedAt: new Date(),
        },
      ],
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createNotification.mockResolvedValue({ created: true });
    mocks.postSokoBotOwnerNotice.mockResolvedValue({ messageId: "msg" });
    mocks.startTaskSummaryTurn.mockResolvedValue("started");
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.sokoBot.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: Object.values(users) } },
    });
    await prisma.$disconnect();
  });

  it("sends a completed Task once per participant, on the channel each one has now", async () => {
    const task = await createTask("Send the contract");
    const before = new Date(Date.now() - 60_000);
    await follow(task.id, users.owner, { joinedAt: before });
    await follow(task.id, users.follower, {
      subscribed: true,
      joinedAt: before,
    });
    await follow(task.id, users.archivedBotFollower, {
      subscribed: true,
      joinedAt: before,
    });
    await follow(task.id, users.plain, { joinedAt: before });
    await follow(task.id, users.actor, { joinedAt: before });
    await follow(task.id, users.leaver, { joinedAt: before });
    const event = await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        status: TaskStatus.COMPLETED,
        userId: users.actor,
      },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.COMPLETED },
    });
    // Joined after the Task completed: not told about it.
    await follow(task.id, users.late, {
      joinedAt: new Date(Date.now() + 60_000),
    });

    await tick();

    // Completed is the one moment the bot writes up as a summary.
    expect(botUsers()).toEqual([]);
    expect(mocks.startTaskSummaryTurn).toHaveBeenCalledTimes(1);
    expect(mocks.startTaskSummaryTurn.mock.calls[0]?.[0]).toMatchObject({
      userId: users.follower,
      sokoBotId: followerBotId,
      momentKey: `status:${event.id}`,
    });
    // The Owner's row shares the status dispatch's event id, so it is one row.
    expect(bellUsers()).toEqual(
      [users.owner, users.archivedBotFollower, users.plain].sort(),
    );
    for (const [input] of mocks.createNotification.mock.calls) {
      expect(input).toMatchObject({
        eventId: event.id,
        messageKey: "Notifications.Task.completed",
      });
    }
    const ledger = await prisma.taskMomentDelivery.findMany({
      where: { taskId: task.id },
    });
    expect(
      Object.fromEntries(ledger.map((row) => [row.userId, row.channel])),
    ).toEqual({
      [users.owner]: "BELL",
      [users.follower]: "SOKO_BOT",
      [users.archivedBotFollower]: "BELL",
      [users.plain]: "BELL",
      [users.actor]: "NONE",
      [users.leaver]: "NONE",
      [users.late]: "NONE",
    });

    vi.clearAllMocks();
    await tick();
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(mocks.startTaskSummaryTurn).not.toHaveBeenCalled();
  });

  it("holds a summary the bot cannot start yet and starts it on a later tick", async () => {
    const task = await createTask("Ship the report");
    await follow(task.id, users.follower, {
      subscribed: true,
      joinedAt: new Date(Date.now() - 60_000),
    });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.COMPLETED },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.COMPLETED },
    });
    mocks.startTaskSummaryTurn.mockResolvedValue("deferred");

    expect((await tick()).deferred).toBe(1);
    expect(
      await prisma.taskMomentDelivery.count({ where: { taskId: task.id } }),
    ).toBe(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();

    mocks.startTaskSummaryTurn.mockResolvedValue("started");
    await tick();
    expect(mocks.startTaskSummaryTurn).toHaveBeenCalledTimes(2);
    expect(
      await prisma.taskMomentDelivery.findMany({
        where: { taskId: task.id },
        select: { channel: true },
      }),
    ).toEqual([{ channel: "SOKO_BOT" }]);
  });

  it("falls back to the bell when the bot is gone at post time, and retries a failed send", async () => {
    const task = await createTask("Renew the lease");
    const before = new Date(Date.now() - 60_000);
    await follow(task.id, users.follower, {
      subscribed: true,
      joinedAt: before,
    });
    await follow(task.id, users.plain, { joinedAt: before });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.FAILED },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.FAILED },
    });
    mocks.postSokoBotOwnerNotice.mockResolvedValue(null);
    mocks.createNotification.mockImplementation(async (input) => {
      if (input.userId === users.plain) throw new Error("push down");
      return { created: true };
    });

    await tick();

    expect(bellUsers()).toEqual([users.follower, users.plain].sort());
    const afterFirst = await prisma.taskMomentDelivery.findMany({
      where: { taskId: task.id },
    });
    expect(afterFirst.map((row) => [row.userId, row.channel])).toEqual([
      [users.follower, "BELL"],
    ]);

    vi.clearAllMocks();
    mocks.createNotification.mockResolvedValue({ created: true });
    await tick();
    expect(bellUsers()).toEqual([users.plain]);
  });

  it("sends a due date moved later only while the later date stands", async () => {
    const before = new Date(Date.now() - 60_000);
    const kept = await createTask("Kept later", {
      dueOn: new Date("2026-11-30T00:00:00.000Z"),
    });
    const undone = await createTask("Moved back", {
      dueOn: new Date("2026-11-20T00:00:00.000Z"),
    });
    for (const task of [kept, undone]) {
      await follow(task.id, users.plain, { joinedAt: before });
      await prisma.taskDueDateChange.create({
        data: {
          taskId: task.id,
          fromDueOn: new Date("2026-11-20T00:00:00.000Z"),
          toDueOn: new Date("2026-11-30T00:00:00.000Z"),
          actorUserId: users.owner,
        },
      });
    }

    await tick();

    expect(
      mocks.createNotification.mock.calls.map(([input]) => [
        input.referenceId,
        input.messageKey,
      ]),
    ).toEqual([[kept.id, "Notifications.Task.dueDateMovedLater"]]);
  });

  it("sends overdue at 09:00 in the follower's bot timezone on the first day after the due date", async () => {
    const task = await createTask("Overdue report", {
      dueOn: new Date("2026-11-16T00:00:00.000Z"),
    });
    await follow(task.id, users.follower, { subscribed: true });
    await follow(task.id, users.plain);
    await createTask("Already done", {
      dueOn: new Date("2026-11-16T00:00:00.000Z"),
      status: TaskStatus.COMPLETED,
    }).then((done) => follow(done.id, users.plain));

    // 13:45 UTC: 08:45 in New York, 14:45 in Berlin (the fallback).
    await tick(new Date("2026-11-17T13:45:00.000Z"));
    expect(bellUsers()).toEqual([users.plain]);
    expect(botUsers()).toEqual([]);

    vi.clearAllMocks();
    mocks.postSokoBotOwnerNotice.mockResolvedValue({ messageId: "msg" });
    // 14:00 UTC is 09:00 in New York.
    await tick(new Date("2026-11-17T14:00:00.000Z"));
    expect(botUsers()).toEqual([followerBotId]);
    // Pushes like a Direct the follower never turned off.
    expect(mocks.postSokoBotOwnerNotice.mock.calls[0]?.[0]).toMatchObject({
      osBannerDefaultOn: true,
    });
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });
});
