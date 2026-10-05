import { randomUUID } from "node:crypto";
import {
  TaskStatus,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostCoworkerMeUsage from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

// The low-balance notice runs after the response and is not under test.
vi.mock("@/helpers/billing-notifications", () => ({
  notifyLowBalanceAfterCharge: async () => undefined,
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const vendorId = randomUUID();
const coworkerId = randomUUID();
const userIds: string[] = [];
const organizationIds: string[] = [];

/** A user with a personal workspace and 10 personal credits. */
async function createBillableUser(): Promise<{
  userId: string;
  workspaceId: string;
}> {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  userIds.push(userId);

  await prisma.user.create({
    data: {
      id: userId,
      name: "Coworker usage binding fixture",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      workspace: { create: { id: workspaceId } },
    },
  });
  await prisma.transaction.create({
    data: {
      amount: convertCreditsToCents(10),
      userId,
      sourceCreditBucket: {
        create: { amount: convertCreditsToCents(10), userId },
      },
    },
  });

  return { userId, workspaceId };
}

/** A member of a free organization whose pool holds 10 credits. */
async function createBillableOrganizationMember(): Promise<{
  userId: string;
  organizationId: string;
  organizationWorkspaceId: string;
}> {
  const { userId } = await createBillableUser();
  const organizationId = randomUUID();
  const organizationWorkspaceId = randomUUID();
  organizationIds.push(organizationId);

  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Coworker usage binding org",
      slug: `usage-binding-${organizationId}`,
      members: { create: { userId, role: "member" } },
      workspace: { create: { id: organizationWorkspaceId } },
    },
  });
  await prisma.transaction.create({
    data: {
      amount: convertCreditsToCents(10),
      organizationId,
      sourceCreditBucket: {
        create: { amount: convertCreditsToCents(10), organizationId },
      },
    },
  });

  return { userId, organizationId, organizationWorkspaceId };
}

async function setGrant(workspaceId: string, status: VendorGrantStatus) {
  await prisma.vendorGrant.create({
    data: {
      vendorId,
      workspaceId,
      permission: VendorPermission.workspace,
      status,
    },
  });
}

async function assignTask(userId: string, workspaceId: string) {
  await prisma.task.create({
    data: {
      ownerId: userId,
      creatorUserId: userId,
      workspaceId,
      name: "Assigned to the coworker",
      status: TaskStatus.READY,
      assigneeId: coworkerId,
    },
  });
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "coworker-usage-binding");
    c.set("isAuthenticated", true);
    c.set("authContext", { actor: "coworker", coworkerId, vendorId });
    await next();
  });
  app.onError(errorHandler);
  mountPostCoworkerMeUsage(app);
  return app;
}

async function postUsage(userId: string, organizationId: string | null = null) {
  return await createApp().request("http://localhost/me/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      credits: 2.5,
      userId,
      organizationId,
    }),
  });
}

async function debitsOf(userId: string, organizationId: string | null = null) {
  return await prisma.transaction.count({
    where: { userId, organizationId, amount: { lt: 0 } },
  });
}

// Real Prisma, migrations and the real binding policy. Only auth is a fixture.
describe.skipIf(!enabled)(
  "POST /me/usage binds the billed user to the coworker",
  () => {
    beforeAll(async () => {
      await prisma.vendor.create({
        data: {
          id: vendorId,
          name: "Usage binding vendor",
          slug: `usage-binding-${vendorId}`,
          coworkers: {
            create: {
              id: coworkerId,
              slug: `usage-binding-${coworkerId}`,
              name: "Usage binding coworker",
              capabilities: ["tasks"],
            },
          },
        },
      });
    });

    afterAll(async () => {
      await prisma.coworkerUsage.deleteMany({ where: { coworkerId } });
      await prisma.task.deleteMany({ where: { assigneeId: coworkerId } });
      await prisma.vendorGrant.deleteMany({ where: { vendorId } });
      await prisma.transaction.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      await prisma.workspace.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.coworker.deleteMany({ where: { id: coworkerId } });
      await prisma.vendor.deleteMany({ where: { id: vendorId } });
      await prisma.$disconnect();
    });

    it("rejects billing a user whose workspace has no grant or task for the coworker's vendor", async () => {
      const { userId } = await createBillableUser();

      const response = await postUsage(userId);

      expect(response.status).toBe(403);
      expect(await debitsOf(userId)).toBe(0);
      expect(await prisma.coworkerUsage.count({ where: { userId } })).toBe(0);
    });

    it.each([
      [VendorGrantStatus.DENIED, "grant_denied"],
      [VendorGrantStatus.REVOKED, "grant_revoked"],
    ])(
      "rejects a %s grant even with an assigned task",
      async (status, kind) => {
        const { userId, workspaceId } = await createBillableUser();
        await setGrant(workspaceId, status);
        await assignTask(userId, workspaceId);

        const response = await postUsage(userId);

        expect(response.status).toBe(403);
        expect((await response.json()).kind).toBe(kind);
        expect(await debitsOf(userId)).toBe(0);
      },
    );

    it("bills a user whose workspace granted the vendor access", async () => {
      const { userId, workspaceId } = await createBillableUser();
      await setGrant(workspaceId, VendorGrantStatus.GRANTED);

      const response = await postUsage(userId);

      expect(response.status).toBe(201);
      expect(await debitsOf(userId)).toBe(1);
    });

    it("bills a user who assigned the coworker a task", async () => {
      const { userId, workspaceId } = await createBillableUser();
      await assignTask(userId, workspaceId);

      const response = await postUsage(userId);
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.data).toMatchObject({ userId, coworkerId, credits: 2.5 });
      expect(await debitsOf(userId)).toBe(1);
    });

    it("rejects billing an organization member whose workspace has no grant or task for the coworker's vendor", async () => {
      const { userId, organizationId } =
        await createBillableOrganizationMember();

      const response = await postUsage(userId, organizationId);

      expect(response.status).toBe(403);
      expect(await debitsOf(userId, organizationId)).toBe(0);
    });

    it("bills the organization pool when the organization workspace granted the vendor access", async () => {
      const { userId, organizationId, organizationWorkspaceId } =
        await createBillableOrganizationMember();
      await setGrant(organizationWorkspaceId, VendorGrantStatus.GRANTED);

      const response = await postUsage(userId, organizationId);
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body.data).toMatchObject({ userId, organizationId });
      expect(await debitsOf(userId, organizationId)).toBe(1);
      expect(await debitsOf(userId)).toBe(0);
    });
  },
);
