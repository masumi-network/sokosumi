import { randomUUID } from "node:crypto";
import { Prisma } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lockTaskRows } from "@/helpers/calendar-locks";
import { isPrismaTransactionConflict } from "@/helpers/prisma";
import {
  loadTaskAncestors,
  requireSubtaskParent,
} from "@/helpers/task-subtasks";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const otherUserId = randomUUID();
const workspaceId = randomUUID();

async function createProject(name: string): Promise<string> {
  const project = await prisma.project.create({ data: { workspaceId, name } });
  return project.id;
}

async function createTask(input: {
  projectId: string | null;
  parentTaskId?: string;
  position?: number;
  visibility?: "PUBLIC" | "PRIVATE";
  ownerId?: string;
}): Promise<string> {
  const task = await prisma.task.create({
    data: {
      ownerId: input.ownerId ?? userId,
      creatorUserId: userId,
      workspaceId,
      projectId: input.projectId,
      parentTaskId: input.parentTaskId ?? null,
      position: input.position ?? (input.parentTaskId === undefined ? null : 1),
      visibility: input.visibility ?? "PUBLIC",
      name: "Sub-task fixture",
    },
  });
  return task.id;
}

async function rowOf(taskId: string) {
  return prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { projectId: true, number: true },
  });
}

// Real migration SQL through the migrated schema: the guard and follow
// triggers on "task" (SOKD-279).
describe.skipIf(!enabled)("task sub-tasks against PostgreSQL", () => {
  beforeAll(async () => {
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: "Sub-task fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(id === userId
            ? { workspace: { create: { id: workspaceId } } }
            : {}),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId] } },
    });
    await prisma.$disconnect();
  });

  it("fails a SERIALIZABLE archive whose snapshot predates a new sub-task", async () => {
    const parent = await createTask({ projectId: null });
    const archive = prisma.$transaction(
      async (tx) => {
        // The first read fixes this transaction's snapshot.
        await tx.task.findFirst({ where: { id: parent } });
        await prisma.$transaction(async (add) => {
          await requireSubtaskParent(add, {
            parentTaskId: parent,
            workspaceId,
            ownerId: userId,
          });
          await add.task.create({
            data: {
              ownerId: userId,
              creatorUserId: userId,
              workspaceId,
              parentTaskId: parent,
              position: 1,
              name: "Added during the archive",
            },
          });
        });
        await lockTaskRows(tx, [parent]);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const error = await archive.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isPrismaTransactionConflict(error)).toBe(true);
  });

  it("waits for a status event on the parent instead of deadlocking", async () => {
    const parent = await createTask({ projectId: null });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted = () => {};
    const eventInserted = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const pause = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    // An agent's status event: the event first, then the Task's status.
    const event = prisma.$transaction(
      async (tx) => {
        await tx.taskEvent.create({
          data: { taskId: parent, comment: "Working on it" },
        });
        inserted();
        await held;
        await tx.task.update({
          where: { id: parent },
          data: { status: "RUNNING" },
        });
      },
      { timeout: 10_000 },
    );
    await eventInserted;
    const add = prisma.$transaction(
      (tx) =>
        requireSubtaskParent(tx, {
          parentTaskId: parent,
          workspaceId,
          ownerId: userId,
        }),
      { timeout: 10_000 },
    );
    // Release the event only once the add waits on it, at its lock or write.
    for (let tries = 0; tries < 100; tries += 1) {
      const [waiting] = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT count(*) FROM pg_locks WHERE NOT granted`;
      if (waiting && waiting.count > 0n) break;
      if (tries === 99) throw new Error("The add never waited on the event");
      await pause(50);
    }
    release();

    const settled = await Promise.allSettled([event, add]);
    expect(settled.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
  });

  it("gives a sub-task its own project number and rejects a project that differs from its parent's", async () => {
    const alpha = await createProject("Alpha");
    const beta = await createProject("Beta");
    const parent = await createTask({ projectId: alpha });
    const child = await createTask({ projectId: alpha, parentTaskId: parent });

    expect((await rowOf(child)).number).toBe(2);
    await expect(
      createTask({ projectId: beta, parentTaskId: parent }),
    ).rejects.toThrow(/task_subtask_parent_mismatch/);
    await expect(
      prisma.task.update({ where: { id: child }, data: { projectId: beta } }),
    ).rejects.toThrow(/task_subtask_parent_mismatch/);
  });

  it("keeps a sub-task's parent for life and a position only on sub-tasks", async () => {
    const parent = await createTask({ projectId: null });
    const other = await createTask({ projectId: null });
    const child = await createTask({ projectId: null, parentTaskId: parent });

    await expect(
      prisma.task.update({
        where: { id: child },
        data: { parentTask: { connect: { id: other } } },
      }),
    ).rejects.toThrow(/task_subtask_parent_immutable/);
    await expect(
      prisma.task.update({ where: { id: other }, data: { position: 1 } }),
    ).rejects.toThrow(/task_subtask_position_check/);
  });

  it("allows five levels of sub-tasks and rejects a sixth", async () => {
    let parent = await createTask({ projectId: null });
    for (let level = 1; level <= 5; level += 1) {
      parent = await createTask({ projectId: null, parentTaskId: parent });
    }

    await expect(
      createTask({ projectId: null, parentTaskId: parent }),
    ).rejects.toThrow(/task_subtask_too_deep/);
  });

  it("requires a private parent's sub-task to have the same owner", async () => {
    const parent = await createTask({ projectId: null, visibility: "PRIVATE" });

    await expect(
      createTask({
        projectId: null,
        parentTaskId: parent,
        visibility: "PRIVATE",
        ownerId: otherUserId,
      }),
    ).rejects.toThrow(/task_subtask_private_owner/);
    await expect(
      createTask({
        projectId: null,
        parentTaskId: parent,
        visibility: "PRIVATE",
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it("moves every level of sub-tasks with their root, renumbers them, and keeps their old numbers as aliases", async () => {
    const from = await createProject("From");
    const to = await createProject("To");
    const root = await createTask({ projectId: from });
    const child = await createTask({ projectId: from, parentTaskId: root });
    const grandchild = await createTask({
      projectId: from,
      parentTaskId: child,
    });
    const before = await rowOf(grandchild);

    await prisma.task.update({ where: { id: root }, data: { projectId: to } });

    expect(await rowOf(child)).toEqual({ projectId: to, number: 2 });
    expect(await rowOf(grandchild)).toEqual({ projectId: to, number: 3 });
    const alias = await prisma.taskIdentifierAlias.findUnique({
      where: {
        projectId_number: { projectId: from, number: before.number ?? -1 },
      },
      select: { taskId: true },
    });
    expect(alias?.taskId).toBe(grandchild);
  });

  it("lists a sub-task's ancestors root first, with identifiers", async () => {
    const project = await createProject("Ancestors");
    const root = await createTask({ projectId: project });
    const child = await createTask({ projectId: project, parentTaskId: root });

    const ancestors = await loadTaskAncestors(child, prisma);

    expect(ancestors.map((row) => [row.id, row.identifier])).toEqual([
      [root, expect.stringMatching(/-1$/)],
      [child, expect.stringMatching(/-2$/)],
    ]);
    expect(await loadTaskAncestors(null, prisma)).toEqual([]);
  });

  it("deletes sub-tasks with their parent", async () => {
    const parent = await createTask({ projectId: null });
    const child = await createTask({ projectId: null, parentTaskId: parent });
    await createTask({ projectId: null, parentTaskId: child });

    await prisma.task.delete({ where: { id: parent } });

    expect(
      await prisma.task.count({ where: { id: { in: [parent, child] } } }),
    ).toBe(0);
  });
});
