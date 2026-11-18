import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { setTaskWorkspaceTags } from "@/helpers/task-workspace-tags";
import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import mountPatchTask from "@/routes/v1/tasks/[id]/patch";
import mountGetTasks from "@/routes/v1/tasks/get";
import { taskListSchema } from "@/schemas/task.schema";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
import mountGetLabels from "../get";
import mountCreateLabel from "../post";
import mountPatchLabel from "./patch";

vi.mock("@/helpers/task-tag-rollout", () => ({
  TASK_WORKSPACE_JEV_ENABLED: true,
}));
vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
  publishTaskEventData: vi.fn(),
}));
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
  const vetoedTask = randomUUID();
  const suggestedTask = randomUUID();
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
      data: [sourceOnlyTask, bothTagsTask, vetoedTask, suggestedTask].map(
        (id) => ({
          id,
          workspaceId,
          ownerId: userId,
          creatorUserId: userId,
          name: "Label merge",
        }),
      ),
    });
    await prisma.taskWorkspaceTag.createMany({
      data: [
        { taskId: sourceOnlyTask, labelId: sourceId },
        { taskId: bothTagsTask, labelId: sourceId },
        { taskId: bothTagsTask, labelId: targetId, state: "JEV_ADDED" },
        { taskId: vetoedTask, labelId: sourceId, state: "JEV_ADDED" },
      ],
    });
    await prisma.taskWorkspaceTagDecision.createMany({
      data: [
        { taskId: vetoedTask, labelId: targetId, state: "JEV_DISMISSED" },
        { taskId: suggestedTask, labelId: sourceId, state: "JEV_SUGGESTED" },
        { taskId: suggestedTask, labelId: targetId, state: "JEV_DISMISSED" },
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
      expect(task.workspaceTags).toMatchObject([
        { id: targetId, displayName: "Canonical", source: "manual" },
      ]);
    }
    for (const taskId of [vetoedTask, suggestedTask]) {
      expect(
        await prisma.taskWorkspaceTagDecision.findMany({ where: { taskId } }),
      ).toEqual([{ taskId, labelId: targetId, state: "JEV_DISMISSED" }]);
    }
  });

  it("serializes a Task edit and a vocabulary merge so the veto follows the canonical tag", async () => {
    const source = randomUUID(),
      target = randomUUID(),
      taskId = randomUUID();
    await prisma.workspaceLabel.createMany({
      data: [source, target].map((id) => ({
        id,
        workspaceId,
        kind: "TAG",
        displayName: id,
        normalizedName: id,
      })),
    });
    await prisma.task.create({
      data: {
        id: taskId,
        workspaceId,
        ownerId: userId,
        creatorUserId: userId,
        name: "Tag edit during merge",
        workspaceTags: { create: { labelId: source } },
      },
    });
    const labels = createTaskScheduleTestApp(mountPatchLabel, actor, workspace);
    const writer = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const edit = prisma.$transaction(
      async (tx) => {
        await lockCalendarScope(tx, workspaceId, [], userId);
        await lockTaskRows(tx, [taskId]);
        const [connection] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        writer.resolve(connection!.pid);
        await release.promise;
        await setTaskWorkspaceTags(tx, taskId, workspaceId, []);
      },
      { timeout: 10_000 },
    );
    const pid = await writer.promise;
    const merge = labels.request(
      `/${source}`,
      jsonRequest("PATCH", { scope: "me", mergeIntoLabelId: target }),
    );
    try {
      await expect
        .poll(
          async () => {
            const [state] = await prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting
        `;
            return state!.waiting;
          },
          { timeout: 2_000 },
        )
        .toBe(true);
    } finally {
      release.resolve();
      await edit;
      await merge;
    }
    expect((await merge).status).toBe(200);
    expect(
      await prisma.taskWorkspaceTagDecision.findMany({ where: { taskId } }),
    ).toEqual([{ taskId, labelId: target, state: "JEV_DISMISSED" }]);
    expect(await prisma.taskWorkspaceTag.count({ where: { taskId } })).toBe(0);
  });

  it("rejects a stale full tag edit after a merge, including sibling changes in the same PATCH", async () => {
    const source = randomUUID(),
      target = randomUUID(),
      taskId = randomUUID();
    await prisma.workspaceLabel.createMany({
      data: [source, target].map((id) => ({
        id,
        workspaceId,
        kind: "TAG",
        displayName: id,
        normalizedName: id,
      })),
    });
    await prisma.task.create({
      data: {
        id: taskId,
        workspaceId,
        ownerId: userId,
        creatorUserId: userId,
        name: "Original title",
        workspaceTags: { create: { labelId: source } },
      },
    });
    const labels = createTaskScheduleTestApp(mountPatchLabel, actor, workspace);
    expect(
      (
        await labels.request(
          `/${source}`,
          jsonRequest("PATCH", { scope: "me", mergeIntoLabelId: target }),
        )
      ).status,
    ).toBe(200);
    const tasks = createTaskScheduleTestApp(mountPatchTask, actor, workspace);
    const patch = (body: Record<string, unknown>) =>
      tasks.request(`/${taskId}`, jsonRequest("PATCH", body));
    const stale = await patch({
      workspaceTagIds: [],
      expectedWorkspaceTagIds: [source],
      name: "Lost update",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      kind: "task_workspace_tags_changed",
    });
    expect(
      await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { name: true, workspaceTags: { select: { labelId: true } } },
      }),
    ).toEqual({ name: "Original title", workspaceTags: [{ labelId: target }] });
    const fresh = await patch({
      workspaceTagIds: [],
      expectedWorkspaceTagIds: [target.toUpperCase(), target],
    });
    expect(fresh.status, await fresh.text()).toBe(200);
    expect(
      await prisma.taskWorkspaceTagDecision.findMany({ where: { taskId } }),
    ).toEqual([{ taskId, labelId: target, state: "JEV_DISMISSED" }]);
  });

  it("round-trips a workspace color without changing what Jev evaluates", async () => {
    const post = createTaskScheduleTestApp(mountCreateLabel, actor, workspace);
    const patch = createTaskScheduleTestApp(mountPatchLabel, actor, workspace);
    const list = createTaskScheduleTestApp(mountGetLabels, actor, workspace);
    const created = await post.request(
      "/",
      jsonRequest("POST", {
        scope: "me",
        kind: "TAG",
        displayName: "Release watch",
        color: "purple",
      }),
    );
    expect(created.status).toBe(201);
    const { data: label } = await created.json();
    expect(label.color).toBe("purple");
    const decision = { taskId: bothTagsTask, labelId: label.id };
    await prisma.taskWorkspaceTagDecision.create({
      data: { ...decision, state: "JEV_SUGGESTED" },
    });
    for (const color of ["teal", null]) {
      const updated = await patch.request(
        `/${label.id}`,
        jsonRequest("PATCH", { scope: "me", color }),
      );
      expect(updated.status).toBe(200);
      expect((await updated.json()).data).toMatchObject({
        color,
        vocabularyVersion: label.vocabularyVersion,
      });
      const labels = await list.request("/?scope=me&kind=TAG");
      expect((await labels.json()).data).toContainEqual(
        expect.objectContaining({ id: label.id, color }),
      );
      expect(
        await prisma.taskWorkspaceTagDecision.count({ where: decision }),
      ).toBe(1);
    }
    const renamed = await patch.request(
      `/${label.id}`,
      jsonRequest("PATCH", { scope: "me", displayName: "Legal review" }),
    );
    expect(renamed.status).toBe(200);
    expect(
      await prisma.taskWorkspaceTagDecision.count({ where: decision }),
    ).toBe(0);
  });
});
