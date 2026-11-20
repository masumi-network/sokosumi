import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
import mountPatchTask from "./[id]/patch";
import mountGetTasks from "./get";
import mountPostTask from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
  publishTaskEventData: vi.fn(),
}));

// Seats are not under test here; inline tag classification would call out.
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      TASK_TAG_CLASSIFICATION_ENABLED: false,
    }),
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const adaId = randomUUID();
const organizationId = randomUUID();
const personalWorkspaceId = randomUUID();
const organizationWorkspaceId = randomUUID();
const vendorId = randomUUID();
const coworkerId = randomUUID();
const personalBotId = randomUUID();
const organizationBotId = randomUUID();

const workspaces = [
  {
    kind: "personal",
    workspaceId: personalWorkspaceId,
    organizationId: null,
    sokoBotId: personalBotId,
  },
  {
    kind: "organization",
    workspaceId: organizationWorkspaceId,
    organizationId,
    sokoBotId: organizationBotId,
  },
] as const;

type Workspace = (typeof workspaces)[number];

const actors = {
  person: (ws: Workspace): AuthenticationContext => ({
    actor: "user",
    userId: adaId,
    organizationId: ws.organizationId,
    role: "user",
    authenticationMethod: "session",
  }),
  coworker: (ws: Workspace): AuthenticationContext => ({
    actor: "coworker",
    coworkerId,
    vendorId,
    context: { userId: adaId, organizationId: ws.organizationId },
  }),
  sokoBot: (ws: Workspace): AuthenticationContext => ({
    actor: "sokoBot",
    scope: "personal",
    sokoBotId: ws.sokoBotId,
    userId: adaId,
    workspaceId: ws.workspaceId,
    organizationId: ws.organizationId,
  }),
};

async function createTask(
  ws: Workspace,
  authContext: AuthenticationContext,
  extra: Record<string, unknown> = {},
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "task-creator-owner");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: ws.workspaceId,
      userId: ws.organizationId ? null : adaId,
      organizationId: ws.organizationId,
    });
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, 500));
  mountPostTask(app);

  const response = await app.request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Prepare the board pack", ...extra }),
  });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body.data;
}

const ada = { id: adaId, name: "Ada Lovelace", image: null };

// Real Prisma, migrations and HTTP serialization. Only auth is a fixture.
describe.skipIf(!enabled)(
  "POST /tasks records who made the Task and who owns it",
  () => {
    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: adaId,
          name: ada.name,
          email: `${adaId}@example.test`,
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
          members: { create: { userId: adaId, role: "owner" } },
          workspace: { create: { id: organizationWorkspaceId } },
        },
      });
      await prisma.vendor.create({
        data: {
          id: vendorId,
          name: "Vendor",
          slug: `vendor-${vendorId}`,
          coworkers: {
            create: {
              id: coworkerId,
              name: "Ops Agent",
              slug: `ops-${coworkerId}`,
            },
          },
          vendorGrants: {
            create: workspaces.map((ws) => ({
              workspaceId: ws.workspaceId,
              permission: "workspace",
              status: "GRANTED",
            })),
          },
        },
      });
      for (const ws of workspaces) {
        await prisma.sokoBot.create({
          data: {
            id: ws.sokoBotId,
            userId: adaId,
            workspaceId: ws.workspaceId,
            name: "Atlas",
          },
        });
      }
    });

    afterAll(async () => {
      const workspaceIds = workspaces.map((ws) => ws.workspaceId);
      await prisma.task.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await prisma.sokoBot.deleteMany({
        where: { id: { in: workspaces.map((ws) => ws.sokoBotId) } },
      });
      await prisma.coworker.deleteMany({ where: { id: coworkerId } });
      await prisma.vendor.deleteMany({ where: { id: vendorId } });
      await prisma.workspace.deleteMany({
        where: { id: { in: workspaceIds } },
      });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: adaId } });
      await prisma.$disconnect();
    });

    it("keeps dismissed topics out of filtered GETs after another classification", async () => {
      const ws = workspaces[0];
      const actor = actors.person(ws);
      const task = await createTask(ws, actor);
      const workspace = {
        workspaceId: ws.workspaceId,
        userId: adaId,
        organizationId: null,
      };
      const list = createTaskScheduleTestApp(mountGetTasks, actor, workspace);
      const edit = createTaskScheduleTestApp(mountPatchTask, actor, workspace);
      async function matches(topicId: string) {
        const response = await list.request(`/?topicTagId=${topicId}`);
        expect(response.status).toBe(200);
        const body = await response.json();
        return body.data.some((row: { id: string }) => row.id === task.id);
      }
      await prisma.task.update({
        where: { id: task.id },
        data: {
          automaticTags: ["research"],
          manualTags: ["design"],
          rejectedTags: ["strategy"],
        },
      });
      expect(await matches("design")).toBe(true);
      expect(await matches("research")).toBe(true);
      const dismiss = () =>
        edit.request(
          `/${task.id}`,
          jsonRequest("PATCH", {
            dismissedTopicIds: ["research", "design"],
          }),
        );
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await dismiss();
        expect(response.status).toBe(200);
        expect((await response.json()).data.tags).toEqual({
          automatic: [],
          manual: [],
          rejected: ["strategy", "research", "design"],
        });
      }
      await prisma.task.update({
        where: { id: task.id },
        data: { name: "New content revision" },
      });
      await prisma.task.update({
        where: { id: task.id },
        data: {
          automaticTags: ["design", "research", "writing"],
          tagClassificationState: "complete",
        },
      });
      expect(await matches("research")).toBe(false);
      expect(await matches("design")).toBe(false);
      expect(await matches("writing")).toBe(true);
    });

    it("stores the due date given at create", async () => {
      const ws = workspaces[0];
      const task = await createTask(ws, actors.person(ws), {
        dueOn: "2026-11-20",
      });

      expect(task.dueOn).toBe("2026-11-20");
      const row = await prisma.task.findUniqueOrThrow({
        where: { id: task.id },
        select: { dueOn: true },
      });
      expect(row.dueOn?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    });

    describe.each(workspaces)("in a $kind workspace", (ws) => {
      it("returns a person as Creator and Owner when they make their own Task", async () => {
        const task = await createTask(ws, actors.person(ws));

        expect(task.creator).toEqual({ type: "user", id: adaId, user: ada });
        expect(task.participants).toEqual([]);
        expect(task.ownerId).toBe(adaId);
      });

      it("returns the Coworker as Creator and the person as Owner", async () => {
        const task = await createTask(ws, actors.coworker(ws));

        expect(task.creator).toMatchObject({
          type: "coworker",
          id: coworkerId,
        });
        expect(task.owner).toEqual(ada);
        expect(task.participants).toEqual([]);
        expect(task.ownerId).toBe(adaId);
      });

      it("returns the Soko Bot as Creator and the person as Owner", async () => {
        const task = await createTask(ws, actors.sokoBot(ws));

        expect(task.creator).toMatchObject({
          type: "sokoBot",
          id: ws.sokoBotId,
        });
        expect(task.owner).toEqual(ada);
        expect(task.participants).toEqual([]);
        expect(task.ownerId).toBe(adaId);
      });
    });
  },
);
