import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import mountGetTasks from "@/routes/v1/tasks/get";
import { taskListSchema } from "@/schemas/task.schema";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
import mountPatchLabel from "./patch";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("Drive label merge on Tasks", () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const sourceId = randomUUID();
  const targetId = randomUUID();
  const sourceOnlyTask = randomUUID();
  const bothTagsTask = randomUUID();
  const actor: AuthenticationContext = {
    actor: "user",
    userId,
    organizationId: null,
    role: "user",
    authenticationMethod: "session",
  };
  const workspace = { workspaceId, userId, organizationId: null };

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Tag merge",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.workspaceLabel.createMany({
      data: [
        {
          id: sourceId,
          kind: "TAG",
          displayName: "Old name",
          normalizedName: "old name",
          workspaceId,
        },
        {
          id: targetId,
          kind: "TAG",
          displayName: "Canonical",
          normalizedName: "canonical",
          workspaceId,
        },
      ],
    });
    await prisma.task.createMany({
      data: [sourceOnlyTask, bothTagsTask].map((id) => ({
        id,
        workspaceId,
        ownerId: userId,
        creatorUserId: userId,
        name: "Label merge",
      })),
    });
    await prisma.taskWorkspaceTag.createMany({
      data: [
        { taskId: sourceOnlyTask, labelId: sourceId },
        { taskId: bothTagsTask, labelId: sourceId },
        { taskId: bothTagsTask, labelId: targetId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("moves a source-only assignment and deduplicates a Task that had both tags", async () => {
    const labels = createTaskScheduleTestApp(mountPatchLabel, actor, workspace);
    const merge = await labels.request(
      `/${sourceId}`,
      jsonRequest("PATCH", { scope: "me", mergeIntoLabelId: targetId }),
    );
    expect(merge.status, await merge.text()).toBe(200);

    const tasks = createTaskScheduleTestApp(mountGetTasks, actor, workspace);
    const response = await tasks.request(`/?workspaceTagId=${targetId}`);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    const matches = taskListSchema.parse(body.data);
    expect(matches.map(({ id }) => id).sort()).toEqual(
      [sourceOnlyTask, bothTagsTask].sort(),
    );
    for (const task of matches) {
      expect(task.workspaceTags).toEqual([
        { id: targetId, displayName: "Canonical" },
      ]);
    }
  });
});
