import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetTaskView from "./get";
import mountPutTaskView from "./put";

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
const organizationId = randomUUID();
const workspaceId = randomUUID();
const personalWorkspaceId = randomUUID();

function createApp(activeWorkspaceId: string) {
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
    c.set("workspaceContext", {
      workspaceId: activeWorkspaceId,
      userId: null,
      organizationId,
    });
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, 500));
  mountGetTaskView(app);
  mountPutTaskView(app);
  return app;
}

async function readView(activeWorkspaceId: string) {
  const response = await createApp(activeWorkspaceId).request(
    "http://localhost/view",
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: { query: string | null } }).data
    .query;
}

async function saveView(activeWorkspaceId: string, query: string) {
  const response = await createApp(activeWorkspaceId).request(
    "http://localhost/view",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    },
  );
  expect(response.status).toBe(200);
}

// Real Prisma and the composite unique key the upsert relies on.
describe.skipIf(!enabled)("GET and PUT /tasks/view", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Saved view fixture",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: personalWorkspaceId } },
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Acme",
        slug: `acme-${organizationId}`,
        createdAt: new Date(),
        members: { create: [{ userId, role: "owner" }] },
        workspace: { create: { id: workspaceId } },
      },
    });
  });

  afterAll(async () => {
    const workspaceIds = [workspaceId, personalWorkspaceId];
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("keeps one view per workspace, and the last save wins", async () => {
    expect(await readView(workspaceId)).toBeNull();

    await saveView(workspaceId, "status=READY");
    await saveView(workspaceId, "sort=priority&subtasks=1");
    await saveView(personalWorkspaceId, "");

    expect(await readView(workspaceId)).toBe("sort=priority&subtasks=1");
    expect(await readView(personalWorkspaceId)).toBe("");
    expect(await prisma.taskViewPreference.count({ where: { userId } })).toBe(
      2,
    );
  });
});
