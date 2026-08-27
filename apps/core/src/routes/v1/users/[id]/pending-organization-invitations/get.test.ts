import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserPendingOrganizationInvitations from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { listPendingOrganizationInvitationsForUserMock, userFindUniqueMock } =
  vi.hoisted(() => ({
    listPendingOrganizationInvitationsForUserMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
  }));

vi.mock("@/helpers/invitation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/invitation")>();
  return {
    ...actual,
    listPendingOrganizationInvitationsForUser: (...args: unknown[]) =>
      listPendingOrganizationInvitationsForUserMock(...args),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
  },
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
  mountGetUserPendingOrganizationInvitations(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/pending-organization-invitations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/pending-organization-invitations",
    );
    expect(response.status).toBe(403);
    expect(
      listPendingOrganizationInvitationsForUserMock,
    ).not.toHaveBeenCalled();
  });

  it("returns the pending invitation list for `me`", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    const invitations = [
      {
        id: "inv_1",
        organizationId: "org_1",
        email: "ada@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date("2999-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        organization: {
          id: "org_1",
          name: "Acme",
          slug: "acme",
          logo: null,
        },
      },
    ];
    listPendingOrganizationInvitationsForUserMock.mockResolvedValueOnce(
      invitations,
    );

    const response = await createApp().request(
      "http://localhost/me/pending-organization-invitations",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(listPendingOrganizationInvitationsForUserMock).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        user: expect.objectContaining({ findUnique: expect.any(Function) }),
      }),
    );
    expect(body.data).toEqual([
      {
        id: "inv_1",
        organizationId: "org_1",
        email: "ada@example.com",
        role: "member",
        status: "pending",
        expiresAt: "2999-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        organization: {
          id: "org_1",
          name: "Acme",
          slug: "acme",
          logo: null,
        },
      },
    ]);
  });

  it("returns an empty list when the user has no pending org invitations", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    listPendingOrganizationInvitationsForUserMock.mockResolvedValueOnce([]);

    const response = await createApp().request(
      "http://localhost/me/pending-organization-invitations",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});
