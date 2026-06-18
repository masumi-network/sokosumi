import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration test that mounts the real `adminRouter` (including the
 * auto-applied auth middleware from `OpenAPIHonoWithAuth` and the
 * `requireAdmin` guard on the parent router) and drives it through a mocked
 * Better Auth session. This proves the parent-level admin guard actually
 * protects the mounted `/users` and `/organizations` sub-routers — the place
 * where an authorization regression could silently expose admin data.
 */

const {
  getSessionMock,
  verifyApiKeyMock,
  searchUsersMock,
  searchOrganizationsMock,
  getOrgBySlugMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  verifyApiKeyMock: vi.fn(),
  searchUsersMock: vi.fn(),
  searchOrganizationsMock: vi.fn(),
  getOrgBySlugMock: vi.fn(),
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

  it("rejects an authenticated non-admin with 403 on /users/search", async () => {
    mockSession("user");

    const response = await adminRouter.request(
      "http://localhost/users/search?query=ada",
    );

    expect(response.status).toBe(403);
    expect(searchUsersMock).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-admin with 403 on /organizations/search", async () => {
    mockSession("user");

    const response = await adminRouter.request(
      "http://localhost/organizations/search?query=acme",
    );

    expect(response.status).toBe(403);
    expect(searchOrganizationsMock).not.toHaveBeenCalled();
  });

  it("rejects a missing session with 401", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await adminRouter.request(
      "http://localhost/users/search?query=ada",
    );

    expect(response.status).toBe(401);
    expect(searchUsersMock).not.toHaveBeenCalled();
  });

  it("allows an admin and returns mapped users", async () => {
    mockSession("admin");
    searchUsersMock.mockResolvedValue([
      { id: "user_1", name: "Ada", email: "ada@example.com", role: "user" },
    ]);

    const response = await adminRouter.request(
      "http://localhost/users/search?query=ada",
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

  it("allows an admin to reach the organizations sub-router", async () => {
    mockSession("admin");
    searchOrganizationsMock.mockResolvedValue([
      { id: "org_1", name: "Acme", slug: "acme" },
    ]);

    const response = await adminRouter.request(
      "http://localhost/organizations/search?query=acme",
    );
    const body = (await response.json()) as {
      data: Array<{ id: string; name: string; slug: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.data).toEqual([{ id: "org_1", name: "Acme", slug: "acme" }]);
  });
});
