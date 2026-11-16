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

import mountGetCoworkerMeEvents from "./get";

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

const coworkerId = randomUUID();
const vendorId = randomUUID();
const workspaceId = randomUUID();
const organizationId = randomUUID();

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId,
      vendorId,
    });
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, 500));
  mountGetCoworkerMeEvents(app);
  return app;
}

async function list() {
  recordedSql().length = 0;
  const response = await createApp().request(
    "http://localhost/me/events?limit=10",
  );
  const body = (await response.json()) as {
    data: Array<{ comment: string | null; user: { name: string } | null }>;
    error?: string;
  };
  expect(response.status, JSON.stringify(body)).toBe(200);
  return {
    body,
    reads: userSummaryReads(recordedSql()),
    sql: recordedSql().length,
  };
}

describe.skipIf(!enabled)("GET /coworkers/me/events query count", () => {
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Events org",
        slug: `events-${organizationId}`,
        createdAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.vendor.create({
      data: { id: vendorId, name: "Events vendor", slug: vendorId },
    });
    await prisma.coworker.create({
      data: {
        id: coworkerId,
        slug: coworkerId,
        name: "Events coworker",
        vendorId,
        capabilities: ["tasks"],
      },
    });
    const task = await prisma.task.create({
      data: {
        name: "Assigned",
        status: "READY",
        workspaceId,
        assigneeId: coworkerId,
      },
    });
    for (let index = 0; index < 1; index += 1) {
      const userId = randomUUID();
      const botOwnerId = randomUUID();
      const botId = randomUUID();
      userIds.push(userId, botOwnerId);
      await prisma.user.create({
        data: {
          id: userId,
          name: `Actor ${index}`,
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.user.create({
        data: {
          id: botOwnerId,
          name: `Bot owner ${index}`,
          email: `${botOwnerId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.sokoBot.create({
        data: {
          id: botId,
          userId: botOwnerId,
          workspaceId,
          name: `Bot ${index}`,
        },
      });
      await prisma.taskEvent.create({
        data: {
          taskId: task.id,
          status: "RUNNING",
          comment: `Note ${index}`,
          userId,
          sokoBotId: botId,
          createdAt: new Date(Date.UTC(2026, 0, index + 1)),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.sokoBot.deleteMany({ where: { workspaceId } });
    await prisma.coworker.deleteMany({ where: { id: coworkerId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("reads each user summary once for one event and for several", async () => {
    const one = await list();
    for (let index = 1; index < 4; index += 1) {
      const userId = randomUUID();
      const botOwnerId = randomUUID();
      const botId = randomUUID();
      userIds.push(userId, botOwnerId);
      await prisma.user.create({
        data: {
          id: userId,
          name: `Actor ${index}`,
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.user.create({
        data: {
          id: botOwnerId,
          name: `Bot owner ${index}`,
          email: `${botOwnerId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.sokoBot.create({
        data: {
          id: botId,
          userId: botOwnerId,
          workspaceId,
          name: `Later bot ${index}`,
        },
      });
      const task = await prisma.task.findFirstOrThrow({
        where: { workspaceId, assigneeId: coworkerId },
        select: { id: true },
      });
      await prisma.taskEvent.create({
        data: {
          taskId: task.id,
          status: "RUNNING",
          comment: `Note ${index}`,
          userId,
          sokoBotId: botId,
          createdAt: new Date(Date.UTC(2026, 0, index + 1)),
        },
      });
    }
    const many = await list();

    expect(one.body.data.map((event) => event.comment)).toEqual(["Note 0"]);
    expect(many.body.data.map((event) => event.comment)).toEqual([
      "Note 0",
      "Note 1",
      "Note 2",
      "Note 3",
    ]);
    expect(many.sql).toBe(one.sql);
    expect(one.reads, "user summary queries for one event").toBe(1);
    expect(many.reads, "user summary queries for several events").toBe(1);
  });
});
