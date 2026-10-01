import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTaskWorkspaceMapping } from "@/helpers/access-control";
import { resolveTaskRefToId } from "@/helpers/task-ref";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const otherUserId = randomUUID();
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();

async function createUserWithWorkspace(user: string, workspace: string) {
  await prisma.user.create({
    data: {
      id: user,
      name: "Task ref fixture",
      email: `${user}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      workspace: { create: { id: workspace } },
    },
  });
}

async function createTask(owner: string, workspace: string, projectId: string) {
  const task = await prisma.task.create({
    data: {
      ownerId: owner,
      creatorUserId: owner,
      workspaceId: workspace,
      projectId,
      name: "Ref task",
    },
  });
  return task.id;
}

// Real Prisma against the migrated schema: composite-unique lookups by project
// identifier, task number and alias.
describe.skipIf(!enabled)("task ref resolution against PostgreSQL", () => {
  beforeAll(async () => {
    await createUserWithWorkspace(userId, workspaceId);
    await createUserWithWorkspace(otherUserId, otherWorkspaceId);
  });

  afterAll(async () => {
    await prisma.task.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.project.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId] } },
    });
    await prisma.$disconnect();
  });

  it("resolves identifiers, slugs and aliases only inside the given workspace", async () => {
    const home = await prisma.project.create({
      data: { workspaceId, name: "Home", identifier: "HOM" },
    });
    const away = await prisma.project.create({
      data: { workspaceId, name: "Away", identifier: "AWY" },
    });
    // Same identifier in another workspace must never resolve for this one.
    const foreign = await prisma.project.create({
      data: {
        workspaceId: otherWorkspaceId,
        name: "Foreign",
        identifier: "HOM",
      },
    });
    const first = await createTask(userId, workspaceId, home.id);
    const moved = await createTask(userId, workspaceId, home.id);
    const foreignTask = await createTask(
      otherUserId,
      otherWorkspaceId,
      foreign.id,
    );

    expect(await resolveTaskRefToId("HOM-1", workspaceId, prisma)).toBe(first);
    expect(
      await resolveTaskRefToId("hom-2-fix-login", workspaceId, prisma),
    ).toBe(moved);
    expect(await resolveTaskRefToId("HOM-1", otherWorkspaceId, prisma)).toBe(
      foreignTask,
    );

    await prisma.task.update({
      where: { id: moved },
      data: { projectId: away.id },
    });
    // Old identifier resolves through the alias; the new one is number 1 in AWY.
    expect(await resolveTaskRefToId("HOM-2", workspaceId, prisma)).toBe(moved);
    expect(await resolveTaskRefToId("AWY-1", workspaceId, prisma)).toBe(moved);

    // Unresolvable refs come back unchanged.
    expect(await resolveTaskRefToId("HOM-99", workspaceId, prisma)).toBe(
      "HOM-99",
    );
    expect(await resolveTaskRefToId("NOP-1", workspaceId, prisma)).toBe(
      "NOP-1",
    );
    expect(await resolveTaskRefToId(first, workspaceId, prisma)).toBe(first);
  });

  it("keeps GET /tasks/{id}/workspace UUID-only: an identifier is a plain 404", async () => {
    const project = await prisma.project.create({
      data: { workspaceId, name: "Only", identifier: "ONL" },
    });
    await createTask(userId, workspaceId, project.id);

    await expect(
      requireTaskWorkspaceMapping(
        {
          authContext: {
            actor: "user",
            userId,
            organizationId: null,
            role: "user",
          },
        } as never,
        "ONL-1",
        prisma,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
