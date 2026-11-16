import { randomUUID } from "node:crypto";
import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetTasks from "../../get";
import mountPostTaskRestore from "./post";

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

const adaId = randomUUID();
const bobId = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const adaPersonalWorkspaceId = randomUUID();
const bobPersonalWorkspaceId = randomUUID();

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

const ids = {
  queued: randomUUID(),
  draft: randomUUID(),
  completed: randomUUID(),
  live: randomUUID(),
  adaPrivate: randomUUID(),
};

function createApp(userId: string) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", { workspaceId, userId: null, organizationId });
    await next();
  });
  app.onError(errorHandler);
  mountGetTasks(app);
  mountPostTaskRestore(app);
  return app;
}

async function restore(userId: string, taskId: string) {
  return createApp(userId).request(`http://localhost/${taskId}/restore`, {
    method: "POST",
  });
}

// Real Prisma: the archived list and restore write against migrations.
describe.skipIf(!enabled)("archived Tasks", () => {
  beforeAll(async () => {
    for (const [id, personalWorkspaceId] of [
      [adaId, adaPersonalWorkspaceId],
      [bobId, bobPersonalWorkspaceId],
    ]) {
      await prisma.user.create({
        data: {
          id,
          name: "Restore fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: personalWorkspaceId } },
        },
      });
    }
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Acme",
        slug: `acme-${organizationId}`,
        createdAt: new Date(),
        members: {
          create: [
            { userId: adaId, role: "owner" },
            { userId: bobId, role: "member" },
          ],
        },
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.task.createMany({
      data: [
        {
          id: ids.queued,
          name: "Queued",
          status: TaskStatus.QUEUED,
          runAt: daysAgo(1),
          archivedAt: daysAgo(1),
        },
        {
          id: ids.draft,
          name: "Draft",
          status: TaskStatus.DRAFT,
          archivedAt: daysAgo(2),
        },
        {
          id: ids.completed,
          name: "Completed",
          status: TaskStatus.COMPLETED,
          archivedAt: daysAgo(3),
        },
        { id: ids.live, name: "Live", status: TaskStatus.READY },
        {
          id: ids.adaPrivate,
          name: "Ada private",
          status: TaskStatus.DRAFT,
          visibility: TaskVisibility.PRIVATE,
          archivedAt: daysAgo(4),
        },
      ].map((task) => ({ workspaceId, ownerId: adaId, ...task })),
    });
  });

  afterAll(async () => {
    const workspaceIds = [
      workspaceId,
      adaPersonalWorkspaceId,
      bobPersonalWorkspaceId,
    ];
    await prisma.task.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: workspaceIds } },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [adaId, bobId] } } });
    await prisma.$disconnect();
  });

  it("lists only archived Tasks the caller can see, latest archive first", async () => {
    const list = async (userId: string) => {
      const response = await createApp(userId).request(
        "http://localhost/?archived=true&scope=workspace",
      );
      const body = (await response.json()) as { data: Array<{ name: string }> };
      expect(response.status, JSON.stringify(body)).toBe(200);
      return body.data.map((task) => task.name);
    };

    expect(await list(adaId)).toEqual([
      "Queued",
      "Draft",
      "Completed",
      "Ada private",
    ]);
    expect(await list(bobId)).toEqual(["Queued", "Draft", "Completed"]);
  });

  it("does not let a teammate restore a private Task", async () => {
    expect((await restore(bobId, ids.adaPrivate)).status).toBe(404);
  });

  it("brings a waiting Task back as a Draft without its Run at", async () => {
    const response = await restore(adaId, ids.queued);
    expect(response.status).toBe(200);

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: ids.queued },
      include: { events: true },
    });
    expect(task.archivedAt).toBeNull();
    expect(task.status).toBe(TaskStatus.DRAFT);
    expect(task.runAt).toBeNull();
    expect(task.events.map((event) => event.comment)).toContain(
      "Task restored",
    );
  });

  it("keeps a finished Task's status", async () => {
    expect((await restore(adaId, ids.completed)).status).toBe(200);
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: ids.completed },
    });
    expect(task.archivedAt).toBeNull();
    expect(task.status).toBe(TaskStatus.COMPLETED);
  });

  it("answers 404 for a Task that is not archived", async () => {
    expect((await restore(adaId, ids.live)).status).toBe(404);
  });
});
