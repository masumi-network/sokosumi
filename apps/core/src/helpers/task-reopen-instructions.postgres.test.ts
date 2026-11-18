import { randomUUID } from "node:crypto";
import { TaskStatus } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { taskReopenedWithoutInstructions } from "@/helpers/task-reopen-instructions";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const workspaceId = randomUUID();

async function taskWithEvents(
  events: Array<{ status?: TaskStatus; comment?: string; byUser?: boolean }>,
): Promise<string> {
  const task = await prisma.task.create({
    data: {
      name: "Reopen fixture",
      workspaceId,
      ownerId: userId,
      creatorUserId: userId,
      status: TaskStatus.READY,
    },
  });
  // Spaced timestamps: the order of events is what the helper reads.
  let at = Date.parse("2026-11-01T00:00:00.000Z");
  for (const event of events) {
    at += 1000;
    await prisma.taskEvent.create({
      data: {
        taskId: task.id,
        status: event.status ?? null,
        comment: event.comment ?? null,
        userId: event.byUser === false ? null : userId,
        createdAt: new Date(at),
      },
    });
  }
  return task.id;
}

const reopened = (taskId: string) =>
  prisma.$transaction((tx) => taskReopenedWithoutInstructions(tx, taskId));

// Real event history: which reopened Tasks would hand an agent no
// instructions (SOKD-279).
describe.skipIf(!enabled)("taskReopenedWithoutInstructions", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Reopen fixture",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("is true after a silent reopen of a completed or canceled Task", async () => {
    for (const finished of [TaskStatus.COMPLETED, TaskStatus.CANCELED]) {
      const taskId = await taskWithEvents([
        { status: finished },
        { status: TaskStatus.READY },
      ]);
      expect(await reopened(taskId)).toBe(true);
    }
  });

  it("is false once a person comments after the latest finish", async () => {
    const taskId = await taskWithEvents([
      { status: TaskStatus.COMPLETED },
      { status: TaskStatus.READY, comment: "Fix the intro" },
    ]);
    expect(await reopened(taskId)).toBe(false);
  });

  it("ignores comments before the latest finish, empty ones, and Core's own", async () => {
    const taskId = await taskWithEvents([
      { status: TaskStatus.COMPLETED },
      { status: TaskStatus.READY, comment: "Fix the intro" },
      { status: TaskStatus.COMPLETED },
      { status: TaskStatus.READY, comment: "" },
      { comment: "Reopened without instructions.", byUser: false },
    ]);
    expect(await reopened(taskId)).toBe(true);
  });

  it("is false for a Task that never finished", async () => {
    const taskId = await taskWithEvents([{ status: TaskStatus.READY }]);
    expect(await reopened(taskId)).toBe(false);
  });
});
