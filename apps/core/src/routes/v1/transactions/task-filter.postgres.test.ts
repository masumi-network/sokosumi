/**
 * Real-Postgres proof that a Transactions `taskId` filter reads only a Task
 * the caller may open. Mounts the real Transactions app, so organization,
 * workspace and seat middleware run against the migrated schema. Only the
 * session is a trusted fixture.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/routes/v1/transactions/task-filter.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import { NETWORK_HEADER } from "@/middleware/network-scope";
import { onSplitLayout } from "@/test/split-layout";

import transactionsApp from "./index";

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

const memberA = randomUUID();
const memberB = randomUUID();
const outsider = randomUUID();
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const publicTaskId = randomUUID();
const privateTaskId = randomUUID();
const otherOrganizationTaskId = randomUUID();
const userIds = [memberA, memberB, outsider];
const taskIds = [publicTaskId, privateTaskId, otherOrganizationTaskId];
const transactionIds = taskIds.map(() => randomUUID());
const eventIds = taskIds.map(() => randomUUID());
const billingScope = createNetworkScope("mainnet");

/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;

function appFor(userId: string, activeOrganizationId: string) {
  const authContext: AuthenticationContext = {
    actor: "user",
    userId,
    organizationId: activeOrganizationId,
    role: "user",
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated" as never, true as never);
    c.set("authContext" as never, authContext as never);
    await next();
  });
  app.route("/transactions", transactionsApp);
  app.onError(errorHandler);
  return app;
}

async function status(
  userId: string,
  activeOrganizationId: string,
  path: string,
  taskId: string,
): Promise<number> {
  const response = await appFor(userId, activeOrganizationId).request(
    `/transactions${path}?scope=workspace&taskId=${taskId}`,
  );
  // The export streams its ledger query as the body is read: drain it so the
  // query has settled before `afterAll` deletes the fixtures.
  await response.arrayBuffer();
  return response.status;
}

describe.skipIf(!enabled)(
  "Transactions Task filter against PostgreSQL with mounted middleware",
  () => {
    beforeAll(async () => {
      expect(await prisma.user.count({ where: { id: { in: userIds } } })).toBe(
        0,
      );
      for (const id of userIds) {
        await prisma.user.create({
          data: {
            id,
            name: "Ledger filter fixture",
            email: `${id}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
      await prisma.organization.createMany({
        data: [
          { id: organizationId, name: "Ledger org", slug: organizationId },
          {
            id: otherOrganizationId,
            name: "Other org",
            slug: otherOrganizationId,
          },
        ],
      });
      await prisma.member.createMany({
        data: [
          { userId: memberA, organizationId, seatAssignedAt: new Date() },
          { userId: memberB, organizationId, seatAssignedAt: new Date() },
          {
            userId: outsider,
            organizationId: otherOrganizationId,
            seatAssignedAt: new Date(),
          },
        ],
      });
      await prisma.workspace.createMany({
        data: [
          { id: workspaceId, organizationId },
          { id: otherWorkspaceId, organizationId: otherOrganizationId },
        ],
      });
      await prisma.task.createMany({
        data: [
          {
            id: publicTaskId,
            ownerId: memberA,
            creatorUserId: memberA,
            name: "Public fixture task",
            description: "x",
            status: "COMPLETED",
            workspaceId,
          },
          {
            id: privateTaskId,
            ownerId: memberA,
            creatorUserId: memberA,
            name: "Private fixture task",
            description: "x",
            status: "COMPLETED",
            visibility: "PRIVATE",
            workspaceId,
          },
          {
            id: otherOrganizationTaskId,
            ownerId: outsider,
            creatorUserId: outsider,
            name: "Other organization task",
            description: "x",
            status: "COMPLETED",
            workspaceId: otherWorkspaceId,
          },
        ],
      });
      for (const [index, taskId] of taskIds.entries()) {
        const isOther = taskId === otherOrganizationTaskId;
        await billingScope.networkDb.transaction.create({
          data: {
            id: transactionIds[index],
            amount: -2n * CREDIT,
            userId: isOther ? outsider : memberA,
            organizationId: isOther ? otherOrganizationId : organizationId,
          },
        });
        await prisma.taskEvent.create({
          data: {
            id: eventIds[index],
            taskId,
            transactionId: transactionIds[index],
            comment: "Agent run",
          },
        });
      }
    }, 60000);

    afterAll(async () => {
      if (!enabled) return;
      await prisma.taskEvent.deleteMany({ where: { id: { in: eventIds } } });
      await billingScope.networkDb.transaction.deleteMany({
        where: { id: { in: transactionIds } },
      });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspaceId, otherWorkspaceId] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [organizationId, otherOrganizationId] } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }, 60000);

    it("names Mainnet on its ledger row", async () => {
      const response = await appFor(memberA, organizationId).request(
        `/transactions?scope=workspace&taskId=${publicTaskId}`,
      );
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual([
        expect.objectContaining({
          id: transactionIds[0],
          credits: 2,
          network: "mainnet",
          charged: true,
        }),
      ]);
    });

    it.skipIf(onSplitLayout)(
      "refuses a Preprod ledger on today's layout",
      async () => {
        const response = await appFor(memberA, organizationId).request(
          "/transactions",
          {
            headers: { [NETWORK_HEADER]: "preprod" },
          },
        );
        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.kind).toBe("preprod_off");
        expect(body).not.toHaveProperty("data");
      },
    );

    it("totals a public Task for any member and a private one for its owner", async () => {
      const publicTotal = await appFor(memberB, organizationId).request(
        `/transactions/total?scope=workspace&taskId=${publicTaskId}`,
      );
      expect(publicTotal.status).toBe(200);
      expect((await publicTotal.json()).data).toEqual({
        credits: 2,
        count: 1,
        network: "mainnet",
      });

      const ownPrivate = await appFor(memberA, organizationId).request(
        `/transactions/total?scope=workspace&taskId=${privateTaskId}`,
      );
      expect(ownPrivate.status).toBe(200);
      expect((await ownPrivate.json()).data).toEqual({
        credits: 2,
        count: 1,
        network: "mainnet",
      });
    });

    it.each(["/total", "", "/daily", "/export"])(
      "refuses another member's private Task on %s",
      async (path) => {
        expect(await status(memberB, organizationId, path, privateTaskId)).toBe(
          404,
        );
      },
    );

    it.each(["/total", "", "/daily", "/export"])(
      "refuses a Task in another organization on %s",
      async (path) => {
        expect(
          await status(memberB, organizationId, path, otherOrganizationTaskId),
        ).toBe(404);
      },
    );

    // Three ledger requests in one case: the one that timed out at 5 s in a
    // full-suite run (not reproduced alone, even at load average 90).
    it("lets a member read their own private Task's rows on every route", async () => {
      for (const path of ["", "/daily", "/export"]) {
        expect(await status(memberA, organizationId, path, privateTaskId)).toBe(
          200,
        );
      }
    }, 30_000);
  },
);
