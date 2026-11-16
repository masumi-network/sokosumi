import { randomUUID } from "node:crypto";
import { TaskStatus, TaskVisibility } from "@sokosumi/database";
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
const bobId = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const adaPersonalWorkspaceId = randomUUID();
const bobPersonalWorkspaceId = randomUUID();

const TODAY = "2026-11-10";
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

// Home's My day: Ada's open Tasks due by today, owned or assigned to her.
const matching = [
  { name: "Due 1", ownerId: adaId, dueOn: "2026-11-01" },
  // A teammate's public Task assigned to Ada.
  {
    name: "Due 2",
    ownerId: bobId,
    assigneeUserId: adaId,
    dueOn: "2026-11-02",
    status: TaskStatus.RUNNING,
  },
  {
    name: "Due 3",
    ownerId: adaId,
    dueOn: "2026-11-03",
    status: TaskStatus.DRAFT,
  },
  {
    name: "Due 4",
    ownerId: adaId,
    dueOn: "2026-11-04",
    status: TaskStatus.FAILED,
  },
  { name: "Due 5", ownerId: adaId, dueOn: "2026-11-05" },
  { name: "Due 6", ownerId: adaId, dueOn: TODAY },
];

const unrelated = [
  { name: "Due tomorrow", ownerId: adaId, dueOn: "2026-11-11" },
  {
    name: "Completed",
    ownerId: adaId,
    dueOn: "2026-11-01",
    status: TaskStatus.COMPLETED,
  },
  {
    name: "Canceled",
    ownerId: adaId,
    dueOn: "2026-11-01",
    status: TaskStatus.CANCELED,
  },
  { name: "No due date", ownerId: adaId, dueOn: null },
  {
    name: "Archived",
    ownerId: adaId,
    dueOn: "2026-11-01",
    archivedAt: new Date(),
  },
  { name: "Bob's own", ownerId: bobId, dueOn: "2026-11-01" },
  {
    name: "Bob's private, assigned to Ada",
    ownerId: bobId,
    assigneeUserId: adaId,
    dueOn: "2026-11-01",
    visibility: TaskVisibility.PRIVATE,
  },
  {
    name: "Other workspace",
    ownerId: adaId,
    dueOn: "2026-11-01",
    workspaceId: adaPersonalWorkspaceId,
  },
];

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: adaId,
      organizationId,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", { workspaceId, userId: null, organizationId });
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, 500));
  mountGetTasks(app);
  return app;
}

interface Page {
  data: Array<{ name: string }>;
  meta: { pagination: { total: number; nextCursor: string | null } };
}

async function myDayPage(cursor?: string): Promise<Page> {
  const params = new URLSearchParams({
    scope: "mine",
    dueOnTo: TODAY,
    sort: "dueOn",
    status: Object.values(TaskStatus)
      .filter(
        (status) =>
          status !== TaskStatus.COMPLETED &&
          status !== TaskStatus.CANCELED &&
          status !== TaskStatus.CREATED,
      )
      .join(","),
    limit: "5",
    ...(cursor ? { cursor } : {}),
  });
  const response = await createApp().request(`http://localhost/?${params}`);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body as Page;
}

// Real Prisma, migrations, date column and cursor pagination.
describe.skipIf(!enabled)("GET /tasks for Home's My day", () => {
  beforeAll(async () => {
    for (const [id, personalWorkspaceId] of [
      [adaId, adaPersonalWorkspaceId],
      [bobId, bobPersonalWorkspaceId],
    ]) {
      await prisma.user.create({
        data: {
          id,
          name: "My day fixture",
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
      data: [...matching, ...unrelated].map(({ dueOn, ...task }) => ({
        workspaceId,
        status: TaskStatus.READY,
        ...task,
        dueOn: dueOn ? day(dueOn) : null,
      })),
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

  it("pages through exactly the six matching Tasks, earliest due first", async () => {
    const first = await myDayPage();

    expect(first.data.map((task) => task.name)).toEqual([
      "Due 1",
      "Due 2",
      "Due 3",
      "Due 4",
      "Due 5",
    ]);
    expect(first.meta.pagination.total).toBe(6);
    expect(first.meta.pagination.nextCursor).not.toBeNull();

    const second = await myDayPage(first.meta.pagination.nextCursor ?? "");

    expect(second.data.map((task) => task.name)).toEqual(["Due 6"]);
    expect(second.meta.pagination.total).toBe(6);
    expect(second.meta.pagination.nextCursor).toBeNull();
  });
});
