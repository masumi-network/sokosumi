import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserOrganizationMember from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { userFindUniqueMock, getMemberByUserIdAndOrganizationIdMock } =
  vi.hoisted(() => ({
    userFindUniqueMock: vi.fn(),
    getMemberByUserIdAndOrganizationIdMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
}));

// Let a coworker past the vendor grant gate so these cases exercise the
// organization binding, not grant policy.
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  assertCoworkerUserContextBinding: async () => undefined,
  requireAuthorizedUserContext: vi.fn(),
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserOrganizationMember(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

const MEMBER_RECORD = {
  id: "member_1",
  userId: "user_123",
  organizationId: "org_1",
  role: "member",
  seatAssignedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("GET /users/{id}/organizations/{organizationId}/member", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/organizations/org_1/member",
    );
    expect(response.status).toBe(403);
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns the membership for `me` when the user is a member", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(MEMBER_RECORD);

    const response = await createApp().request(
      "http://localhost/me/organizations/org_1/member",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_123",
      "org_1",
      expect.anything(),
    );
    expect(body.data).toMatchObject({
      id: "member_1",
      userId: "user_123",
      organizationId: "org_1",
      role: "member",
    });
  });

  it("returns 404 when the user is not a member of the organization", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(null);

    const response = await createApp().request(
      "http://localhost/me/organizations/org_1/member",
    );
    expect(response.status).toBe(404);
  });
});

/**
 * Agents cannot reach this path today: it is absent from
 * AGENT_ALLOWED_USER_SUBPATH_PATTERNS. The route binds anyway, so widening
 * that allowlist cannot silently reopen SOK-1020. These cases mount the route
 * without the allowlist middleware, which is what a widened allowlist would
 * amount to, and pin the binding so its deletion is caught.
 */
describe("GET /users/{id}/organizations/{organizationId}/member organization scope", () => {
  const COWORKER_IN_ORG_1: AuthenticationContext = {
    actor: "coworker",
    coworkerId: "cow_123",
    vendorId: "vendor_serviceplan",
    context: { userId: "user_123", organizationId: "org_1" },
  };

  const COWORKER_IN_OTHER_ORG: AuthenticationContext = {
    actor: "coworker",
    coworkerId: "cow_123",
    vendorId: "vendor_serviceplan",
    context: { userId: "user_123", organizationId: "org_other" },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(MEMBER_RECORD);
  });

  it("serves the membership for the bound organization", async () => {
    const response = await createApp(COWORKER_IN_ORG_1).request(
      "http://localhost/me/organizations/org_1/member",
    );

    expect(response.status).toBe(200);
    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalled();
  });

  it("refuses an organization outside the context, without reading it", async () => {
    const response = await createApp(COWORKER_IN_OTHER_ORG).request(
      "http://localhost/me/organizations/org_1/member",
    );

    expect(response.status).toBe(403);
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });
});
