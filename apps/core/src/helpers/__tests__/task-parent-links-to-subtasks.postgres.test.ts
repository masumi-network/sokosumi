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
const otherWorkspaceId = randomUUID();
// Each diamond doubles the paths to the Tasks below it. A walk that keeps
// one row per path would build 2^30 rows; one row per link and depth stays
// small. 30 diamonds are 60 levels, inside the backfill's 64.
const DIAMOND_COUNT = 30;
// Far above the time the bounded walk needs, far below the unbounded one.
const BACKFILL_TIMEOUT = "10s";
const BACKFILL_TRANSACTION_TIMEOUT_MS = 30_000;

async function createTask(
  name: string,
  input: {
    projectId?: string | null;
    parentTaskId?: string;
    visibility?: "PUBLIC" | "PRIVATE";
    ownerId?: string;
    archivedAt?: Date;
    workspaceId?: string;
  } = {},
): Promise<string> {
  const task = await prisma.task.create({
    data: {
      ownerId: input.ownerId ?? userId,
      creatorUserId: userId,
      workspaceId: input.workspaceId ?? workspaceId,
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
          workspace: {
            create: { id: id === userId ? workspaceId : otherWorkspaceId },
          },
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.task.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
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

  it("turns a link into RELATES when the child has a parent, the parent is archived, or workspace or visibility differ", async () => {
    const formerParent = await createTask("Former parent");
    const alreadySubtask = await createTask("Already a sub-task", {
      parentTaskId: formerParent,
    });
    const childHasParent = await parentLink(
      await createTask("Second parent"),
      alreadySubtask,
    );
    const archivedParent = await parentLink(
      await createTask("Archived parent", { archivedAt: new Date() }),
      await createTask("Child of archived"),
    );
    const otherWorkspaceChild = await createTask("Other workspace child", {
      workspaceId: otherWorkspaceId,
      ownerId: otherUserId,
    });
    const workspaceMismatch = await parentLink(
      await createTask("Workspace parent"),
      otherWorkspaceChild,
    );
    const privateChild = await createTask("Private child", {
      visibility: "PRIVATE",
    });
    const visibilityMismatch = await parentLink(
      await createTask("Public parent"),
      privateChild,
    );

    await prisma.$executeRawUnsafe(backfillSql);

    for (const link of [
      childHasParent,
      archivedParent,
      workspaceMismatch,
      visibilityMismatch,
    ]) {
      expect(await linkType(link)).toBe(TaskLinkType.RELATES);
    }
    expect((await parentOf(alreadySubtask)).parentTaskId).toBe(formerParent);
    expect((await parentOf(otherWorkspaceChild)).parentTaskId).toBeNull();
    expect((await parentOf(privateChild)).parentTaskId).toBeNull();
  });

  it(
    "walks a chain of diamonds in bounded time",
    async () => {
      // top -> left, top -> right, left -> bottom, right -> bottom, and the
      // bottom is the next diamond's top.
      const tops = [await createTask("Diamond top 0")];
      const firstLefts: string[] = [];
      for (let index = 0; index < DIAMOND_COUNT; index += 1) {
        const left = await createTask(`Diamond left ${index}`);
        const right = await createTask(`Diamond right ${index}`);
        const bottom = await createTask(`Diamond top ${index + 1}`);
        firstLefts.push(await parentLink(tops[index], left));
        await parentLink(tops[index], right);
        await parentLink(left, bottom);
        await parentLink(right, bottom);
        tops.push(bottom);
      }

      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL statement_timeout = '${BACKFILL_TIMEOUT}'`,
          );
          await tx.$executeRawUnsafe(backfillSql);
        },
        { timeout: BACKFILL_TRANSACTION_TIMEOUT_MS },
      );

      // The top's two links convert; a bottom has two parents and stays apart.
      expect(await linkType(firstLefts[0])).toBeNull();
      expect((await parentOf(tops[1])).parentTaskId).toBeNull();
    },
    BACKFILL_TRANSACTION_TIMEOUT_MS,
  );
});
