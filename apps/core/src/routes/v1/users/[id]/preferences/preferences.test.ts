import { OpenAPIHono } from "@hono/zod-openapi";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
} from "@sokosumi/utils";
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
  notificationPreferenceUpsertMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  txUserFindUniqueMock: vi.fn(),
  notificationPreferenceUpsertMock: vi.fn(),
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
  notificationPreferences: [] as {
    category: string;
    channel: string;
    enabled: boolean;
  }[],
};

/** The flags a client reads, without the matrix the response resolves. */
const PREFERENCE_FLAGS = {
  marketingOptIn: PREFERENCES.marketingOptIn,
  notificationsOptIn: PREFERENCES.notificationsOptIn,
  pushOptIn: PREFERENCES.pushOptIn,
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
          notificationPreference: {
            upsert: typeof notificationPreferenceUpsertMock;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          user: { findUnique: txUserFindUniqueMock, update: userUpdateMock },
          notificationPreference: { upsert: notificationPreferenceUpsertMock },
        }),
    );
  });

  it("returns pushOptIn on GET", async () => {
    const app = createPreferencesApp(SESSION_USER);
    const response = await app.request("http://localhost/me/preferences");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject(PREFERENCE_FLAGS);
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
        notificationPreferences: {
          select: { category: true, channel: true, enabled: true },
        },
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
        notificationPreferences: {
          select: { category: true, channel: true, enabled: true },
        },
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

  it("returns every matrix cell on GET, with the reader's choices applied", async () => {
    txUserFindUniqueMock.mockResolvedValue({
      ...PREFERENCES,
      notificationPreferences: [
        { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
      ],
    });
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request("http://localhost/me/preferences");

    expect(response.status).toBe(200);
    const body = await response.json();
    // Every cell, not the one stored row: the client renders the matrix it is
    // given rather than filling in the defaults itself.
    expect(body.data.notificationPreferences).toHaveLength(
      NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length,
    );
    expect(body.data.notificationPreferences).toContainEqual({
      category: "CHAT_MENTION",
      channel: "OS_BANNER",
      enabled: false,
    });
    expect(body.data.notificationPreferences).toContainEqual({
      category: "CHAT_MENTION",
      channel: "IN_APP",
      enabled: true,
    });
  });

  it("writes one matrix cell on PATCH without touching the account flags", async () => {
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request(
      patchRequest("/me/preferences", {
        notificationPreferences: [
          { category: "JOB_ATTENTION", channel: "OS_BANNER", enabled: false },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(notificationPreferenceUpsertMock).toHaveBeenCalledWith({
      where: {
        userId_category_channel: {
          userId: "user_123",
          category: "JOB_ATTENTION",
          channel: "OS_BANNER",
        },
      },
      create: {
        userId: "user_123",
        category: "JOB_ATTENTION",
        channel: "OS_BANNER",
        enabled: false,
      },
      update: { enabled: false },
    });
    // An empty user update would still bump `updatedAt`, so the route reads
    // instead of writing when only the matrix changed.
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(txUserFindUniqueMock).toHaveBeenCalled();
  });

  it("rejects a category this build does not know", async () => {
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request(
      patchRequest("/me/preferences", {
        notificationPreferences: [
          { category: "PIGEON", channel: "IN_APP", enabled: false },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(notificationPreferenceUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects a body asking for more writes than the matrix has cells", async () => {
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request(
      patchRequest("/me/preferences", {
        // One more than the matrix has cells, so the cap moves with the
        // vocabulary instead of being a number someone has to remember.
        notificationPreferences: Array.from(
          {
            length:
              NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length + 1,
          },
          () => ({
            category: "JOB_ATTENTION",
            channel: "IN_APP",
            enabled: false,
          }),
        ),
      }),
    );

    expect(response.status).toBe(400);
    expect(notificationPreferenceUpsertMock).not.toHaveBeenCalled();
  });

  /**
   * The other half of the cap: a cap that is too small fails no test if only
   * the rejection is checked, and the settings page writes whole groups.
   */
  it("accepts a write that names every cell of the matrix", async () => {
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request(
      patchRequest("/me/preferences", {
        notificationPreferences: NOTIFICATION_CATEGORIES.flatMap((category) =>
          NOTIFICATION_CHANNELS.map((channel) => ({
            category,
            channel,
            enabled: false,
          })),
        ),
      }),
    );

    expect(response.status).toBe(200);
    expect(notificationPreferenceUpsertMock).toHaveBeenCalledTimes(
      NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length,
    );
  });

  it("rejects a PATCH whose only field is an empty matrix", async () => {
    const app = createPreferencesApp(SESSION_USER);

    const response = await app.request(
      patchRequest("/me/preferences", { notificationPreferences: [] }),
    );

    expect(response.status).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
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
