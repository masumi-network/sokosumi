import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserEffectiveDesignMd from "./get";

const {
  userFindUniqueMock,
  organizationFindUniqueMock,
  getUserByIdMock,
  getMemberByUserIdAndOrganizationIdMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    organization: { findUnique: organizationFindUniqueMock },
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserEffectiveDesignMd(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/effective-design-md", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/effective-design-md",
    );
    expect(response.status).toBe(403);
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it("prefers the organization DESIGN.md when the user is a member", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce({
      id: "member_1",
    });
    organizationFindUniqueMock.mockResolvedValueOnce({
      metadata: JSON.stringify({ designMdUrl: "https://blob.example/org.md" }),
    });

    const response = await createApp().request(
      "http://localhost/me/effective-design-md?organizationId=org_1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/org.md",
    });
    expect(getUserByIdMock).not.toHaveBeenCalled();
  });

  it("falls back to the user DESIGN.md when the organization has none", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce({
      id: "member_1",
    });
    organizationFindUniqueMock.mockResolvedValueOnce({
      metadata: JSON.stringify({}),
    });
    getUserByIdMock.mockResolvedValueOnce({
      metadata: JSON.stringify({ designMdUrl: "https://blob.example/user.md" }),
    });

    const response = await createApp().request(
      "http://localhost/me/effective-design-md?organizationId=org_1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/user.md",
    });
  });

  it("returns the user DESIGN.md when no organization is supplied", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce({
      metadata: JSON.stringify({ designMdUrl: "https://blob.example/user.md" }),
    });

    const response = await createApp().request(
      "http://localhost/me/effective-design-md",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toEqual({
      label: "DESIGN.md",
      url: "https://blob.example/user.md",
    });
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns null when neither the organization nor the user has a DESIGN.md", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce({ metadata: JSON.stringify({}) });

    const response = await createApp().request(
      "http://localhost/me/effective-design-md",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.designMd).toBeNull();
  });
});
