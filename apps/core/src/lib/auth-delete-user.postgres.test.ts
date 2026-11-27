/**
 * A user deletes their own account through Better Auth's `/auth/delete-user`:
 * Core's preflight, then its deletion flow. On the split layout the preflight
 * must read Jobs and payments from a Network's schema.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/auth-delete-user.postgres.test.ts
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import { netTable } from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import {
  createCoreApp,
  createPasswordUser,
  ORIGIN,
  signIn,
} from "@/test-fixtures/core-session";
import { seedAgent, seedJob } from "@/test-fixtures/user-deletion-world";

vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));
vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  return {
    ...actual,
    stripeClient: {
      ...actual.stripeClient,
      createUserCustomer: vi.fn().mockResolvedValue({}),
    },
  };
});
vi.mock("@/services/webhook.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/webhook.service")>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      callAccountCreated: vi.fn().mockResolvedValue(undefined),
      callUserWebhook: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("a user deletes their own account", () => {
  let app: ReturnType<typeof createCoreApp>;
  const userIds: string[] = [];
  const agentId = randomUUID();
  const jobId = randomUUID();

  async function signedIn(name: string) {
    const user = await createPasswordUser(name);
    userIds.push(user.id);
    const cookie = await signIn(app, user.email);
    const request = (path: string, method: "GET" | "POST") =>
      app.request(`${ORIGIN}${path}`, {
        method,
        headers: { origin: ORIGIN, cookie, "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
    return { user, request };
  }

  beforeAll(async () => {
    app = createCoreApp();
    await seedAgent(prisma, "mainnet", agentId);
  }, 60_000);

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM ${netTable("mainnet", "Job")} WHERE "id" = ${jobId}`;
    await prisma.$executeRaw`DELETE FROM ${netTable("mainnet", "Agent")} WHERE "id" = ${agentId}`;
    await prisma.$executeRaw`DELETE FROM ${netTable("mainnet", "AgentPricing")} WHERE "id" = ${agentId}`;
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }, 60_000);

  it("previews no blocker, then deletes the account", async () => {
    const { user, request } = await signedIn("Deletes herself");

    const preview = await request("/v1/users/me/deletion", "GET");
    expect(preview.status).toBe(200);
    expect((await preview.json()).data).toEqual({ blockers: [] });

    const response = await request("/auth/delete-user", "POST");
    expect(response.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it("refuses while the user owns a Job that has not finished, and keeps the account", async () => {
    const { user, request } = await signedIn("Has a running Job");
    // A bare personal workspace, removed with the user: the route that
    // creates one also grants credits, which this test does not need.
    const { workspace } = await prisma.user.update({
      where: { id: user.id },
      data: { workspace: { create: {} } },
      select: { workspace: { select: { id: true } } },
    });
    if (!workspace) throw new Error("The workspace was not created");
    await seedJob(prisma, "mainnet", {
      id: jobId,
      agentId,
      workspaceId: workspace.id,
      ownerId: user.id,
    });

    const response = await request("/auth/delete-user", "POST");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IN_FLIGHT_JOB" });
    expect(
      await prisma.user.findUnique({ where: { id: user.id } }),
    ).not.toBeNull();
  });
});
