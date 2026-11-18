import { randomUUID } from "node:crypto";
import { Prisma, TaskStatus } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lockTaskRows } from "@/helpers/calendar-locks";
import { isPrismaTransactionConflict } from "@/helpers/prisma";
import { type MoveTaskInput, moveTask } from "@/helpers/task-subtask-move";
import { subtaskPositionAfter } from "@/helpers/task-subtasks";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { createTaskForActor, updateTaskForActor } from "./task-domain.service";
import { archiveTaskRecord, restoreTaskRecord } from "./task-domain-archive";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const workspaceId = randomUUID();
const actor = { kind: "user" as const, userId };
const userContext = {
  source: "context" as const,
  userId,
  organizationId: null,
};

function create(
  name: string,
  extra: {
    parent?: { taskId: string; afterTaskId?: string | null };
    projectId?: string | null;
  } = {},
) {
  return prisma.$transaction((tx) =>
    createTaskForActor(
      {
        actor,
        ownerId: userId,
        organizationId: null,
        workspaceId,
        name,
        status: TaskStatus.DRAFT,
        ...extra,
      },
      tx,
    ),
  );
}

async function childNames(parentTaskId: string): Promise<string[]> {
  const rows = await prisma.task.findMany({
    where: { parentTaskId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { name: true },
  });
  return rows.map((row) => row.name);
}

async function moveAfter(taskId: string, afterTaskId: string | null) {
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    const position = await subtaskPositionAfter(tx, {
      parentTaskId: task.parentTaskId ?? "",
      taskId,
      afterTaskId,
    });
    await tx.task.update({ where: { id: taskId }, data: { position } });
  });
}

function move(input: MoveTaskInput) {
  return serializableTransaction(
    (tx) => moveTask(tx, userContext, input),
    "Task changed while moving it",
  );
}

async function placement(taskId: string) {
  return prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      parentTaskId: true,
      position: true,
      projectId: true,
      number: true,
    },
  });
}

// Real Prisma, triggers and migrations (SOKD-279).
describe.skipIf(!enabled)("sub-task lifecycle against PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Sub-task lifecycle fixture",
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
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates sub-tasks last by default, or right after afterTaskId, in the parent's project", async () => {
    const project = await prisma.project.create({
      data: { workspaceId, name: "Lifecycle" },
    });
    const parent = await create("Parent", { projectId: project.id });
    const a = await create("A", { parent: { taskId: parent.id } });
    await create("C", { parent: { taskId: parent.id } });
    const b = await create("B", {
      parent: { taskId: parent.id, afterTaskId: a.id },
    });

    expect(await childNames(parent.id)).toEqual(["A", "B", "C"]);
    expect(b.projectId).toBe(project.id);
    await expect(
      create("Elsewhere", { parent: { taskId: parent.id }, projectId: null }),
    ).rejects.toThrow("A sub-task stays in its parent's project");
  });

  it("refuses a sub-task's Project change that comes with other fields", async () => {
    const project = await prisma.project.create({
      data: { workspaceId, name: "Edit with move" },
    });
    const parent = await create("Edit parent", { projectId: project.id });
    const child = await create("Edit child", {
      parent: { taskId: parent.id },
    });

    await expect(
      prisma.$transaction((tx) =>
        updateTaskForActor(
          {
            actor,
            userId,
            workspaceId,
            taskId: child.id,
            intent: "metadata",
            name: "Renamed",
            projectId: null,
          },
          tx,
        ),
      ),
    ).rejects.toThrow("A sub-task stays in its parent's project");
  });

  it("rejects a sixth level of sub-tasks before the database does", async () => {
    let parent = await create("Level 0");
    for (let level = 1; level <= 5; level += 1) {
      parent = await create(`Level ${level}`, {
        parent: { taskId: parent.id },
      });
    }

    await expect(
      create("Level 6", { parent: { taskId: parent.id } }),
    ).rejects.toThrow("Sub-tasks nest at most 5 levels deep");
  });

  it("moves a sub-task first, between siblings, and last, and respreads exhausted positions", async () => {
    const parent = await create("Order");
    const a = await create("A", { parent: { taskId: parent.id } });
    const b = await create("B", { parent: { taskId: parent.id } });
    const c = await create("C", { parent: { taskId: parent.id } });

    await moveAfter(c.id, null);
    expect(await childNames(parent.id)).toEqual(["C", "A", "B"]);
    await moveAfter(c.id, a.id);
    expect(await childNames(parent.id)).toEqual(["A", "C", "B"]);
    await moveAfter(a.id, b.id);
    expect(await childNames(parent.id)).toEqual(["C", "B", "A"]);

    // Neighbours with no float between them force a renumber.
    await prisma.task.updateMany({
      where: { parentTaskId: parent.id },
      data: { position: 1 },
    });
    await moveAfter(a.id, c.id);
    const order = await childNames(parent.id);
    expect(order.indexOf("A")).toBe(order.indexOf("C") + 1);
  });

  it("archives sub-tasks with their Task and restores only those archived with it", async () => {
    const parent = await create("Archive me");
    const child = await create("Child", { parent: { taskId: parent.id } });
    const grandchild = await create("Grandchild", {
      parent: { taskId: child.id },
    });
    const earlier = await create("Archived earlier", {
      parent: { taskId: parent.id },
    });
    await prisma.task.update({
      where: { id: earlier.id },
      data: { archivedAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    await prisma.$transaction((tx) => archiveTaskRecord(tx, parent));
    const archived = await prisma.task.findMany({
      where: { id: { in: [parent.id, child.id, grandchild.id] } },
      select: { archivedAt: true },
    });
    expect(new Set(archived.map((row) => row.archivedAt?.getTime())).size).toBe(
      1,
    );

    await expect(
      prisma.$transaction(async (tx) =>
        restoreTaskRecord(
          tx,
          await tx.task.findUniqueOrThrow({ where: { id: child.id } }),
          actor,
        ),
      ),
    ).rejects.toThrow("Restore the Task this sub-task belongs to first");

    await prisma.$transaction(async (tx) =>
      restoreTaskRecord(
        tx,
        await tx.task.findUniqueOrThrow({ where: { id: parent.id } }),
        actor,
      ),
    );
    const restored = await prisma.task.findMany({
      where: {
        parentTaskId: { not: null },
        id: { in: [child.id, grandchild.id, earlier.id] },
      },
      select: { name: true, archivedAt: true },
      orderBy: { name: "asc" },
    });
    expect(restored.map((row) => [row.name, row.archivedAt === null])).toEqual([
      ["Archived earlier", false],
      ["Child", true],
      ["Grandchild", true],
    ]);
  });

  it("refuses to archive a Task while one of its sub-tasks is running", async () => {
    const parent = await create("Busy parent");
    const child = await create("Running child", {
      parent: { taskId: parent.id },
    });
    await prisma.task.update({
      where: { id: child.id },
      data: { status: TaskStatus.RUNNING },
    });

    await expect(
      prisma.$transaction((tx) => archiveTaskRecord(tx, parent)),
    ).rejects.toThrow("A sub-task is running");
    const after = await prisma.task.findUniqueOrThrow({
      where: { id: parent.id },
      select: { archivedAt: true },
    });
    expect(after.archivedAt).toBeNull();
  });

  it("refuses a Soko Bot archive that would drop a sub-task's future run", async () => {
    const parent = await create("Bot parent");
    const child = await create("Queued child", {
      parent: { taskId: parent.id },
    });
    await prisma.task.update({
      where: { id: child.id },
      data: {
        status: TaskStatus.QUEUED,
        runAt: new Date(Date.now() + 86_400_000),
      },
    });

    await expect(
      prisma.$transaction((tx) =>
        archiveTaskRecord(tx, parent, {
          actor: { kind: "soko_bot", sokoBotId: randomUUID() },
        }),
      ),
    ).rejects.toThrow("A sub-task has a future Run at");
  });

  it("makes a sub-task restore wait for its parent's archive", async () => {
    const parent = await create("Racing parent");
    const child = await create("Racing child", {
      parent: { taskId: parent.id },
    });
    await prisma.task.update({
      where: { id: child.id },
      data: { archivedAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    let restore: Promise<unknown> = Promise.resolve();
    await prisma.$transaction(async (tx) => {
      await archiveTaskRecord(tx, parent);
      restore = prisma
        .$transaction(async (other) =>
          restoreTaskRecord(
            other,
            await other.task.findUniqueOrThrow({ where: { id: child.id } }),
            actor,
          ),
        )
        .catch((error: unknown) => error);
      // Long enough for the restore to reach its parent check.
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(String(await restore)).toContain(
      "Restore the Task this sub-task belongs to first",
    );
  });

  it("fails a SERIALIZABLE archive whose snapshot predates a sub-task restore", async () => {
    const parent = await create("Serial parent");
    const child = await create("Serial child", {
      parent: { taskId: parent.id },
    });
    await prisma.task.update({
      where: { id: child.id },
      data: { archivedAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    const archive = prisma.$transaction(
      async (tx) => {
        // The first read fixes this transaction's snapshot.
        await tx.task.findFirst({ where: { id: parent.id } });
        await prisma.$transaction(async (other) =>
          restoreTaskRecord(
            other,
            await other.task.findUniqueOrThrow({ where: { id: child.id } }),
            actor,
          ),
        );
        await lockTaskRows(tx, [parent.id]);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const error = await archive.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isPrismaTransactionConflict(error)).toBe(true);
  });

  it("attaches a Task last, moves it with its sub-tasks to another parent's Project, and detaches it", async () => {
    const [home, away] = await Promise.all([
      prisma.project.create({ data: { workspaceId, name: "Home" } }),
      prisma.project.create({ data: { workspaceId, name: "Away" } }),
    ]);
    const parent = await create("Away parent", { projectId: away.id });
    const sibling = await create("Away sibling", {
      parent: { taskId: parent.id },
    });
    const task = await create("Moving", { projectId: home.id });
    const step = await create("Moving step", { parent: { taskId: task.id } });
    const homeNumber = (await placement(step.id)).number;

    const attached = await move({ taskId: task.id, parentTaskId: parent.id });

    expect(attached.projectChanged).toBe(true);
    expect(await childNames(parent.id)).toEqual(["Away sibling", "Moving"]);
    // Numbers 1 and 2 belong to the parent and its first sub-task.
    expect(await placement(task.id)).toMatchObject({
      projectId: away.id,
      number: 3,
    });
    expect(await placement(step.id)).toMatchObject({
      parentTaskId: task.id,
      projectId: away.id,
      number: 4,
    });
    const alias = await prisma.taskIdentifierAlias.findUnique({
      where: {
        projectId_number: { projectId: home.id, number: homeNumber ?? -1 },
      },
      select: { taskId: true },
    });
    expect(alias?.taskId).toBe(step.id);

    const reparented = await move({
      taskId: task.id,
      parentTaskId: sibling.id,
    });
    expect(reparented.projectChanged).toBe(false);
    expect(await childNames(sibling.id)).toEqual(["Moving"]);
    expect(await childNames(parent.id)).toEqual(["Away sibling"]);

    await move({ taskId: task.id, parentTaskId: null });
    expect(await placement(task.id)).toMatchObject({
      parentTaskId: null,
      position: null,
      projectId: away.id,
    });
    expect((await placement(step.id)).parentTaskId).toBe(task.id);
  });

  it("refuses a move under itself, under its own sub-task, too deep, or across visibility", async () => {
    const task = await create("Refused");
    const step = await create("Refused step", { parent: { taskId: task.id } });
    const chain = [await create("Deep 0")];
    for (let level = 1; level <= 4; level += 1) {
      chain.push(
        await create(`Deep ${level}`, {
          parent: { taskId: chain[level - 1].id },
        }),
      );
    }
    const hidden = await create("Hidden");
    await prisma.task.update({
      where: { id: hidden.id },
      data: { visibility: "PRIVATE" },
    });

    await expect(
      move({ taskId: task.id, parentTaskId: task.id }),
    ).rejects.toThrow("A Task cannot be its own sub-task");
    await expect(
      move({ taskId: task.id, parentTaskId: step.id }),
    ).rejects.toThrow("A Task cannot go under one of its own sub-tasks");
    // Level 5 under Deep 4, plus one level of sub-tasks below it.
    await expect(
      move({ taskId: task.id, parentTaskId: chain[4].id }),
    ).rejects.toThrow("Sub-tasks nest at most 5 levels deep");
    await expect(
      move({ taskId: task.id, parentTaskId: hidden.id }),
    ).rejects.toThrow("A sub-task has its parent's visibility");
    expect((await placement(task.id)).parentTaskId).toBeNull();
  });

  it("refuses an archived parent and archives an attached Task with its new parent", async () => {
    const archivedParent = await create("Archived parent");
    await prisma.task.update({
      where: { id: archivedParent.id },
      data: { archivedAt: new Date() },
    });
    const parent = await create("Live parent");
    const task = await create("Attached");

    await expect(
      move({ taskId: task.id, parentTaskId: archivedParent.id }),
    ).rejects.toThrow("Task not found");
    await move({ taskId: task.id, parentTaskId: parent.id });
    await prisma.$transaction((tx) => archiveTaskRecord(tx, parent));

    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
        .archivedAt,
    ).not.toBeNull();
  });

  it("fails a SERIALIZABLE archive whose snapshot predates an attach", async () => {
    const parent = await create("Attach target");
    const task = await create("Attached meanwhile");

    const archive = prisma.$transaction(
      async (tx) => {
        // The first read fixes this transaction's snapshot.
        await tx.task.findFirst({ where: { id: parent.id } });
        await move({ taskId: task.id, parentTaskId: parent.id });
        await lockTaskRows(tx, [parent.id]);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const error = await archive.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isPrismaTransactionConflict(error)).toBe(true);
  });
});
