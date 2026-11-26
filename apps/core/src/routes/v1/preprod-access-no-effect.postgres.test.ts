/**
 * The Preprod access flag changes no existing response: each route below
 * answers the same with both flags off and with both on, and never names the
 * flag. It covers the routes it lists and no others.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/v1/preprod-access-no-effect.postgres.test.ts
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import { MemberRole } from "@sokosumi/database";
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

describe.skipIf(!enabled)("Preprod access flag on existing routes", () => {
  const app = createCoreApp();
  const slug = `preprod-no-effect-${randomUUID()}`;
  let user: Awaited<ReturnType<typeof createPasswordUser>>;
  let organizationId: string;
  let cookie: string;

  beforeAll(async () => {
    // An admin, so the admin lists answer too; a member of the Organization.
    user = await createPasswordUser("Preprod no effect", "admin");
    const organization = await prisma.organization.create({
      data: {
        name: "Preprod no effect",
        slug,
        members: { create: { userId: user.id, role: MemberRole.OWNER } },
      },
    });
    organizationId = organization.id;
    cookie = await signIn(app, user.email);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  function paths() {
    const email = encodeURIComponent(user.email);
    return [
      "/v1/users/me",
      `/v1/users/${user.id}`,
      `/v1/users/${user.id}/organizations`,
      `/v1/users/${user.id}/members`,
      `/v1/users/${user.id}/workspaces`,
      `/v1/organizations/${organizationId}`,
      `/v1/admin/users?query=${email}`,
      `/v1/admin/organizations?query=${slug}`,
      `/v1/admin/organizations/${slug}`,
      `/v1/admin/organizations/${slug}/members`,
      "/auth/get-session",
      `/auth/organization/get-full-organization?organizationId=${organizationId}`,
      "/auth/organization/list",
      `/auth/admin/list-users?searchField=email&searchValue=${email}`,
    ];
  }

  async function answers() {
    const result: Record<string, unknown> = {};
    for (const path of paths()) {
      const response = await app.request(`${ORIGIN}${path}`, {
        headers: { origin: ORIGIN, cookie },
      });
      const text = await response.text();
      expect([path, response.status]).toEqual([path, 200]);
      expect([path, text.includes("preprodEnabled")]).toEqual([path, false]);
      const body = JSON.parse(text) as Record<string, unknown> | null;
      // Core's envelope stamps each response with a time and a request id.
      if (path.startsWith("/v1/") && body) delete body.meta;
      result[path] = body;
    }
    return result;
  }

  async function setFlags(preprodEnabled: boolean) {
    await prisma.user.update({
      where: { id: user.id },
      data: { preprodEnabled },
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: { preprodEnabled },
    });
  }

  it("answers the same with both flags off and with both on", async () => {
    const off = await answers();
    // Each answer names the fixture, so an empty one cannot pass for equal.
    for (const [path, body] of Object.entries(off)) {
      expect([path, JSON.stringify(body)]).toEqual([
        path,
        expect.stringMatching(new RegExp(`${user.id}|${organizationId}`)),
      ]);
    }

    await setFlags(true);

    expect(await answers()).toEqual(off);
  });
});
