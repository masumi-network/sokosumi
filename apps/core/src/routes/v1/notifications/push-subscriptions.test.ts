import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountDeletePushSubscription from "./push-subscriptions/delete";
import mountUpsertPushSubscription from "./push-subscriptions/post";
import mountGetPushVapidPublicKey from "./push-vapid-public-key/get";

const {
  pushSubscriptionFindUniqueMock,
  pushSubscriptionCreateMock,
  pushSubscriptionUpdateMock,
  pushSubscriptionDeleteManyMock,
} = vi.hoisted(() => ({
  pushSubscriptionFindUniqueMock: vi.fn(),
  pushSubscriptionCreateMock: vi.fn(),
  pushSubscriptionUpdateMock: vi.fn(),
  pushSubscriptionDeleteManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    pushSubscription: {
      findUnique: pushSubscriptionFindUniqueMock,
      create: pushSubscriptionCreateMock,
      update: pushSubscriptionUpdateMock,
      deleteMany: pushSubscriptionDeleteManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_123",
  vendorId: "vendor_123",
};

function createApp(
  mount: (app: OpenAPIHonoWithAuth) => void,
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mount(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /notifications/push-vapid-public-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the VAPID public key for a session user", async () => {
    const app = createApp(mountGetPushVapidPublicKey);
    const response = await app.request(
      "http://localhost/push-vapid-public-key",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { publicKey: string } };
    expect(body.data.publicKey).toBe(
      "BERlQWGm1ulGfhTWWJYMqZrrd0UBbuiVxcKx87i9lYX34uKq7CYrju3AdJ8sHK5H_FcywqQEpZZxlLOo0fufH-Y",
    );
  });

  it("returns 403 for coworker actors", async () => {
    const app = createApp(mountGetPushVapidPublicKey, COWORKER_AUTH_CONTEXT);
    const response = await app.request(
      "http://localhost/push-vapid-public-key",
    );

    expect(response.status).toBe(403);
  });
});

describe("POST /notifications/push-subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a push subscription for the authenticated user", async () => {
    const row = {
      id: "sub_123",
      userId: "user_123",
      endpoint: "https://push.example/endpoint",
      p256dh: "p256dh-key",
      auth: "auth-key",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    pushSubscriptionFindUniqueMock.mockResolvedValue(null);
    pushSubscriptionCreateMock.mockResolvedValue(row);

    const app = createApp(mountUpsertPushSubscription);
    const response = await app.request("http://localhost/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://push.example/endpoint",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      }),
    });

    expect(response.status).toBe(200);
    expect(pushSubscriptionCreateMock).toHaveBeenCalledWith({
      data: {
        userId: "user_123",
        endpoint: "https://push.example/endpoint",
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
    });
    expect(pushSubscriptionUpdateMock).not.toHaveBeenCalled();

    const body = (await response.json()) as {
      data: { id: string; endpoint: string };
    };
    expect(body.data).toEqual({
      id: "sub_123",
      endpoint: "https://push.example/endpoint",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("updates keys when the endpoint already belongs to the user", async () => {
    const existing = {
      id: "sub_123",
      userId: "user_123",
      endpoint: "https://push.example/endpoint",
      p256dh: "old-p256dh",
      auth: "old-auth",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const updated = {
      ...existing,
      p256dh: "p256dh-key",
      auth: "auth-key",
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    };
    pushSubscriptionFindUniqueMock.mockResolvedValue(existing);
    pushSubscriptionUpdateMock.mockResolvedValue(updated);

    const app = createApp(mountUpsertPushSubscription);
    const response = await app.request("http://localhost/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://push.example/endpoint",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      }),
    });

    expect(response.status).toBe(200);
    expect(pushSubscriptionUpdateMock).toHaveBeenCalledWith({
      where: { id: "sub_123" },
      data: {
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
    });
    expect(pushSubscriptionCreateMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the endpoint belongs to another user", async () => {
    pushSubscriptionFindUniqueMock.mockResolvedValue({
      id: "sub_other",
      userId: "user_other",
      endpoint: "https://push.example/endpoint",
      p256dh: "p256dh-key",
      auth: "auth-key",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const app = createApp(mountUpsertPushSubscription);
    const response = await app.request("http://localhost/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://push.example/endpoint",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      }),
    });

    expect(response.status).toBe(409);
    expect(pushSubscriptionCreateMock).not.toHaveBeenCalled();
    expect(pushSubscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker actors", async () => {
    const app = createApp(mountUpsertPushSubscription, COWORKER_AUTH_CONTEXT);
    const response = await app.request("http://localhost/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://push.example/endpoint",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      }),
    });

    expect(response.status).toBe(403);
    expect(pushSubscriptionFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /notifications/push-subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the subscription and returns 204", async () => {
    pushSubscriptionDeleteManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(mountDeletePushSubscription);
    const response = await app.request("http://localhost/push-subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://push.example/endpoint",
      }),
    });

    expect(response.status).toBe(204);
    expect(pushSubscriptionDeleteManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        endpoint: "https://push.example/endpoint",
      },
    });
  });

  it("returns 204 when the endpoint is already gone", async () => {
    pushSubscriptionDeleteManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(mountDeletePushSubscription);
    const response = await app.request("http://localhost/push-subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://push.example/missing",
      }),
    });

    expect(response.status).toBe(204);
  });
});
