import { randomUUID } from "node:crypto";
import { TaskStatus } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetTasks from "./get";

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
const graceId = randomUUID();
const workspaceId = randomUUID();
let parentId = "";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: adaId,
      organizationId: null,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", {
      workspaceId,
      userId: adaId,
      organizationId: null,
    });
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, 500));
  mountGetTasks(app);
  return app;
}

interface ListedTask {
  id: string;
  name: string;
  subtaskProgress: { completed: number; total: number };
}

async function list(params: Record<string, string>): Promise<ListedTask[]> {
  const response = await createApp().request(
    `http://localhost/?${new URLSearchParams({ scope: "workspace", ...params })}`,
  );
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

async function createTask(
  name: string,
  extra: {
    parentTaskId?: string;
    position?: number;
    status?: TaskStatus;
    archivedAt?: Date;
    ownerId?: string;
  } = {},
): Promise<string> {
  const task = await prisma.task.create({
    data: {
      name,
      workspaceId,
      ownerId: extra.ownerId ?? adaId,
      creatorUserId: adaId,
      status: TaskStatus.READY,
      parentTaskId: extra.parentTaskId ?? null,
      position: extra.position ?? null,
      ...(extra.status ? { status: extra.status } : {}),
      ...(extra.archivedAt ? { archivedAt: extra.archivedAt } : {}),
    },
  });
  return task.id;
}

// Real Prisma and migrations: the board's root-only default, sub-task
// order, and the progress count.
describe.skipIf(!enabled)("GET /tasks with sub-tasks", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: graceId,
        name: "Sub-task teammate",
        email: `${graceId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.user.create({
      data: {
        id: adaId,
        name: "Sub-task list fixture",
        email: `${adaId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    parentId = await createTask("Parent");
    await createTask("Loose");
    // Inserted out of order: position, not creation, orders siblings.
    const second = await createTask("Second", {
      parentTaskId: parentId,
      position: 2,
    });
    await createTask("First", {
      parentTaskId: parentId,
      position: 1,
      status: TaskStatus.COMPLETED,
    });
    await createTask("Archived step", {
      parentTaskId: parentId,
      position: 3,
      archivedAt: new Date(),
    });
    await createTask("Nested", { parentTaskId: second, position: 1 });
    await createTask("Teammate's step", {
      parentTaskId: second,
      position: 2,
      ownerId: graceId,
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: [adaId, graceId] } } });
    await prisma.$disconnect();
  });

  it("lists only Tasks that are not sub-tasks, with progress over direct, non-archived sub-tasks", async () => {
    const tasks = await list({});

    expect(
      tasks.map((task) => [task.name, task.subtaskProgress]).sort(),
    ).toEqual([
      ["Loose", { completed: 0, total: 0 }],
      ["Parent", { completed: 1, total: 2 }],
    ]);
  });

  it("lists a Task's direct sub-tasks in position order", async () => {
    const tasks = await list({ parentTaskId: parentId });

    expect(tasks.map((task) => task.name)).toEqual(["First", "Second"]);
    expect(tasks[1]?.subtaskProgress).toEqual({ completed: 0, total: 2 });
  });

  it("lists a teammate's sub-task too, whatever the owner scope", async () => {
    const [, second] = await list({ parentTaskId: parentId });
    const tasks = await list({
      parentTaskId: second?.id ?? "",
      scope: "owned",
    });

    expect(tasks.map((task) => task.name)).toEqual([
      "Nested",
      "Teammate's step",
    ]);
  });

  it("lists sub-tasks too with includeSubtasks=true", async () => {
    const tasks = await list({ includeSubtasks: "true" });

    expect(tasks.map((task) => task.name).sort()).toEqual([
      "First",
      "Loose",
      "Nested",
      "Parent",
      "Second",
      "Teammate's step",
    ]);
  });
});
