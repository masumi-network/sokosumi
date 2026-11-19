import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import { createTaskScheduleTestApp } from "@/test-fixtures/task-schedule-app";
import mountGetTask from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const ownerId = randomUUID(),
  seatlessId = randomUUID(),
  organizationId = randomUUID(),
  workspaceId = randomUUID(),
  personalWorkspaceId = randomUUID(),
  projectId = randomUUID(),
  auditId = randomUUID(),
  deletedAuditId = randomUUID(),
  personalAuditId = randomUUID();

type Owner = { auditId: string } | { projectId: string } | null;

async function seedTask(owner: Owner) {
  const task = await prisma.task.create({
    data: {
      ownerId,
      organizationId,
      workspaceId,
      creatorUserId: ownerId,
      name: "SEO audit full",
      status: "COMPLETED",
      visibility: "PUBLIC",
    },
  });
  if (owner)
    await prisma.projectSeoAnalysis.create({
      data: {
        ...owner,
        idempotencyKey: randomUUID(),
        requestHash: "task-audit-link-test",
        kind: "audit_full",
        taskId: task.id,
        pageIds: [],
        request: {},
        requestedBy: ownerId,
      },
    });
  return task.id;
}

async function readSeoAudit(taskId: string, userId = ownerId) {
  const response = await createTaskScheduleTestApp(
    mountGetTask,
    { actor: "user", userId, organizationId, role: "user" },
    { workspaceId, userId: null, organizationId },
  ).request(`http://localhost/${taskId}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: { seoAudit: unknown } }).data
    .seoAudit;
}

describe.skipIf(!enabled)("GET /tasks/{id} SEO audit link", () => {
  beforeAll(async () => {
    const now = new Date();
    for (const id of [ownerId, seatlessId])
      await prisma.user.create({
        data: {
          id,
          name: "SEO link fixture",
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "SEO link fixture",
        slug: organizationId,
        workspace: { create: { id: workspaceId } },
        members: {
          create: [
            { userId: ownerId, seatAssignedAt: now },
            { userId: seatlessId },
          ],
        },
      },
    });
    // A plan with seats: on a free plan every member counts as seated.
    await prisma.enterpriseContract.create({
      data: {
        organizationId,
        status: "active",
        activatedAt: now,
        periodCount: 1,
        seats: 1,
        centsPerMonth: 0n,
      },
    });
    await prisma.workspace.create({
      data: { id: personalWorkspaceId, userId: ownerId },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        workspaceId,
        name: "SEO link fixture",
        contextMdUrl: "https://example.test/context.md",
      },
    });
    for (const [id, auditWorkspaceId, deletedAt] of [
      [auditId, workspaceId, null],
      [deletedAuditId, workspaceId, now],
      [personalAuditId, personalWorkspaceId, null],
    ] as const)
      await prisma.seoAudit.create({
        data: {
          id,
          workspaceId: auditWorkspaceId,
          projectId: auditWorkspaceId === workspaceId ? projectId : null,
          createdById: ownerId,
          name: "SEO link fixture",
          deletedAt,
        },
      });
  });
  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: personalWorkspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, seatlessId] } },
    });
    await prisma.$disconnect();
  });

  it("links an audit Task to its audit and the audit's Project", async () => {
    expect(await readSeoAudit(await seedTask({ auditId }))).toEqual({
      auditId,
      projectId,
    });
  });
  it("links a Project analysis Task to the Project SEO workspace", async () => {
    expect(await readSeoAudit(await seedTask({ projectId }))).toEqual({
      auditId: null,
      projectId,
    });
  });
  it("returns null for a Task without an SEO analysis", async () => {
    expect(await readSeoAudit(await seedTask(null))).toBeNull();
  });
  it("returns null for a deleted audit", async () => {
    expect(
      await readSeoAudit(await seedTask({ auditId: deletedAuditId })),
    ).toBeNull();
  });
  it("reads the Task for a member without a seat, with no audit link", async () => {
    // The SEO page refuses a member without a seat (403): the Task page still loads.
    expect(
      await readSeoAudit(await seedTask({ auditId }), seatlessId),
    ).toBeNull();
  });
  it("does not send an audit id from outside the active workspace", async () => {
    expect(
      await readSeoAudit(await seedTask({ auditId: personalAuditId })),
    ).toBeNull();
  });
});
