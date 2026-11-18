import { randomUUID } from "node:crypto";
import { type FileLabelKind, type Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import { MAX_TASK_TAGS, mapTaskTags, TASK_TAG_IDS } from "./task-tags";
import { setTaskWorkspaceTags } from "./task-workspace-tags";

const databaseUrl = process.env.DATABASE_URL;
const db =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres")
    ? createPrismaClient(databaseUrl)
    : null;

afterAll(() => db?.$disconnect());

class Rollback extends Error {}

async function createPersonalWorkspace(tx: Prisma.TransactionClient) {
  const user = await tx.user.create({
    data: {
      name: "Task tag test",
      email: `${randomUUID()}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const workspace = await tx.workspace.create({ data: { userId: user.id } });
  return { userId: user.id, workspaceId: workspace.id };
}

async function withTask(
  test: (
    tx: Prisma.TransactionClient,
    taskId: string,
    workspaceId: string,
  ) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  try {
    await db.$transaction(async (tx) => {
      const { userId, workspaceId } = await createPersonalWorkspace(tx);
      const task = await tx.task.create({
        data: { workspaceId, ownerId: userId, name: "Tag test" },
      });
      await test(tx, task.id, workspaceId);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

describe.skipIf(!db)("Task tags against PostgreSQL", () => {
  it("allows retaining an archived tag and rejects new archived, foreign and category tags", async () => {
    await withTask(async (tx, taskId, workspaceId) => {
      const label = (
        kind: FileLabelKind,
        displayName: string,
        scopeId = workspaceId,
      ) =>
        tx.workspaceLabel.create({
          data: {
            kind,
            workspaceId: scopeId,
            displayName,
            normalizedName: displayName.toLowerCase(),
          },
        });
      const foreignWorkspace = await createPersonalWorkspace(tx);
      const foreign = await label(
        "TAG",
        "Foreign",
        foreignWorkspace.workspaceId,
      );
      const current = await label("TAG", "Current");
      const retired = await label("TAG", "Retired");
      const category = await label("CATEGORY", "Category");

      await setTaskWorkspaceTags(tx, taskId, workspaceId, [retired.id]);
      await tx.workspaceLabel.update({
        where: { id: retired.id },
        data: { archivedAt: new Date() },
      });
      await setTaskWorkspaceTags(tx, taskId, workspaceId, [
        current.id,
        retired.id,
      ]);
      for (const id of [foreign.id, category.id]) {
        await expect(
          setTaskWorkspaceTags(tx, taskId, workspaceId, [id]),
        ).rejects.toMatchObject({ status: 422 });
      }
      const ids = () =>
        tx.taskWorkspaceTag.findMany({
          where: { taskId },
          select: { labelId: true },
        });
      expect(await ids()).toEqual(
        expect.arrayContaining([
          { labelId: current.id },
          { labelId: retired.id },
        ]),
      );
      await setTaskWorkspaceTags(tx, taskId, workspaceId, []);
      expect(await ids()).toEqual([]);
      await expect(
        setTaskWorkspaceTags(tx, taskId, workspaceId, [retired.id]),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  it("clears every tag when a direct workspace update moves the Task", async () => {
    await withTask(async (tx, taskId, workspaceId) => {
      const other = await createPersonalWorkspace(tx);
      const labels = await tx.workspaceLabel.createManyAndReturn({
        data: ["First", "Second"].map((displayName) => ({
          displayName,
          normalizedName: displayName.toLowerCase(),
          workspaceId,
          kind: "TAG",
        })),
        select: { id: true },
      });
      await setTaskWorkspaceTags(
        tx,
        taskId,
        workspaceId,
        labels.map(({ id }) => id),
      );
      const count = () => tx.taskWorkspaceTag.count({ where: { taskId } });

      await tx.$executeRaw`UPDATE "task" SET "workspaceId" = ${workspaceId}::uuid WHERE id = ${taskId}`;
      expect(await count()).toBe(2);
      await tx.$executeRaw`UPDATE "task" SET "workspaceId" = ${other.workspaceId}::uuid WHERE id = ${taskId}`;
      expect(await count()).toBe(0);
    });
  });

  it("finds every current classifier topic in the SQL view", async () => {
    await withTask(async (tx, taskId) => {
      for (let start = 0; start < TASK_TAG_IDS.length; start += MAX_TASK_TAGS) {
        const automaticTags = TASK_TAG_IDS.slice(start, start + MAX_TASK_TAGS);
        await tx.task.update({
          where: { id: taskId },
          data: { automaticTags },
        });
        const rows = await tx.taskVisibleTopic.findMany({ where: { taskId } });
        expect(rows.map(({ topicId }) => topicId).sort()).toEqual(
          [...automaticTags].sort(),
        );
      }
    });
  });

  it("filters exactly the topics exposed on Tasks with legacy corrections", async () => {
    await withTask(async (tx, taskId) => {
      const stored = {
        manualTags: ["writing", "unknown", "design", "design"],
        rejectedTags: ["qa"],
        automaticTags: [
          "qa",
          "design",
          "research",
          "marketing",
          "marketing",
          "social",
          "finance",
        ],
      };
      await tx.task.update({ where: { id: taskId }, data: stored });
      const visible = mapTaskTags(stored);
      const topics = await tx.taskVisibleTopic.findMany({ where: { taskId } });
      expect(topics.map(({ topicId }) => topicId).sort()).toEqual(
        [...visible.manual, ...visible.automatic].sort(),
      );
      expect(
        await tx.task.count({
          where: {
            id: taskId,
            visibleTopics: { some: { topicId: "finance" } },
          },
        }),
      ).toBe(0);
    });
  });
});
