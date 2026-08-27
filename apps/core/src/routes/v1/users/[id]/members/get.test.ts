import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserMembers from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { userFindUniqueMock, getMembersWithOrganizationByUserIdMock } =
  vi.hoisted(() => ({
    userFindUniqueMock: vi.fn(),
    getMembersWithOrganizationByUserIdMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMembersWithOrganizationByUserId: (...args: unknown[]) =>
      getMembersWithOrganizationByUserIdMock(...args),
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const ADMIN_USER: AuthenticationContext = {
  actor: "user",
  userId: "admin_1",
  organizationId: null,
  role: "admin",
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
  mountGetUserMembers(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

const MEMBER_WITH_ORG = {
  id: "member_1",
  userId: "user_123",
  organizationId: "org_1",
  role: "member",
  seatAssignedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  organization: {
    id: "org_1",
    name: "Acme",
    slug: "acme",
    logo: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    stripeCustomerId: null,
  },
};

describe("GET /users/{id}/members", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/members",
    );
    expect(response.status).toBe(403);
    expect(getMembersWithOrganizationByUserIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when an admin requests a missing user", async () => {
    userFindUniqueMock.mockResolvedValueOnce(null);
    const response = await createApp(ADMIN_USER).request(
      "http://localhost/missing_user/members",
    );
    expect(response.status).toBe(404);
    expect(getMembersWithOrganizationByUserIdMock).not.toHaveBeenCalled();
  });

  it("returns the resolved user's memberships for `me`", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getMembersWithOrganizationByUserIdMock.mockResolvedValueOnce([
      MEMBER_WITH_ORG,
    ]);

    const response = await createApp().request("http://localhost/me/members");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getMembersWithOrganizationByUserIdMock).toHaveBeenCalledWith(
      "user_123",
      expect.anything(),
    );
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "member_1",
      organizationId: "org_1",
      organization: { slug: "acme" },
    });
  });

  it("returns an empty list when the user has no memberships", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getMembersWithOrganizationByUserIdMock.mockResolvedValueOnce([]);

    const response = await createApp().request("http://localhost/me/members");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});
