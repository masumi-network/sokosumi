import assert from "node:assert/strict";
import {
  GrantResumeStatus,
  TaskStatus,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, it } from "vitest";

import {
  approveVendorGrantInWorkspace,
  requestWorkspaceGrant,
} from "./vendor-grants";

const databaseUrl = process.env.DATABASE_URL;
const shouldRunDatabaseTests =
  Boolean(databaseUrl) && process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

const describeDatabase = shouldRunDatabaseTests ? describe : describe.skip;
const prisma = databaseUrl ? createPrismaClient(databaseUrl) : null;

interface SeedContext {
  userId: string;
  workspaceId: string;
  vendorId: string;
  coworkerId: string;
}

async function seedVendorWorkspaceContext(
  suffix: string,
): Promise<SeedContext> {
  assert.ok(prisma);

  const userId = `vg-int-user-${suffix}`;
  const vendorId = crypto.randomUUID();
  const coworkerId = `vg-int-cow-${suffix}`;
  const email = `vg-int-${suffix}@example.test`;

  const rows = await prisma.$queryRaw<Array<{ workspaceId: string }>>`
    WITH created_user AS (
      INSERT INTO "user" (
        "id",
        "name",
        "email",
        "emailVerified",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${userId},
        'Vendor Grant Integration User',
        ${email},
        true,
        NOW(),
        NOW()
      )
      RETURNING "id"
    ),
    created_workspace AS (
      INSERT INTO "workspace" (
        "id",
        "createdAt",
        "updatedAt",
        "userId"
      )
      SELECT gen_random_uuid(), NOW(), NOW(), "id"
      FROM created_user
      RETURNING "id"
    ),
    created_vendor AS (
      INSERT INTO "vendor" (
        "id",
        "createdAt",
        "updatedAt",
        "name",
        "slug"
      )
      VALUES (
        ${vendorId}::uuid,
        NOW(),
        NOW(),
        ${`Vendor ${suffix}`},
        ${`vendor-${suffix}`}
      )
      RETURNING "id"
    ),
    created_coworker AS (
      INSERT INTO "coworker" (
        "id",
        "createdAt",
        "updatedAt",
        "slug",
        "name",
        "userId",
        "vendorId"
      )
      SELECT
        ${coworkerId},
        NOW(),
        NOW(),
        ${`coworker-${suffix}`},
        'Integration Coworker',
        (SELECT "id" FROM created_user),
        (SELECT "id" FROM created_vendor)
      RETURNING "id"
    )
    SELECT "id" AS "workspaceId"
    FROM created_workspace
  `;

  return {
    userId,
    workspaceId: rows[0]?.workspaceId ?? "",
    vendorId,
    coworkerId,
  };
}

async function cleanupSeedContext(context: SeedContext): Promise<void> {
  assert.ok(prisma);

  await prisma.$executeRaw`
    DELETE FROM "task"
    WHERE "workspaceId" = ${context.workspaceId}::uuid
  `;
  await prisma.$executeRaw`
    DELETE FROM "vendor_grant"
    WHERE "workspaceId" = ${context.workspaceId}::uuid
  `;
  await prisma.$executeRaw`
    DELETE FROM "coworker"
    WHERE "id" = ${context.coworkerId}
  `;
  await prisma.$executeRaw`
    DELETE FROM "vendor"
    WHERE "id" = ${context.vendorId}::uuid
  `;
  await prisma.$executeRaw`
    DELETE FROM "workspace"
    WHERE "id" = ${context.workspaceId}::uuid
  `;
  await prisma.$executeRaw`
    DELETE FROM "user"
    WHERE "id" = ${context.userId}
  `;
}

describeDatabase("vendor grants database integration", () => {
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("recovers from concurrent requestWorkspaceGrant unique violations", async () => {
    assert.ok(prisma);

    const suffix = crypto.randomUUID();
    const context = await seedVendorWorkspaceContext(suffix);

    try {
      const [first, second] = await Promise.all([
        prisma.$transaction((tx) =>
          requestWorkspaceGrant(
            {
              vendorId: context.vendorId,
              workspaceId: context.workspaceId,
              requestedByUserId: context.userId,
              notify: false,
            },
            tx,
          ),
        ),
        prisma.$transaction((tx) =>
          requestWorkspaceGrant(
            {
              vendorId: context.vendorId,
              workspaceId: context.workspaceId,
              requestedByUserId: context.userId,
              notify: false,
            },
            tx,
          ),
        ),
      ]);

      assert.equal(first.grant.id, second.grant.id);
      assert.equal(
        Number(first.created) + Number(second.created),
        1,
        "exactly one concurrent request should create the grant",
      );

      const grants = await prisma.vendorGrant.findMany({
        where: {
          vendorId: context.vendorId,
          workspaceId: context.workspaceId,
        },
      });

      assert.equal(grants.length, 1);
      assert.equal(grants[0]?.status, VendorGrantStatus.PENDING);
      assert.equal(grants[0]?.permission, VendorPermission.workspace);
    } finally {
      await cleanupSeedContext(context);
    }
  });

  it("unparks tasks when approveVendorGrantInWorkspace commits", async () => {
    assert.ok(prisma);

    const suffix = crypto.randomUUID();
    const context = await seedVendorWorkspaceContext(suffix);
    const taskId = `vg-int-task-${suffix}`;

    try {
      const { grant } = await requestWorkspaceGrant({
        vendorId: context.vendorId,
        workspaceId: context.workspaceId,
        requestedByUserId: context.userId,
        notify: false,
      });

      await prisma.task.create({
        data: {
          id: taskId,
          userId: context.userId,
          workspaceId: context.workspaceId,
          coworkerId: context.coworkerId,
          name: "Parked integration task",
          description: "Awaiting vendor grant",
          status: TaskStatus.GRANT_PENDING,
          grantResumeStatus: GrantResumeStatus.READY,
          pendingVendorGrantId: grant.id,
        },
      });

      await prisma.$transaction((tx) =>
        approveVendorGrantInWorkspace(
          {
            grantId: grant.id,
            workspaceId: context.workspaceId,
            resolvedById: context.userId,
          },
          tx,
        ),
      );

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { pendingVendorGrantId: true, status: true },
      });
      const updatedGrant = await prisma.vendorGrant.findUnique({
        where: { id: grant.id },
        select: { status: true },
      });

      assert.equal(task?.pendingVendorGrantId, null);
      assert.equal(task?.status, TaskStatus.READY);
      assert.equal(updatedGrant?.status, VendorGrantStatus.GRANTED);
    } finally {
      await cleanupSeedContext(context);
    }
  });

  it("keeps approve and requestWorkspaceGrant serialized under row locks", async () => {
    assert.ok(prisma);

    const suffix = crypto.randomUUID();
    const context = await seedVendorWorkspaceContext(suffix);
    const taskId = `vg-int-race-task-${suffix}`;

    try {
      const { grant } = await requestWorkspaceGrant({
        vendorId: context.vendorId,
        workspaceId: context.workspaceId,
        requestedByUserId: context.userId,
        notify: false,
      });

      await prisma.task.create({
        data: {
          id: taskId,
          userId: context.userId,
          workspaceId: context.workspaceId,
          coworkerId: context.coworkerId,
          name: "Race integration task",
          description: "Awaiting vendor grant",
          status: TaskStatus.GRANT_PENDING,
          grantResumeStatus: GrantResumeStatus.READY,
          pendingVendorGrantId: grant.id,
        },
      });

      await Promise.all([
        prisma.$transaction((tx) =>
          approveVendorGrantInWorkspace(
            {
              grantId: grant.id,
              workspaceId: context.workspaceId,
              resolvedById: context.userId,
            },
            tx,
          ),
        ),
        prisma.$transaction((tx) =>
          requestWorkspaceGrant(
            {
              vendorId: context.vendorId,
              workspaceId: context.workspaceId,
              requestedByUserId: context.userId,
              notify: false,
            },
            tx,
          ),
        ),
      ]);

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { pendingVendorGrantId: true, status: true },
      });
      const updatedGrant = await prisma.vendorGrant.findUnique({
        where: { id: grant.id },
        select: { status: true },
      });
      const grantCount = await prisma.vendorGrant.count({
        where: {
          vendorId: context.vendorId,
          workspaceId: context.workspaceId,
        },
      });

      assert.equal(task?.pendingVendorGrantId, null);
      assert.equal(task?.status, TaskStatus.READY);
      assert.equal(updatedGrant?.status, VendorGrantStatus.GRANTED);
      assert.equal(grantCount, 1);
    } finally {
      await cleanupSeedContext(context);
    }
  });
});
