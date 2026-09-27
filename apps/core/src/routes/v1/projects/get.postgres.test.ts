import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { projectListItemSchema } from "@/schemas/project.schema";
import mountListProjects from "./get";

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
const userId = randomUUID();
const otherUserId = randomUUID();
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const agentId = randomUUID();
const pricingId = randomUUID();
const olderId = randomUUID();
const newerId = randomUUID();

// Use the actual repository migrations in a disposable database,
// real Prisma, raw SQL and HTTP serialization. Only auth is a trusted fixture.
// A handwritten table fixture previously hid the Job/job mapping regression.
describe.skipIf(!enabled)(
  "GET /projects against the Prisma PostgreSQL schema",
  () => {
    beforeAll(async () => {
      for (const [id, ws] of [
        [userId, workspaceId],
        [otherUserId, otherWorkspaceId],
      ]) {
        await prisma.user.create({
          data: {
            id,
            name: "Projects regression fixture",
            email: `${id}@example.test`,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            workspace: { create: { id: ws } },
          },
        });
      }
      await prisma.project.createMany({
        data: [
          {
            id: olderId,
            workspaceId,
            name: "Older project with recent job",
            logo: "https://example.test/logo.png",
            createdAt: new Date("2026-01-01"),
          },
          {
            id: newerId,
            workspaceId,
            name: "Newer project",
            createdAt: new Date("2026-02-01"),
          },
          {
            workspaceId: otherWorkspaceId,
            name: "Other workspace",
            createdAt: new Date("2030-01-01"),
          },
        ],
      });
      await prisma.agent.create({
        data: {
          id: agentId,
          name: "Fixture agent",
          blockchainIdentifier: agentId,
          lastUptimeCheck: new Date(),
          uptimeCount: 0,
          uptimeCheckCount: 0,
          isShown: false,
          pricing: { create: { id: pricingId, pricingType: "FREE" } },
        },
      });
      await prisma.job.create({
        data: {
          ownerId: userId,
          workspaceId,
          projectId: olderId,
          agentId,
          agentJobId: randomUUID(),
          jobType: "FREE",
          createdAt: new Date("2026-01-01"),
          events: { create: { createdAt: new Date("2026-06-01") } },
        },
      });
    });

    afterAll(async () => {
      await prisma.job.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspaceId, otherWorkspaceId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [userId, otherUserId] } },
      });
      await prisma.agent.deleteMany({ where: { id: agentId } });
      await prisma.agentPricing.deleteMany({ where: { id: pricingId } });
      await prisma.$disconnect();
    });

    it("serves activity-ranked, scoped pages with valid DTOs and a usable cursor", async () => {
      const app = new OpenAPIHonoWithAuth();
      app.use("*", async (c, next) => {
        c.set("requestId", "projects-runtime-regression");
        c.set("isAuthenticated", true);
        c.set("authContext", {
          actor: "user",
          userId,
          organizationId: null,
          role: "user",
        });
        c.set("workspaceContext", {
          workspaceId,
          userId,
          organizationId: null,
        });
        await next();
      });
      // Keep SQL failures visible in the regression output, not just a 500.
      app.onError((error, c) => c.json({ error: error.message }, 500));
      mountListProjects(app);

      const first = await app.request("http://localhost/?limit=1");
      const firstBody = await first.json();
      expect(first.status, JSON.stringify(firstBody)).toBe(200);
      expect(projectListItemSchema.parse(firstBody.data[0])).toMatchObject({
        id: olderId,
        jobCount: 1,
        logo: "https://example.test/logo.png",
      });
      expect(firstBody.meta.pagination.total).toBe(2);
      expect(firstBody.meta.pagination.nextCursor).toEqual(expect.any(String));

      const second = await app.request(
        `http://localhost/?limit=1&cursor=${encodeURIComponent(firstBody.meta.pagination.nextCursor)}`,
      );
      const secondBody = await second.json();
      expect(second.status, JSON.stringify(secondBody)).toBe(200);
      expect(projectListItemSchema.parse(secondBody.data[0]).id).toBe(newerId);
      expect(secondBody.meta.pagination.nextCursor).toBeNull();
    });
  },
);
