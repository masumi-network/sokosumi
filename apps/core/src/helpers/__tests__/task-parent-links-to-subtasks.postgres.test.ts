import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { TaskLinkType } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const backfillSql = readFileSync(
  new URL(
    "../../../../../packages/database/prisma/migrations/20261118150010_task_parent_links_to_subtasks/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const userId = randomUUID();
const otherUserId = randomUUID();
const workspaceId = randomUUID();

async function createTask(
  name: string,
  input: {
    projectId?: string | null;
    parentTaskId?: string;
    visibility?: "PUBLIC" | "PRIVATE";
    ownerId?: string;
    archivedAt?: Date;
  } = {},
): Promise<string> {
  const task = await prisma.task.create({
    data: {
      ownerId: input.ownerId ?? userId,
      creatorUserId: userId,
      workspaceId,
      projectId: input.projectId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      position: input.parentTaskId ? 1 : null,
      visibility: input.visibility ?? "PUBLIC",
      archivedAt: input.archivedAt ?? null,
      name,
    },
  });
  return task.id;
}

let linkClock = Date.parse("2026-01-01T00:00:00.000Z");

/** A PARENT link; each one is created a minute after the one before. */
async function parentLink(
  fromTaskId: string,
  toTaskId: string,
): Promise<string> {
  linkClock += 60_000;
  const link = await prisma.taskLink.create({
    data: {
      fromTaskId,
      toTaskId,
      type: TaskLinkType.PARENT,
      createdAt: new Date(linkClock),
    },
  });
  return link.id;
}

async function parentOf(taskId: string) {
  return prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { parentTaskId: true, position: true },
  });
}

async function linkType(linkId: string): Promise<TaskLinkType | null> {
  const link = await prisma.taskLink.findUnique({ where: { id: linkId } });
  return link?.type ?? null;
}

// The real backfill SQL against the migrated schema and its guard trigger
// (SOKD-279).
describe.skipIf(!enabled)("PARENT links to sub-tasks backfill", () => {
  beforeAll(async () => {
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: "Backfill fixture",
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

  it("converts the links that meet every rule and turns the rest into RELATES links", async () => {
    const alpha = (
      await prisma.project.create({ data: { workspaceId, name: "Alpha" } })
    ).id;
    const beta = (
      await prisma.project.create({ data: { workspaceId, name: "Beta" } })
    ).id;

    // Convertible: two children appended after an existing sub-task, in
    // link order.
    const parent = await createTask("Parent", { projectId: alpha });
    await createTask("Existing sub-task", {
      projectId: alpha,
      parentTaskId: parent,
    });
    const first = await createTask("First", { projectId: alpha });
    const second = await createTask("Second", { projectId: alpha });
    const firstLink = await parentLink(parent, first);
    const secondLink = await parentLink(parent, second);

    // A chain of six links, oldest at the bottom. Top-down keeps the top
    // five levels; the sixth would be too deep.
    const chain = [await createTask("Level 0")];
    for (let level = 1; level <= 6; level += 1) {
      chain.push(await createTask(`Level ${level}`));
    }
    const chainLinks: string[] = [];
    for (let level = 6; level >= 1; level -= 1) {
      chainLinks.unshift(await parentLink(chain[level - 1], chain[level]));
    }

    const crossProject = await parentLink(
      await createTask("Alpha parent", { projectId: alpha }),
      await createTask("Beta child", { projectId: beta }),
    );
    const twoParentsChild = await createTask("Two parents");
    const twoParents = [
      await parentLink(await createTask("Parent A"), twoParentsChild),
      await parentLink(await createTask("Parent B"), twoParentsChild),
    ];
    // A pair has one link at most, so the shortest cycle has three.
    const cycleA = await createTask("Cycle A");
    const cycleB = await createTask("Cycle B");
    const cycleC = await createTask("Cycle C");
    const cycleFirst = await parentLink(cycleA, cycleB);
    await parentLink(cycleB, cycleC);
    const cycleLast = await parentLink(cycleC, cycleA);
    const privateOwner = await parentLink(
      await createTask("Private parent", { visibility: "PRIVATE" }),
      await createTask("Their private child", {
        visibility: "PRIVATE",
        ownerId: otherUserId,
      }),
    );
    const archivedEnd = await parentLink(
      await createTask("Live parent"),
      await createTask("Archived child", { archivedAt: new Date() }),
    );

    await prisma.$executeRawUnsafe(backfillSql);

    expect(await parentOf(first)).toEqual({
      parentTaskId: parent,
      position: 2,
    });
    expect(await parentOf(second)).toEqual({
      parentTaskId: parent,
      position: 3,
    });
    expect(await linkType(firstLink)).toBeNull();
    expect(await linkType(secondLink)).toBeNull();

    for (let level = 1; level <= 5; level += 1) {
      expect((await parentOf(chain[level])).parentTaskId).toBe(
        chain[level - 1],
      );
    }
    expect((await parentOf(chain[6])).parentTaskId).toBeNull();
    expect(await linkType(chainLinks[5])).toBe(TaskLinkType.RELATES);

    // The older links of the cycle convert; the newest one would close it.
    expect((await parentOf(cycleB)).parentTaskId).toBe(cycleA);
    expect((await parentOf(cycleC)).parentTaskId).toBe(cycleB);
    expect(await linkType(cycleFirst)).toBeNull();
    expect(await linkType(cycleLast)).toBe(TaskLinkType.RELATES);

    for (const link of [
      crossProject,
      ...twoParents,
      privateOwner,
      archivedEnd,
    ]) {
      expect(await linkType(link)).toBe(TaskLinkType.RELATES);
    }
    expect((await parentOf(twoParentsChild)).parentTaskId).toBeNull();
    // A RELATES link keeps its direction.
    const kept = await prisma.taskLink.findUniqueOrThrow({
      where: { id: twoParents[0] },
    });
    expect(kept.toTaskId).toBe(twoParentsChild);
  });
});
