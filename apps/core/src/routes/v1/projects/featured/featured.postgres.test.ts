import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requestProjectClose } from "@/services/project-close-lifecycle.service";

import mountProjectFeaturedRoutes from "../[id]/featured/routes.js";

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
const organizationId = randomUUID();
const workspaceId = randomUUID();
const featuredId = randomUUID();
let targetId = "";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_featured_pg");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId,
      role: "user",
    });
    c.set("workspaceContext", { workspaceId, userId: null, organizationId });
    return await next();
  });
  mountProjectFeaturedRoutes(app);
  return app;
}

function feature(projectId: string) {
  return createApp().request(`http://localhost/${projectId}/featured`, {
    method: "PUT",
  });
}

async function featuredProjectId() {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { featuredProjectId: true },
  });
  return workspace.featuredProjectId;
}

// Real PostgreSQL on two connections: Feature checks the Project is open
// and writes the Workspace, while a close commits `closingAt` beside it.
describe.skipIf(!enabled)(
  "Feature for everyone against a Project close",
  () => {
    const closer = enabled
      ? createPrismaClient(process.env.DATABASE_URL ?? "")
      : null;

    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Featured fixture owner",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Featured fixture organization",
          slug: organizationId,
          members: { create: { userId, role: "owner" } },
          workspace: { create: { id: workspaceId } },
        },
      });
      await prisma.project.create({
        data: { id: featuredId, workspaceId, name: "Already featured" },
      });
    });

    beforeEach(async () => {
      targetId = randomUUID();
      await prisma.project.create({
        data: { id: targetId, workspaceId, name: "Being closed" },
      });
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { featuredProjectId: featuredId },
      });
    });

    afterAll(async () => {
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await closer?.$disconnect();
    });

    it("refuses to feature a Project whose close commits first, and keeps the one featured before", async () => {
      const committed = Promise.withResolvers<void>();
      const locked = Promise.withResolvers<void>();
      // The close's own lock order (Workspace, then Project), held open
      // while Feature starts, then committed with the Project closing.
      const close = closer?.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "workspace" WHERE id = ${workspaceId}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "project" WHERE id = ${targetId}::uuid FOR UPDATE`;
          await tx.project.update({
            where: { id: targetId },
            data: { closingAt: new Date(), projectRevision: { increment: 1 } },
          });
          locked.resolve();
          await committed.promise;
        },
        { timeout: 20_000 },
      );
      await locked.promise;

      const response = feature(targetId);
      // Long enough for Feature to read the Project and reach its write.
      await new Promise((resolve) => setTimeout(resolve, 300));
      committed.resolve();
      await close;

      expect((await response).status).toBe(422);
      expect(await featuredProjectId()).toBe(featuredId);
    });

    it("lets a close that comes after a Feature go through", async () => {
      expect((await feature(targetId)).status).toBe(200);

      const status = await requestProjectClose(
        { projectId: targetId, workspaceId, actorUserId: userId },
        { operationId: randomUUID(), expectedProjectRevision: 0 },
      );

      expect(status).toMatchObject({ projectId: targetId });
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: targetId },
        select: { closingAt: true },
      });
      expect(project.closingAt).not.toBeNull();
      // Still featured in storage; reads skip a closing Project.
      expect(await featuredProjectId()).toBe(targetId);
    });
  },
);
