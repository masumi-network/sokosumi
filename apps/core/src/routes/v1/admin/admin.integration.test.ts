import type { z } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { adminSeoAlerts } from "@/schemas/admin-seo-alerts.schema";

type SeoAlertQueryRow = Omit<
  z.output<typeof adminSeoAlerts>,
  "pageSize" | "failurePercent" | "importGraceMinutes"
>;

/**
 * Integration test that mounts the real `adminRouter` (including the
 * auto-applied auth middleware from `OpenAPIHonoWithAuth` and the
 * `requireAdmin` guard on the parent router) and drives it through a mocked
 * Better Auth session. This proves the parent-level admin guard actually
 * protects the mounted `/search`, `/users`, and `/organizations` sub-routers —
 * the place where an authorization regression could silently expose admin data.
 */

const {
  getSessionMock,
  verifyApiKeyMock,
  searchUsersMock,
  searchOrganizationsMock,
  getOrgBySlugMock,
  refundReviewedClaimMock,
  resolveReviewedClaimMock,
  retryReviewedClaimMock,
  seoImpactRowsMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  verifyApiKeyMock: vi.fn(),
  searchUsersMock: vi.fn(),
  searchOrganizationsMock: vi.fn(),
  getOrgBySlugMock: vi.fn(),
  refundReviewedClaimMock: vi.fn(),
  resolveReviewedClaimMock: vi.fn(),
  retryReviewedClaimMock: vi.fn(),
  seoImpactRowsMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
      verifyApiKey: verifyApiKeyMock,
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: vi.fn().mockResolvedValue([
      {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
        billingTotal: 0,
        pricingAttention: 0,
        billing: [],
        connectionTotal: 0,
        reconnect: 0,
        connections: [],
        items: [],
      } satisfies SeoAlertQueryRow,
    ]),
    user: { findMany: searchUsersMock },
    organization: { findMany: searchOrganizationsMock },
    projectSeoObservation: { groupBy: vi.fn().mockResolvedValue([]) },
    projectSeoImpactVerdict: {
      groupBy: vi.fn(async () => [
        { state: "waiting_crawl", _count: { _all: 1 } },
      ]),
      findMany: seoImpactRowsMock,
    },
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {
    getOrganizationLimitedInfoBySlug: getOrgBySlugMock,
  },
}));

vi.mock("@/services/task-payment-claim.service", () => ({
  refundReviewedTaskPaymentClaim: refundReviewedClaimMock,
  resolveReviewedTaskPaymentClaim: resolveReviewedClaimMock,
  retryReviewedTaskPaymentClaim: retryReviewedClaimMock,
}));

const { default: adminRouter } = await import("./index.js");

function mockSession(role: string) {
  getSessionMock.mockResolvedValue({
    session: { activeOrganizationId: null },
    user: { id: "user_1", role },
  });
}

describe("admin router (real mount, real auth + admin guard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchUsersMock.mockResolvedValue([]);
    searchOrganizationsMock.mockResolvedValue([]);
    getOrgBySlugMock.mockResolvedValue(null);
  });

  it("serves SEO alert counts only to an authenticated admin", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(
      (await adminRouter.request("http://localhost/seo-alerts")).status,
    ).toBe(401);
    mockSession("user");
    expect(
      (await adminRouter.request("http://localhost/seo-alerts")).status,
    ).toBe(403);
    mockSession("admin");
    const response = await adminRouter.request("http://localhost/seo-alerts");
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      total: 0,
      items: [],
      billingTotal: 0,
      pricingAttention: 0,
      billing: [],
    });
  });

  it("serves the impact of done SEO actions only to an authenticated admin", async () => {
    const url = "http://localhost/seo-action-impact?days=14";
    getSessionMock.mockResolvedValue(null);
    expect((await adminRouter.request(url)).status).toBe(401);
    mockSession("user");
    expect((await adminRouter.request(url)).status).toBe(403);
    mockSession("admin");
    const response = await adminRouter.request(url);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      hasNext: false,
      pageSize: 10,
      items: [],
    });
    expect(
      (await adminRouter.request("http://localhost/seo-action-impact?days=3"))
        .status,
    ).toBe(422);
  });

  it("serves tracked SEO page changes only to an authenticated admin", async () => {
    getSessionMock.mockResolvedValue(null);
    expect(
      (await adminRouter.request("http://localhost/seo-impact")).status,
    ).toBe(401);
    mockSession("user");
    expect(
      (await adminRouter.request("http://localhost/seo-impact")).status,
    ).toBe(403);
    mockSession("admin");
    seoImpactRowsMock.mockResolvedValue([
      {
        id: "0196f2a0-0000-7000-8000-000000000001",
        projectId: "0196f2a0-0000-7000-8000-000000000002",
        pageUrl: "https://battery-sensei.app/pricing",
        title: "Name the battery app in the title",
        changeSource: "cuso_done",
        changedAt: new Date("2026-11-20T10:00:00Z"),
        crawledAt: null,
        windowStart: null,
        windowEnd: null,
        state: "waiting_crawl",
        reason: "not_crawled_yet",
        project: {
          name: "Cuso",
          workspace: { organization: { slug: "battery-sensei" } },
        },
      },
    ]);
    const response = await adminRouter.request("http://localhost/seo-impact");
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      total: 1,
      rows: [
        {
          organizationSlug: "battery-sensei",
          suggestionTitle: "Name the battery app in the title",
          state: "waiting_crawl",
        },
      ],
    });
  });

  it("rejects an authenticated non-admin with 403 on /search/users", async () => {
    mockSession("user");

    const response = await adminRouter.request(
      "http://localhost/search/users?query=ada",
    );

    expect(response.status).toBe(403);
    expect(searchUsersMock).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-admin with 403 on /search/organizations", async () => {
    mockSession("user");

    const response = await adminRouter.request(
      "http://localhost/search/organizations?query=acme",
    );

    expect(response.status).toBe(403);
    expect(searchOrganizationsMock).not.toHaveBeenCalled();
  });

  it("rejects a missing session with 401", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await adminRouter.request(
      "http://localhost/search/users?query=ada",
    );

    expect(response.status).toBe(401);
    expect(searchUsersMock).not.toHaveBeenCalled();
  });

  it("rejects a non-admin retry request before scheduling work", async () => {
    mockSession("user");

    const response = await adminRouter.request(
      "http://localhost/task-payment-claims/claim-1/retry",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(retryReviewedClaimMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated retry request before scheduling work", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await adminRouter.request(
      "http://localhost/task-payment-claims/claim-1/retry",
      { method: "POST" },
    );

    expect(response.status).toBe(401);
    expect(retryReviewedClaimMock).not.toHaveBeenCalled();
  });

  it("allows an admin and returns mapped users", async () => {
    mockSession("admin");
    searchUsersMock.mockResolvedValue([
      { id: "user_1", name: "Ada", email: "ada@example.com", role: "user" },
    ]);

    const response = await adminRouter.request(
      "http://localhost/search/users?query=ada",
    );
    const body = (await response.json()) as {
      data: Array<{ id: string; name: string; email: string }>;
    };

    expect(response.status).toBe(200);
    expect(searchUsersMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: "ada", mode: "insensitive" } },
          { email: { contains: "ada", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    expect(body.data).toEqual([
      { id: "user_1", name: "Ada", email: "ada@example.com" },
    ]);
  });

  it("allows an admin to reach the organizations search route", async () => {
    mockSession("admin");
    searchOrganizationsMock.mockResolvedValue([
      { id: "org_1", name: "Acme", slug: "acme" },
    ]);

    const response = await adminRouter.request(
      "http://localhost/search/organizations?query=acme",
    );
    const body = (await response.json()) as {
      data: Array<{ id: string; name: string; slug: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.data).toEqual([{ id: "org_1", name: "Acme", slug: "acme" }]);
  });
});
