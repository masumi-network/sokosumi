import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  applyUserRouteMiddleware,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  userFindUnique,
  sessionFindMany,
  sessionFindFirst,
  sessionFindUnique,
  deleteSession,
} = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionFindUnique: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUnique },
    session: {
      findMany: sessionFindMany,
      findFirst: sessionFindFirst,
      findUnique: sessionFindUnique,
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: { $context: Promise.resolve({ internalAdapter: { deleteSession } }) },
}));

const { default: mountGet } = await import("./get");
const { default: mountDelete } = await import("./[sessionId]/delete");

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
  sessionId: "current",
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  const users = new OpenAPIHonoWithAuth<UserRouteVariables>();
  applyUserRouteMiddleware(users);
  mountGet(users);
  mountDelete(users);
  app.route("/:id", users);
  return app;
}

describe("/users/{id}/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUnique.mockImplementation(async ({ where }) => ({ id: where.id }));
    sessionFindUnique.mockResolvedValue({
      userId: "user_1",
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  it("lists the caller's live sessions without their tokens", async () => {
    sessionFindMany.mockResolvedValue([
      {
        id: "current",
        userAgent: "Safari",
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
      },
      {
        id: "other",
        userAgent: null,
        createdAt: new Date("2026-11-20T00:00:00.000Z"),
      },
    ]);

    const response = await createApp().request("/me/sessions");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      sessions: [
        {
          id: "current",
          userAgent: "Safari",
          createdAt: "2026-11-01T00:00:00.000Z",
          current: true,
        },
        {
          id: "other",
          userAgent: null,
          createdAt: "2026-11-20T00:00:00.000Z",
          current: false,
        },
      ],
    });
    const query = sessionFindMany.mock.calls[0]?.[0];
    expect(query.where.userId).toBe("user_1");
    expect(query.select).not.toHaveProperty("token");
  });

  it.each(["oauth", "api_key"] as const)(
    "refuses %s callers on both routes",
    async (authenticationMethod) => {
      const app = createApp({ ...SESSION_USER, authenticationMethod });

      expect((await app.request("/me/sessions")).status).toBe(403);
      expect(
        (await app.request("/me/sessions/other", { method: "DELETE" })).status,
      ).toBe(403);
      expect(sessionFindMany).not.toHaveBeenCalled();
      expect(deleteSession).not.toHaveBeenCalled();
    },
  );

  it("refuses an admin reading or revoking another user's sessions", async () => {
    const app = createApp({ ...SESSION_USER, role: "admin" });

    expect((await app.request("/user_2/sessions")).status).toBe(403);
    expect(
      (await app.request("/user_2/sessions/theirs", { method: "DELETE" }))
        .status,
    ).toBe(403);
    expect(sessionFindMany).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", null],
    ["expired", { userId: "user_1", expiresAt: new Date(Date.now() - 1) }],
  ])(
    "refuses a caller whose session is %s but still cached",
    async (_state, row) => {
      sessionFindUnique.mockResolvedValue(row);
      sessionFindFirst.mockResolvedValue({ token: "other-token" });

      const response = await createApp().request("/me/sessions/other", {
        method: "DELETE",
      });

      expect(response.status).toBe(401);
      expect(sessionFindUnique.mock.calls[0]?.[0].where).toEqual({
        id: "current",
      });
      expect(deleteSession).not.toHaveBeenCalled();
    },
  );

  it("signs out another of the caller's sessions", async () => {
    sessionFindFirst.mockResolvedValue({ token: "other-token" });

    const response = await createApp().request("/me/sessions/other", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(sessionFindFirst.mock.calls[0]?.[0].where).toEqual({
      id: "other",
      userId: "user_1",
    });
    expect(deleteSession).toHaveBeenCalledWith("other-token");
  });

  it("answers 404 for a session the caller does not own", async () => {
    sessionFindFirst.mockResolvedValue(null);

    const response = await createApp().request("/me/sessions/theirs", {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("refuses to sign out the current session here", async () => {
    const response = await createApp().request("/me/sessions/current", {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
    expect(sessionFindFirst).not.toHaveBeenCalled();
  });
});
