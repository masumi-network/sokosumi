import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserPreferences from "./get.js";
import mountPatchUserPreferences from "./patch.js";

const {
  userFindUniqueMock,
  userUpdateMock,
  prismaTransactionMock,
  txUserFindUniqueMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  txUserFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
      update: userUpdateMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

const PREFERENCES = {
  marketingOptIn: true,
  notificationsOptIn: false,
  pushOptIn: false,
};

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const SESSION_ADMIN: AuthenticationContext = {
  actor: "user",
  userId: "user_admin",
  organizationId: null,
  role: "admin",
};

function createPreferencesApp(
  authContext: AuthenticationContext,
): OpenAPIHono<{ Variables: AuthVariables }> {
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
  mountGetUserPreferences(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  mountPatchUserPreferences(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

function patchRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("user preferences routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      id: "user_123",
      ...PREFERENCES,
    });
    txUserFindUniqueMock.mockResolvedValue(PREFERENCES);
    prismaTransactionMock.mockImplementation(
      async (
        callback: (tx: {
          user: {
            findUnique: typeof txUserFindUniqueMock;
            update: typeof userUpdateMock;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          user: { findUnique: txUserFindUniqueMock, update: userUpdateMock },
        }),
    );
  });

  it("returns pushOptIn on GET", async () => {
    const app = createPreferencesApp(SESSION_USER);
    const response = await app.request("http://localhost/me/preferences");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(PREFERENCES);
    // Spelled out rather than reusing the route's own projection constant:
    // asserting against that constant is self-referential and cannot see a
    // field leave it. The mock ignores `select`, so this literal is the only
    // guard that a narrowed projection would 500 on the response schema parse.
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      select: {
        marketingOptIn: true,
        notificationsOptIn: true,
        pushOptIn: true,
      },
    });
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("writes pushOptIn on PATCH and returns the stored value", async () => {
    userUpdateMock.mockResolvedValue({ ...PREFERENCES, pushOptIn: true });
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request(
      patchRequest("/me/preferences", { pushOptIn: true }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.pushOptIn).toBe(true);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_123" },
      data: { pushOptIn: true },
      select: {
        marketingOptIn: true,
        notificationsOptIn: true,
        pushOptIn: true,
      },
    });
  });

  it("leaves the email opt-ins untouched when only pushOptIn is sent", async () => {
    userUpdateMock.mockResolvedValue({ ...PREFERENCES, pushOptIn: true });
    const app = createPreferencesApp(SESSION_USER);

    await app.request(patchRequest("/me/preferences", { pushOptIn: true }));

    const data = userUpdateMock.mock.calls[0]?.[0].data;
    expect(data).not.toHaveProperty("marketingOptIn");
    expect(data).not.toHaveProperty("notificationsOptIn");
  });

  it("rejects an empty PATCH body", async () => {
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request(patchRequest("/me/preferences", {}));

    expect(response.status).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a foreign user id on PATCH without writing", async () => {
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request(
      patchRequest("/user_456/preferences", { pushOptIn: true }),
    );

    expect(response.status).toBe(403);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a foreign user id on GET", async () => {
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request("http://localhost/user_456/preferences");

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("lets an admin write another user's pushOptIn", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_456" });
    userUpdateMock.mockResolvedValue({ ...PREFERENCES, pushOptIn: true });
    const app = createPreferencesApp(SESSION_ADMIN);

    const response = await app.request(
      patchRequest("/user_456/preferences", { pushOptIn: true }),
    );

    expect(response.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user_456" } }),
    );
  });
});
