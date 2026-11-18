import { randomUUID } from "node:crypto";
import { TaskStatus, TaskVisibility } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { lockTaskRows } from "@/helpers/calendar-locks";
import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetTasks from "../../get";
import mountPostTaskRestore from "./post";

// The flow publishes over Ably; the test env has no real key.
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

const adaId = randomUUID();
const bobId = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const adaPersonalWorkspaceId = randomUUID();
const bobPersonalWorkspaceId = randomUUID();

// Long enough that the restore detects the deadlock first.
const BLOCKER_DEADLOCK_TIMEOUT = "30s";
const LOCK_WAIT_POLL_MS = 20;
const LOCK_WAIT_ATTEMPTS = 250;

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

/** Resolves once another backend of this database waits for a row lock. */
async function waitForLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    if (row && row.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
  }
  throw new Error("No transaction started waiting for a lock");
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

  it("retries a sub-task restore that Postgres broke off to end a deadlock", async () => {
    const parent = await prisma.task.create({
      data: { workspaceId, ownerId: adaId, name: "Deadlock parent" },
    });
    const subtask = await prisma.task.create({
      data: {
        workspaceId,
        ownerId: adaId,
        parentTaskId: parent.id,
        position: 1,
        name: "Deadlock sub-task",
        archivedAt: daysAgo(1),
      },
    });

    // The restore locks the parent, then the sub-task. This transaction takes
    // the sub-task first, then the parent, and waits long enough that the
    // restore is the one Postgres breaks off.
    let restoring: Promise<Response> | undefined;
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL deadlock_timeout = '${BLOCKER_DEADLOCK_TIMEOUT}'`,
        );
        await lockTaskRows(tx, [subtask.id]);
        restoring = restore(adaId, subtask.id);
        await waitForLockWaiter();
        await lockTaskRows(tx, [parent.id]);
      },
      { timeout: 30_000 },
    );

    expect((await restoring)?.status).toBe(200);
    const restored = await prisma.task.findUniqueOrThrow({
      where: { id: subtask.id },
    });
    expect(restored.archivedAt).toBeNull();
  });
});
