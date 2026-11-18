import { randomUUID } from "node:crypto";
import { TaskStatus } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountDeleteProjectTask from "./[taskId]/delete";
import mountPostProjectTask from "./post";

// A success publishes calendar invalidations over Ably; the test env has no real key.
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

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

const userId = randomUUID();
const workspaceId = randomUUID();

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", { workspaceId, userId, organizationId: null });
    await next();
  });
  app.onError(errorHandler);
  mountPostProjectTask(app);
  mountDeleteProjectTask(app);
  return app;
}

/** A Task with one parked sub-task, which would follow it to another Project. */
async function createTaskWithParkedSubtask(projectId: string | null) {
  const root = await prisma.task.create({
    data: { workspaceId, ownerId: userId, projectId, name: "Root" },
  });
  const step = await prisma.task.create({
    data: {
      workspaceId,
      ownerId: userId,
      projectId,
      parentTaskId: root.id,
      position: 1,
      status: TaskStatus.GRANT_PENDING,
      name: "Parked step",
    },
  });
  return { root: root.id, step: step.id };
}

async function projectIdOf(taskId: string) {
  return (
    await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { projectId: true },
    })
  ).projectId;
}

// Real Prisma and triggers: without the guard, the parked sub-task follows.
describe.skipIf(!enabled)("Project task routes with sub-tasks", () => {
  let projectId: string;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Project sub-task guard fixture",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    projectId = (
      await prisma.project.create({ data: { workspaceId, name: "Guarded" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("refuses to add a Task to a Project when a sub-task that would follow is parked", async () => {
    const { root, step } = await createTaskWithParkedSubtask(null);

    const response = await createApp().request(
      `http://localhost/${projectId}/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: root }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ kind: "task_parked" });
    expect(await projectIdOf(root)).toBeNull();
    expect(await projectIdOf(step)).toBeNull();
  });

  it("refuses to remove a Task from its Project when a sub-task that would follow is parked", async () => {
    const { root, step } = await createTaskWithParkedSubtask(projectId);

    const response = await createApp().request(
      `http://localhost/${projectId}/tasks/${root}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ kind: "task_parked" });
    expect(await projectIdOf(root)).toBe(projectId);
    expect(await projectIdOf(step)).toBe(projectId);
  });
});
