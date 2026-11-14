import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import mountProjectTaskDelete from "@/routes/v1/projects/[id]/tasks/[taskId]/delete";
import mountProjectTaskPost from "@/routes/v1/projects/[id]/tasks/post";
import mountTaskPatch from "@/routes/v1/tasks/[id]/patch";
import mountTaskWorkspacePut from "@/routes/v1/tasks/[id]/workspace/put";
import {
  createTaskScheduleTestApp,
  jsonRequest,
} from "@/test-fixtures/task-schedule-app";
import { updateTaskForActor } from "./task-domain.service";

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/helpers/calendar-invalidation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/calendar-invalidation")>()),
  deliverCalendarInvalidationsNow: vi.fn(async () => undefined),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const ownerId = randomUUID(),
  memberId = randomUUID(),
  organizationId = randomUUID(),
  workspaceId = randomUUID();
const auditId = randomUUID(),
  unlinkedAuditId = randomUUID(),
  personalWorkspaceId = randomUUID(),
  projectId = randomUUID(),
  otherProjectId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = randomUUID(),
  otherCoworkerId = randomUUID();
const botId = randomUUID();
const pageUrl = "https://example.test/";

function packet(requestId: string, maxProviderCalls = 20) {
  return {
    version: 1,
    requestId,
    kind: "rankings",
    pageUrls: [pageUrl],
    competitorUrls: [],
    keywords: ["example"],
    countryCode: "US",
    languageCode: "en",
    devices: ["desktop"],
    budget: {
      maxPages: 1,
      maxKeywords: 1,
      maxCompetitors: 0,
      maxProviderCalls,
    },
  };
}

async function seedTask(
  linked = true,
  initialProjectId: string | null = projectId,
) {
  const analysisId = randomUUID();
  const request = packet(analysisId);
  const task = await prisma.task.create({
    data: {
      ownerId,
      organizationId,
      workspaceId,
      projectId: initialProjectId,
      assigneeId: coworkerId,
      creatorUserId: ownerId,
      name: "SEO rankings",
      status: "READY",
      visibility: "PUBLIC",
      description: linked
        ? `seo_job: ${JSON.stringify(request)}`
        : "An ordinary editable brief",
    },
  });
  if (linked)
    await prisma.projectSeoAnalysis.create({
      data: {
        id: analysisId,
        auditId: initialProjectId === null ? unlinkedAuditId : auditId,
        idempotencyKey: randomUUID(),
        requestHash: "frozen-execution-test",
        kind: "rankings",
        taskId: task.id,
        pageIds: [],
        request,
        requestedBy: ownerId,
      },
    });
  return {
    task,
    changedDescription: `seo_job: ${JSON.stringify(packet(analysisId, 100))}`,
  };
}

function patch(
  taskId: string,
  body: Record<string, unknown>,
  userId = ownerId,
) {
  return createTaskScheduleTestApp(
    mountTaskPatch,
    { actor: "user", userId, organizationId, role: "user" },
    { workspaceId, userId: null, organizationId },
  ).request(`http://localhost/${taskId}`, jsonRequest("PATCH", body));
}

function projectLink(
  taskId: string,
  action: "add" | "unlink",
  userId = ownerId,
) {
  const app = createTaskScheduleTestApp(
    action === "add" ? mountProjectTaskPost : mountProjectTaskDelete,
    { actor: "user", userId, organizationId, role: "user" },
    { workspaceId, userId: null, organizationId },
  );
  return app.request(
    action === "add"
      ? `http://localhost/${projectId}/tasks`
      : `http://localhost/${projectId}/tasks/${taskId}`,
    action === "add" ? jsonRequest("POST", { taskId }) : jsonRequest("DELETE"),
  );
}

function moveToPersonalWorkspace(taskId: string) {
  return createTaskScheduleTestApp(
    mountTaskWorkspacePut,
    { actor: "user", userId: ownerId, organizationId, role: "user" },
    { workspaceId, userId: null, organizationId },
  ).request(
    `http://localhost/${taskId}/workspace`,
    jsonRequest("PUT", { organizationId: null }),
  );
}
function domain(
  taskId: string,
  fields: {
    description?: string;
    projectId?: string;
    assigneeId?: string;
    name?: string;
  },
  userId = ownerId,
) {
  return prisma.$transaction((tx) =>
    updateTaskForActor(
      {
        actor:
          userId === ownerId
            ? { kind: "user", userId }
            : { kind: "soko_bot", sokoBotId: botId },
        userId,
        workspaceId,
        taskId,
        intent: "metadata",
        ...fields,
      },
      tx,
    ),
  );
}

describe.skipIf(!enabled)(
  "Frozen SEO Task execution through the metadata entrypoints",
  () => {
    beforeAll(async () => {
      const now = new Date();
      for (const id of [ownerId, memberId])
        await prisma.user.create({
          data: {
            id,
            name: "SEO metadata fixture",
            email: `${id}@example.test`,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          },
        });
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "SEO metadata fixture",
          slug: organizationId,
          workspace: { create: { id: workspaceId } },
          members: {
            create: [ownerId, memberId].map((userId) => ({
              userId,
              seatAssignedAt: now,
            })),
          },
        },
      });
      for (const id of [projectId, otherProjectId])
        await prisma.project.create({
          data: {
            id,
            workspaceId,
            name: "SEO metadata fixture",
            contextMdUrl: "https://example.test/context.md",
          },
        });
      await prisma.seoAudit.create({
        data: {
          id: auditId,
          workspaceId,
          projectId,
          createdById: ownerId,
          name: "SEO metadata fixture",
        },
      });
      await prisma.seoAudit.create({
        data: {
          id: unlinkedAuditId,
          workspaceId,
          createdById: ownerId,
          name: "SEO metadata fixture without Project",
        },
      });
      await prisma.workspace.create({
        data: { id: personalWorkspaceId, userId: ownerId },
      });
      await prisma.vendor.create({
        data: { id: vendorId, name: "SEO metadata fixture", slug: vendorId },
      });
      for (const id of [coworkerId, otherCoworkerId])
        await prisma.coworker.create({
          data: {
            id,
            vendorId,
            name: "SEO metadata fixture",
            slug: id,
            isWhitelisted: true,
            capabilities: ["tasks"],
          },
        });
    });
    afterAll(async () => {
      await prisma.task.deleteMany({
        where: { workspaceId: { in: [workspaceId, personalWorkspaceId] } },
      });
      await prisma.workspace.deleteMany({ where: { id: personalWorkspaceId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({
        where: { id: { in: [ownerId, memberId] } },
      });
      await prisma.coworker.deleteMany({
        where: { id: { in: [coworkerId, otherCoworkerId] } },
      });
      await prisma.vendor.deleteMany({ where: { id: vendorId } });
      await prisma.$disconnect();
    });

    it.each(["owner", "member"] as const)(
      "refuses a widened paid packet through human PATCH by the %s",
      async (viewer) => {
        const { task, changedDescription } = await seedTask();
        const response = await patch(
          task.id,
          { description: changedDescription },
          viewer === "owner" ? ownerId : memberId,
        );
        expect(response.status).toBe(409);
        expect(
          (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
            .description,
        ).toBe(task.description);
      },
    );
    it.each([
      ["add", "owner"],
      ["add", "member"],
      ["unlink", "owner"],
      ["unlink", "member"],
    ] as const)(
      "refuses Project %s of a frozen SEO Task by the %s",
      async (action, viewer) => {
        const initialProjectId = action === "add" ? null : projectId;
        const { task } = await seedTask(true, initialProjectId);
        const response = await projectLink(
          task.id,
          action,
          viewer === "owner" ? ownerId : memberId,
        );
        expect(response.status).toBe(409);
        expect(
          (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
            .projectId,
        ).toBe(initialProjectId);
      },
    );
    it.each(["add", "unlink"] as const)(
      "keeps ordinary Task Project %s available",
      async (action) => {
        const { task } = await seedTask(
          false,
          action === "add" ? null : projectId,
        );
        const response = await projectLink(task.id, action, memberId);
        expect(response.status).toBe(200);
        expect(
          (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
            .projectId,
        ).toBe(action === "add" ? projectId : null);
      },
    );
    it("refuses moving a frozen SEO Task without a Project to another workspace", async () => {
      const { task } = await seedTask(true, null);
      const response = await moveToPersonalWorkspace(task.id);
      expect(response.status).toBe(409);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
          .workspaceId,
      ).toBe(workspaceId);
    });
    it("keeps ordinary Task workspace transfers available", async () => {
      const { task } = await seedTask(false, null);
      const response = await moveToPersonalWorkspace(task.id);
      expect(response.status).toBe(200);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
          .workspaceId,
      ).toBe(personalWorkspaceId);
    });
    it.each(["owner", "member_bot"] as const)(
      "refuses a widened paid packet through the %s domain update",
      async (viewer) => {
        const { task, changedDescription } = await seedTask();
        await expect(
          domain(
            task.id,
            { description: changedDescription },
            viewer === "owner" ? ownerId : memberId,
          ),
        ).rejects.toMatchObject({ status: 409 });
        expect(
          (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
            .description,
        ).toBe(task.description);
      },
    );
    it.each(["executor", "project"] as const)(
      "keeps the approved %s through human PATCH",
      async (field) => {
        const { task } = await seedTask();
        const response = await patch(
          task.id,
          field === "executor"
            ? { assigneeId: otherCoworkerId }
            : { projectId: otherProjectId },
        );
        expect(response.status).toBe(409);
        expect(
          await prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
        ).toMatchObject({ assigneeId: coworkerId, projectId });
      },
    );
    it.each(["executor", "project"] as const)(
      "keeps the approved %s through a domain update",
      async (field) => {
        const { task } = await seedTask();
        await expect(
          domain(
            task.id,
            field === "executor"
              ? { assigneeId: otherCoworkerId }
              : { projectId: otherProjectId },
          ),
        ).rejects.toMatchObject({ status: 409 });
      },
    );
    it("keeps the approved project through a Soko Bot's project-only shortcut", async () => {
      const { task } = await seedTask();
      await expect(
        prisma.$transaction((tx) =>
          updateTaskForActor(
            {
              actor: { kind: "soko_bot", sokoBotId: botId },
              userId: memberId,
              workspaceId,
              taskId: task.id,
              intent: "metadata",
              expectedUpdatedAt: task.updatedAt,
              projectId: otherProjectId,
            },
            tx,
          ),
        ),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("checks the resolved description when Context rewrites it without a description field", async () => {
      const { task } = await seedTask();
      const response = await patch(task.id, {
        context: { brand: false, briefing: false, memory: true },
      });
      expect(response.status).toBe(409);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
          .description,
      ).toBe(task.description);
    });
    it.each(["human", "domain"] as const)(
      "keeps ordinary Task metadata editable through %s",
      async (entrypoint) => {
        const { task } = await seedTask(false);
        if (entrypoint === "human")
          expect(
            (await patch(task.id, { description: "Changed ordinary brief" }))
              .status,
          ).toBe(200);
        else await domain(task.id, { description: "Changed ordinary brief" });
        expect(
          (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
            .description,
        ).toBe("Changed ordinary brief");
      },
    );
    it.each(["human", "domain"] as const)(
      "allows an unchanged packet and unrelated metadata through %s",
      async (entrypoint) => {
        const { task } = await seedTask();
        if (entrypoint === "human")
          expect(
            (
              await patch(task.id, {
                description: task.description,
                name: "Renamed",
              })
            ).status,
          ).toBe(200);
        else
          await domain(task.id, {
            description: task.description ?? undefined,
            name: "Renamed",
          });
        expect(
          await prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
        ).toMatchObject({ description: task.description, name: "Renamed" });
      },
    );
  },
);
