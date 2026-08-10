import { beforeEach, describe, expect, it, vi } from "vitest";

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
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  verifyApiKeyMock: vi.fn(),
  searchUsersMock: vi.fn(),
  searchOrganizationsMock: vi.fn(),
  getOrgBySlugMock: vi.fn(),
  refundReviewedClaimMock: vi.fn(),
  resolveReviewedClaimMock: vi.fn(),
  retryReviewedClaimMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
      verifyApiKey: verifyApiKeyMock,
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: { searchUsers: searchUsersMock },
  organizationRepository: {
    searchOrganizations: searchOrganizationsMock,
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
    expect(searchUsersMock).toHaveBeenCalledWith("ada", 20, expect.anything());
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
