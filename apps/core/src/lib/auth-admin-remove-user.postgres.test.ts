/**
 * Better Auth's admin `remove-user` is closed: it deletes the User row without
 * Core's blockers, sweeps or Stripe clean-up. Core's own deletion still works.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/auth-admin-remove-user.postgres.test.ts
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import {
  createCoreApp,
  createPasswordUser,
  ORIGIN,
  signIn,
} from "@/test-fixtures/core-session";

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

describe.skipIf(!enabled)("Better Auth admin remove-user", () => {
  let app: ReturnType<typeof createCoreApp>;
  const userIds: string[] = [];
  let adminCookie: string;

  async function account(name: string, role?: string) {
    const created = await createPasswordUser(name, role);
    userIds.push(created.id);
    return created;
  }

  beforeAll(async () => {
    app = createCoreApp();
    const admin = await account("Ada Admin", "admin");
    adminCookie = await signIn(app, admin.email);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("answers as a disabled path does and keeps the user", async () => {
    const target = await account("Remove target");

    const response = await app.request(`${ORIGIN}/auth/admin/remove-user`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: adminCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ userId: target.id }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
    expect(
      await prisma.user.findUnique({ where: { id: target.id } }),
    ).not.toBeNull();
  });

  it("still deletes an account through Core's own delete-user flow", async () => {
    const own = await account("Delete myself");
    const cookie = await signIn(app, own.email);

    const response = await app.request(`${ORIGIN}/auth/delete-user`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "fixture-password-long" }),
    });

    expect(response.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: own.id } })).toBeNull();
  });
});
