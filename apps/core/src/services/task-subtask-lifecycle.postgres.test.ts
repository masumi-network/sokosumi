import { randomUUID } from "node:crypto";
import { TaskLinkType, TaskStatus } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  requireNoSubtaskInParentLink,
  subtaskPositionAfter,
} from "@/helpers/task-subtasks";
import prisma from "@/lib/db/prisma";
import { createTaskForActor } from "./task-domain.service";
import { archiveTaskRecord, restoreTaskRecord } from "./task-domain-archive";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const workspaceId = randomUUID();
const actor = { kind: "user" as const, userId };

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

  it("refuses a PARENT link on a sub-task and allows other links", async () => {
    const parent = await create("Linked parent");
    const child = await create("Linked child", {
      parent: { taskId: parent.id },
    });
    const other = await create("Other");

    await expect(
      prisma.$transaction((tx) =>
        requireNoSubtaskInParentLink(tx, TaskLinkType.PARENT, [
          other.id,
          child.id,
        ]),
      ),
    ).rejects.toThrow("A sub-task cannot be a parent or child task");
    await expect(
      prisma.$transaction((tx) =>
        requireNoSubtaskInParentLink(tx, TaskLinkType.RELATES, [
          other.id,
          child.id,
        ]),
      ),
    ).resolves.toBeUndefined();
  });
});
