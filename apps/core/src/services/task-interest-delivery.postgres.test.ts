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
import { followTask, unfollowTask } from "./task-follow.service";
import { syncTaskInterest } from "./task-interest-delivery.service";

// Outbound side effects only: the row, the push, the chat post and the
// model turn. Selection, channel choice and the ledger run against the real
// database.
const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
  postSokoBotOwnerNotice: vi.fn(),
  startTaskSummaryTurn: vi.fn(),
  delegationWakeCovers: vi.fn(),
}));
vi.mock("@/helpers/notifications", () => ({
  createNotification: mocks.createNotification,
}));
vi.mock("@/services/soko-bot-chat.service", () => ({
  postSokoBotOwnerNotice: mocks.postSokoBotOwnerNotice,
}));
vi.mock("@/services/task-interest-summary", () => ({
  startTaskSummaryTurn: mocks.startTaskSummaryTurn,
  delegationWakeCovers: mocks.delegationWakeCovers,
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const users = {
  owner: randomUUID(),
  follower: randomUUID(),
  archivedBotFollower: randomUUID(),
  pausedBotFollower: randomUUID(),
  plain: randomUUID(),
  actor: randomUUID(),
  late: randomUUID(),
  leaver: randomUUID(),
};
const organizationId = randomUUID();
const workspaceId = randomUUID();
const followerBotId = randomUUID();
const archivedBotId = randomUUID();
const pausedBotId = randomUUID();
/** The real clock off a quarter hour: only cases that ask run the overdue sweep. */
function offQuarterHour(): Date {
  const now = new Date();
  return now.getUTCMinutes() % 15 === 0
    ? new Date(now.getTime() + 60_000)
    : now;
}
const tick = (now?: Date) =>
  syncTaskInterest({
    shouldContinue: () => true,
    abortSignal: new AbortController().signal,
    now: now ?? offQuarterHour(),
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

/** A participant, or with `follows` a follower who is not a participant. */
async function addToTask(
  taskId: string,
  userId: string,
  options: { follows?: boolean; joinedAt?: Date } = {},
) {
  const data = {
    taskId,
    userId,
    ...(options.joinedAt ? { createdAt: options.joinedAt } : {}),
  };
  if (options.follows) await prisma.taskFollower.create({ data });
  else await prisma.taskParticipant.create({ data });
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
        {
          id: pausedBotId,
          userId: users.pausedBotFollower,
          workspaceId,
          name: "Resting",
          proactivePaused: true,
        },
      ],
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createNotification.mockResolvedValue({ created: true });
    mocks.postSokoBotOwnerNotice.mockResolvedValue({ messageId: "msg" });
    mocks.startTaskSummaryTurn.mockResolvedValue("started");
    mocks.delegationWakeCovers.mockResolvedValue(false);
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
    await addToTask(task.id, users.owner, { joinedAt: before });
    await addToTask(task.id, users.follower, {
      follows: true,
      joinedAt: before,
    });
    await addToTask(task.id, users.archivedBotFollower, {
      follows: true,
      joinedAt: before,
    });
    await addToTask(task.id, users.plain, { joinedAt: before });
    await addToTask(task.id, users.actor, { joinedAt: before });
    await addToTask(task.id, users.leaver, { joinedAt: before });
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
    await addToTask(task.id, users.late, {
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

  it("rings the bell for a participant whose bot does not follow, and for a follower whose bot is paused", async () => {
    const task = await createTask("Count the stock");
    const before = new Date(Date.now() - 60_000);
    // A live bot alone sends nothing: only a follow does.
    await addToTask(task.id, users.follower, { joinedAt: before });
    await prisma.$transaction((tx) =>
      followTask(tx, task, users.pausedBotFollower),
    );
    await prisma.taskFollower.updateMany({
      where: { taskId: task.id },
      data: { createdAt: before },
    });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.FAILED },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.FAILED },
    });

    await tick();

    expect(botUsers()).toEqual([]);
    expect(bellUsers()).toEqual(
      [users.follower, users.pausedBotFollower].sort(),
    );
  });

  it("counts a person in from their earlier row, joined or followed", async () => {
    const task = await createTask("Pack the boxes");
    const event = new Date(Date.now() - 30_000);
    await addToTask(task.id, users.follower, {
      follows: true,
      joinedAt: new Date(event.getTime() + 60_000),
    });
    await addToTask(task.id, users.follower, {
      joinedAt: new Date(event.getTime() - 60_000),
    });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.CANCELED, createdAt: event },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.CANCELED },
    });

    await tick();

    expect(botUsers()).toEqual([followerBotId]);
  });

  it("tells a participant who also follows once, from the bot", async () => {
    const task = await createTask("Sign the lease");
    const before = new Date(Date.now() - 60_000);
    await addToTask(task.id, users.follower, { joinedAt: before });
    await addToTask(task.id, users.follower, {
      follows: true,
      joinedAt: before,
    });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.CANCELED },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.CANCELED },
    });

    await tick();

    expect(botUsers()).toEqual([followerBotId]);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("follows a Task without adding a participant, and only with a live bot", async () => {
    const task = await createTask("Plan the offsite");
    await prisma.$transaction((tx) => followTask(tx, task, users.follower));
    const again = await prisma.$transaction((tx) =>
      followTask(tx, task, users.follower),
    );
    expect(again).toMatchObject([
      { user: { id: users.follower }, sokoBot: { id: followerBotId } },
    ]);
    expect(
      await prisma.taskParticipant.count({ where: { taskId: task.id } }),
    ).toBe(0);

    await expect(
      prisma.$transaction((tx) => followTask(tx, task, users.plain)),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      prisma.$transaction((tx) =>
        followTask(tx, task, users.archivedBotFollower),
      ),
    ).rejects.toMatchObject({ status: 409 });

    await addToTask(task.id, users.follower);
    expect(
      await prisma.$transaction((tx) => unfollowTask(tx, task, users.follower)),
    ).toEqual([]);
    expect(
      await prisma.taskParticipant.count({ where: { taskId: task.id } }),
    ).toBe(1);
  });

  it("holds a summary the bot cannot start yet and starts it later, even past the lookback window", async () => {
    const task = await createTask("Ship the report");
    await addToTask(task.id, users.follower, {
      follows: true,
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
      await prisma.taskMomentDelivery.findMany({
        where: { taskId: task.id },
        select: { channel: true },
      }),
    ).toEqual([{ channel: "DEFERRED" }]);
    expect(mocks.createNotification).not.toHaveBeenCalled();

    // Not due again yet: a deferred summary does not retry every tick.
    await tick();
    expect(mocks.startTaskSummaryTurn).toHaveBeenCalledTimes(1);

    mocks.startTaskSummaryTurn.mockResolvedValue("started");
    // 49 hours on: the completion is outside the window, the retry is not.
    await tick(new Date(Date.now() + 49 * 60 * 60 * 1_000 + 7 * 60 * 1_000));
    expect(mocks.startTaskSummaryTurn).toHaveBeenCalledTimes(2);
    expect(
      await prisma.taskMomentDelivery.findMany({
        where: { taskId: task.id },
        select: { channel: true, retryAt: true },
      }),
    ).toEqual([{ channel: "SOKO_BOT", retryAt: null }]);
  });

  it("rings the bell when the summary throws, and leaves a busy bot for the next tick", async () => {
    const task = await createTask("Close the books");
    await addToTask(task.id, users.follower, {
      follows: true,
      joinedAt: new Date(Date.now() - 60_000),
    });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.COMPLETED },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.COMPLETED },
    });
    const ledger = () =>
      prisma.taskMomentDelivery.findMany({
        where: { taskId: task.id },
        select: { channel: true },
      });

    mocks.startTaskSummaryTurn.mockResolvedValue("busy");
    expect((await tick()).deferred).toBe(1);
    expect(await ledger()).toEqual([]);

    mocks.startTaskSummaryTurn.mockRejectedValue(new Error("sandbox down"));
    await tick();
    expect(mocks.startTaskSummaryTurn).toHaveBeenCalledTimes(2);
    expect(bellUsers()).toEqual([users.follower]);
    expect(await ledger()).toEqual([{ channel: "BELL" }]);
  });

  it("closes nothing for the others when a participant who was told leaves", async () => {
    const task = await createTask("Book the venue");
    const before = new Date(Date.now() - 60_000);
    await addToTask(task.id, users.follower, {
      follows: true,
      joinedAt: before,
    });
    await addToTask(task.id, users.plain, { joinedAt: before });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.CANCELED },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.CANCELED },
    });
    mocks.postSokoBotOwnerNotice.mockRejectedValue(new Error("chat down"));

    await tick();
    expect(bellUsers()).toEqual([users.plain]);
    await prisma.taskParticipant.deleteMany({
      where: { taskId: task.id, userId: users.plain },
    });

    vi.clearAllMocks();
    mocks.postSokoBotOwnerNotice.mockResolvedValue({ messageId: "msg" });
    await tick();
    expect(botUsers()).toEqual([followerBotId]);
  });

  it("sends nothing for a Task reopened before the tick", async () => {
    const task = await createTask("Reopened report");
    await addToTask(task.id, users.plain, {
      joinedAt: new Date(Date.now() - 60_000),
    });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.COMPLETED },
    });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.RUNNING },
    });

    await tick();

    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(
      await prisma.taskMomentDelivery.findMany({
        where: { taskId: task.id },
        select: { channel: true },
      }),
    ).toEqual([{ channel: "NONE" }]);
  });

  it("falls back to the bell when the bot is gone at post time, and retries a failed send", async () => {
    const task = await createTask("Renew the lease");
    const before = new Date(Date.now() - 60_000);
    await addToTask(task.id, users.follower, {
      follows: true,
      joinedAt: before,
    });
    await addToTask(task.id, users.plain, { joinedAt: before });
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
      await addToTask(task.id, users.plain, { joinedAt: before });
      await prisma.taskDueDateChange.create({
        data: {
          taskId: task.id,
          fromDueOn: new Date("2026-11-20T00:00:00.000Z"),
          toDueOn: new Date("2026-11-30T00:00:00.000Z"),
          actorUserId: users.owner,
        },
      });
    }
    // Moved twice before the tick: only the latest move is news.
    const twice = await createTask("Moved twice", {
      dueOn: new Date("2026-12-10T00:00:00.000Z"),
    });
    await addToTask(twice.id, users.plain, { joinedAt: before });
    const moves: string[] = [];
    for (const [from, to, at] of [
      ["2026-11-20", "2026-11-30", before],
      ["2026-11-30", "2026-12-10", new Date()],
    ] as const) {
      const move = await prisma.taskDueDateChange.create({
        data: {
          taskId: twice.id,
          fromDueOn: new Date(`${from}T00:00:00.000Z`),
          toDueOn: new Date(`${to}T00:00:00.000Z`),
          actorUserId: users.owner,
          createdAt: at,
        },
      });
      moves.push(move.id);
    }

    await tick();

    expect(
      mocks.createNotification.mock.calls
        .map(([input]) => [input.referenceId, input.eventId, input.messageKey])
        .sort(),
    ).toEqual(
      [
        [kept.id, expect.any(String), "Notifications.Task.dueDateMovedLater"],
        [twice.id, moves[1], "Notifications.Task.dueDateMovedLater"],
      ].sort(),
    );
  });

  it("sends overdue at 09:00 in the follower's bot timezone on the first day after the due date", async () => {
    const task = await createTask("Overdue report", {
      dueOn: new Date("2026-11-16T00:00:00.000Z"),
    });
    await addToTask(task.id, users.follower, { follows: true });
    await addToTask(task.id, users.plain);
    await createTask("Already done", {
      dueOn: new Date("2026-11-16T00:00:00.000Z"),
      status: TaskStatus.COMPLETED,
    }).then((done) => addToTask(done.id, users.plain));

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

  it("closes the deferred summary of a follower who unfollowed, so it holds no retry place", async () => {
    const task = await createTask("Draft the brief");
    await addToTask(task.id, users.follower, {
      follows: true,
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
    await tick();
    await prisma.taskFollower.deleteMany({ where: { taskId: task.id } });

    await tick(new Date(Date.now() + 2 * 60 * 60 * 1_000));

    expect(
      await prisma.taskMomentDelivery.findMany({
        where: { taskId: task.id },
        select: { channel: true, retryAt: true },
      }),
    ).toEqual([{ channel: "NONE", retryAt: null }]);
  });

  it("puts a deferred summary that fails on retry back to wait", async () => {
    const task = await createTask("Plan the offsite");
    await addToTask(task.id, users.follower, {
      follows: true,
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
    await tick();
    // The summary turn cannot start and the bell fallback fails too.
    mocks.startTaskSummaryTurn.mockResolvedValue("gone");
    mocks.createNotification.mockRejectedValue(new Error("bell down"));
    const retryTick = new Date(Date.now() + 2 * 60 * 60 * 1_000);

    expect((await tick(retryTick)).failed).toBe(1);

    const [row] = await prisma.taskMomentDelivery.findMany({
      where: { taskId: task.id },
    });
    expect(row?.channel).toBe("DEFERRED");
    expect(row?.retryAt?.getTime()).toBeGreaterThan(retryTick.getTime());
    // Its retry would come due in later ticks of this file.
    await prisma.task.delete({ where: { id: task.id } });
  });

  it("counts an overdue Task only once someone's morning has come, and closes it for a non-member", async () => {
    const task = await createTask("Overdue audit", {
      dueOn: new Date("2026-12-01T00:00:00.000Z"),
    });
    await addToTask(task.id, users.follower, { follows: true });
    await addToTask(task.id, users.leaver);

    // 05:00 UTC: 00:00 in New York, 06:00 in Berlin (the leaver's fallback).
    expect((await tick(new Date("2026-12-02T05:00:00.000Z"))).moments).toBe(0);

    // 08:00 UTC is 09:00 in Berlin: the leaver's morning, but not a member.
    await tick(new Date("2026-12-02T08:00:00.000Z"));
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(
      await prisma.taskMomentDelivery.findMany({
        where: { taskId: task.id },
        select: { userId: true, channel: true },
      }),
    ).toEqual([{ userId: users.leaver, channel: "NONE" }]);
  });

  it("leaves a cancel to the wake of the bot that delegated the Task", async () => {
    const task = await createTask("Order the badges");
    await addToTask(task.id, users.follower, {
      follows: true,
      joinedAt: new Date(Date.now() - 60_000),
    });
    await prisma.taskEvent.create({
      data: { taskId: task.id, status: TaskStatus.CANCELED },
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.CANCELED },
    });
    mocks.delegationWakeCovers.mockResolvedValue(true);

    await tick();

    expect(mocks.delegationWakeCovers).toHaveBeenCalledWith({
      taskId: task.id,
      sokoBotId: followerBotId,
      changedBySokoBotId: null,
    });
    expect(botUsers()).toEqual([]);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(
      await prisma.taskMomentDelivery.findMany({
        where: { taskId: task.id },
        select: { channel: true },
      }),
    ).toEqual([{ channel: "SOKO_BOT" }]);
  });
});
