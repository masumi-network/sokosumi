import { randomUUID } from "node:crypto";
import { TaskVisibility } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  requireTaskMoveAccess,
  requireTaskReadForWorkspace,
  requireTaskWriteAccess,
} from "@/helpers/access-control";
import prisma from "@/lib/db/prisma";
import type { UserContext } from "@/middleware/auth";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID();
const ownerId = randomUUID();
const memberId = randomUUID();
let organizationId: string;
let workspaceId: string;

function userContext(userId: string): UserContext {
  return { source: "context", userId, organizationId };
}

async function createUser(id: string) {
  await prisma.user.create({
    data: {
      id,
      name: "Private work fixture",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

// Real Prisma against the migrated schema: the filters decide who reaches a
// row, so they are checked where they run (ADR 0057).
describe.skipIf(!enabled)("private work against PostgreSQL", () => {
  beforeAll(async () => {
    await createUser(ownerId);
    await createUser(memberId);
    const organization = await prisma.organization.create({
      data: { name: "Private work", slug: `private-work-${suffix}` },
    });
    organizationId = organization.id;
    workspaceId = (await prisma.workspace.create({ data: { organizationId } }))
      .id;
    await prisma.member.createMany({
      data: [
        { userId: ownerId, organizationId, role: "member" },
        { userId: memberId, organizationId, role: "owner" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.member.deleteMany({ where: { organizationId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, memberId] } },
    });
    await prisma.$disconnect();
  });

  it("keeps a private Task readable, changeable and movable by its Owner alone", async () => {
    const task = await prisma.task.create({
      data: {
        ownerId,
        creatorUserId: ownerId,
        workspaceId,
        organizationId,
        name: "Private plan",
        visibility: TaskVisibility.PRIVATE,
      },
    });
    const workspace = { workspaceId, userId: null, organizationId };

    await expect(
      requireTaskReadForWorkspace(workspace, task.id, prisma, ownerId),
    ).resolves.toMatchObject({ id: task.id });
    await expect(
      requireTaskWriteAccess(userContext(ownerId), task.id, prisma),
    ).resolves.toMatchObject({ id: task.id });
    await expect(
      requireTaskMoveAccess(userContext(ownerId), task.id, prisma),
    ).resolves.toMatchObject({ id: task.id });

    // Even the Organization owner does not reach another member's private Task.
    await expect(
      requireTaskReadForWorkspace(workspace, task.id, prisma, memberId),
    ).rejects.toThrow("Task not found");
    await expect(
      requireTaskWriteAccess(userContext(memberId), task.id, prisma),
    ).rejects.toThrow("Task not found");
    await expect(
      requireTaskMoveAccess(userContext(memberId), task.id, prisma),
    ).rejects.toThrow("Task not found");
  });
});
