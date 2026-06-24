import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const {
  listOrganizationsForAdminOverviewMock,
  buildAdminOrganizationOverviewItemMock,
  buildAdminOrganizationOverviewDetailMock,
  buildAdminOrganizationMemberOverviewPageMock,
  getAdminOrganizationBySlugMock,
} = vi.hoisted(() => ({
  listOrganizationsForAdminOverviewMock: vi.fn(),
  buildAdminOrganizationOverviewItemMock: vi.fn(),
  buildAdminOrganizationOverviewDetailMock: vi.fn(),
  buildAdminOrganizationMemberOverviewPageMock: vi.fn(),
  getAdminOrganizationBySlugMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {
    listOrganizationsForAdminOverview: listOrganizationsForAdminOverviewMock,
  },
}));

vi.mock("@/helpers/admin-organization-overview.js", () => ({
  buildAdminOrganizationOverviewItem: buildAdminOrganizationOverviewItemMock,
  buildAdminOrganizationOverviewDetail:
    buildAdminOrganizationOverviewDetailMock,
  buildAdminOrganizationMemberOverviewPage:
    buildAdminOrganizationMemberOverviewPageMock,
  getAdminOrganizationBySlug: getAdminOrganizationBySlugMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({}),
  },
}));

const { default: mountListAdminOrganizations } = await import(
  "./organizations/get.js"
);
const { default: mountGetAdminOrganizationBySlug } = await import(
  "./organizations/[slug]/get.js"
);
const { default: mountListAdminOrganizationMembers } = await import(
  "./organizations/[slug]/members/get.js"
);

interface AppOptions {
  role?: string;
  actor?: "user" | "coworker";
}

function createApp(
  mountRoutes: (app: OpenAPIHonoWithAuth) => void,
  options: AppOptions = {},
) {
  const { role = "admin", actor = "user" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_admin_test");
    c.set("isAuthenticated", true);

    if (actor === "coworker") {
      c.set("authContext", { actor: "coworker", coworkerId: "cow_123" });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: "user_admin",
        organizationId: null,
        role,
      });
    }

    await next();
  });

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountRoutes(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("GET /v1/admin/organizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOrganizationsForAdminOverviewMock.mockResolvedValue({
      organizations: [
        {
          id: "org_1",
          name: "Acme Corp",
          slug: "acme-corp",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          _count: { members: 3 },
        },
      ],
      total: 1,
    });
    buildAdminOrganizationOverviewItemMock.mockResolvedValue({
      id: "org_1",
      name: "Acme Corp",
      slug: "acme-corp",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      memberCount: 3,
      billingMode: "self_serve",
      billingPlan: "starter",
      purchasedSeats: 5,
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
    });
  });

  it("returns enriched organizations with pagination meta", async () => {
    const app = createApp(mountListAdminOrganizations);
    const res = await app.request("/?query=acme");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({
      id: "org_1",
      slug: "acme-corp",
      memberCount: 3,
    });
    expect(body.meta.pagination).toMatchObject({
      total: 1,
      nextCursor: null,
    });
  });

  it("rejects non-admin users", async () => {
    const app = createApp(mountListAdminOrganizations, { role: "user" });
    const res = await app.request("/");

    expect(res.status).toBe(403);
  });
});

describe("GET /v1/admin/organizations/{slug}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildAdminOrganizationOverviewDetailMock.mockResolvedValue({
      organization: {
        id: "org_1",
        name: "Acme Corp",
        slug: "acme-corp",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        stripeCustomerId: "cus_123",
      },
      billingPlan: {
        mode: "self_serve",
        plan: "starter",
        isConsumable: false,
        purchasedSeats: 5,
        cancelAtPeriodEnd: false,
        periodEnd: new Date("2026-03-01T00:00:00.000Z"),
      },
      subscription: {
        plan: "starter",
        status: "active",
        cancelAtPeriodEnd: false,
        periodStart: new Date("2026-02-01T00:00:00.000Z"),
        periodEnd: new Date("2026-03-01T00:00:00.000Z"),
        seats: 5,
      },
      enterpriseContract: null,
      seatSummary: {
        assignedCount: 2,
        memberCount: 3,
        purchasedSeats: 5,
        unusedSeats: 3,
        paidPlan: "starter",
        isEnterpriseContract: false,
      },
      totalCredits: null,
    });
  });

  it("returns organization overview detail", async () => {
    const app = createApp(mountGetAdminOrganizationBySlug);
    const res = await app.request("/acme-corp");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.organization.slug).toBe("acme-corp");
    expect(body.data.totalCredits).toBeNull();
    expect(body.data.members).toBeUndefined();
  });

  it("returns 404 when organization is missing", async () => {
    buildAdminOrganizationOverviewDetailMock.mockResolvedValue(null);
    const app = createApp(mountGetAdminOrganizationBySlug);
    const res = await app.request("/missing");

    expect(res.status).toBe(404);
  });
});

describe("GET /v1/admin/organizations/{slug}/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminOrganizationBySlugMock.mockResolvedValue({
      id: "org_1",
      name: "Acme Corp",
      slug: "acme-corp",
    });
    buildAdminOrganizationMemberOverviewPageMock.mockResolvedValue({
      members: [
        {
          id: "member_1",
          organizationId: "org_1",
          role: "owner",
          seatAssignedAt: null,
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          user: {
            id: "user_1",
            name: "Jane Doe",
            email: "jane@example.com",
          },
          lastSeenAt: null,
          credits: 42,
          subscriptionPlan: "starter",
          subscriptionStatus: "active",
        },
      ],
      total: 1,
    });
  });

  it("returns paginated organization members", async () => {
    const app = createApp(mountListAdminOrganizationMembers);
    const res = await app.request("/acme-corp/members");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({
      id: "member_1",
      credits: 42,
    });
    expect(body.meta.pagination).toMatchObject({
      total: 1,
      nextCursor: null,
    });
  });

  it("returns 404 when organization is missing", async () => {
    getAdminOrganizationBySlugMock.mockResolvedValue(null);
    const app = createApp(mountListAdminOrganizationMembers);
    const res = await app.request("/missing/members");

    expect(res.status).toBe(404);
  });
});
