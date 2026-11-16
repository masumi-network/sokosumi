import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  installSqlCounter,
  recordedSql,
  userSummaryReads,
} from "@/test/sql-counter";

installSqlCounter();

import mountGetTasks from "./get";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const ownerId = randomUUID();
const workspaceId = randomUUID();
const organizationId = randomUUID();
const personalWorkspaceId = randomUUID();
const userIds = [ownerId];

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: ownerId,
      organizationId,
      role: "user",
      authenticationMethod: "session",
    });
    c.set("workspaceContext", {
      workspaceId,
      userId: null,
      organizationId,
    });
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, 500));
  mountGetTasks(app);
  return app;
}

async function list(query: string) {
  recordedSql().length = 0;
  const response = await createApp().request(`http://localhost/?${query}`);
  const body = (await response.json()) as {
    data: Array<{
      name: string;
      owner: { name: string };
      assignee: { type: string; user: { name: string } } | null;
    }>;
    error?: string;
  };
  expect(response.status, JSON.stringify(body)).toBe(200);
  return {
    body,
    reads: userSummaryReads(recordedSql()),
    sql: recordedSql().length,
  };
}

describe.skipIf(!enabled)("GET /tasks query count", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ownerId,
        name: "List owner",
        email: `${ownerId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: personalWorkspaceId } },
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "List org",
        slug: `list-${organizationId}`,
        createdAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    for (let index = 0; index < 4; index += 1) {
      const assigneeId = randomUUID();
      const participantId = randomUUID();
      const botOwnerId = randomUUID();
      const botId = randomUUID();
      const projectId = randomUUID();
      userIds.push(assigneeId, participantId, botOwnerId);
      for (const [id, name] of [
        [assigneeId, `Assignee ${index}`],
        [participantId, `Participant ${index}`],
        [botOwnerId, `Bot owner ${index}`],
      ] as const) {
        await prisma.user.create({
          data: {
            id,
            name,
            email: `${id}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
      await prisma.project.create({
        data: { id: projectId, workspaceId, name: `Project ${index}` },
      });
      await prisma.sokoBot.create({
        data: {
          id: botId,
          userId: botOwnerId,
          workspaceId,
          name: `Bot ${index}`,
        },
      });
      await prisma.task.create({
        data: {
          name: index === 0 ? "Only match" : `Task ${index}`,
          status: "READY",
          workspaceId,
          organizationId,
          ownerId,
          creatorSokoBotId: botId,
          assigneeUserId: assigneeId,
          projectId,
          participants: { create: { userId: participantId } },
          events: { create: { status: "READY", userId: ownerId } },
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.sokoBot.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, personalWorkspaceId] } },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("reads each user summary once for one task and for several", async () => {
    const one = await list("scope=workspace&q=Only%20match&limit=10");
    const many = await list("scope=workspace&limit=10");

    expect(one.body.data.map((task) => task.owner.name)).toEqual([
      "List owner",
    ]);
    expect(one.body.data[0]?.assignee).toMatchObject({
      type: "user",
      user: { name: "Assignee 0" },
    });
    expect(many.body.data).toHaveLength(4);
    expect(
      many.body.data.every((task) => task.owner.name === "List owner"),
    ).toBe(true);
    expect(many.sql).toBe(one.sql);
    expect(one.reads, "user summary queries for one task").toBe(1);
    expect(many.reads, "user summary queries for several tasks").toBe(1);
  });
});
