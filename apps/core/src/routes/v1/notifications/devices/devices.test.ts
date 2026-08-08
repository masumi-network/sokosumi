import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountUnregisterPushDevice from "./delete";
import mountRegisterPushDevice from "./post";

const { pushDeviceUpsertMock, pushDeviceDeleteManyMock } = vi.hoisted(() => ({
  pushDeviceUpsertMock: vi.fn(),
  pushDeviceDeleteManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    pushDevice: {
      upsert: pushDeviceUpsertMock,
      deleteMany: pushDeviceDeleteManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const COWORKER_AUTH_CONTEXT = {
  actor: "coworker",
  coworkerId: "coworker_123",
  userId: "user_123",
  organizationId: "org_123",
} as unknown as AuthenticationContext;

const TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";

function createDeviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "0199c0f0-0000-7000-8000-000000000000",
    userId: "user_123",
    token: TOKEN,
    platform: "IOS",
    lastSeenAt: new Date("2026-08-08T09:00:00.000Z"),
    createdAt: new Date("2026-08-08T09:00:00.000Z"),
    updatedAt: new Date("2026-08-08T09:00:00.000Z"),
    ...overrides,
  };
}

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

function post(body: unknown) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("POST /notifications/devices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a device for the signed-in user", async () => {
    pushDeviceUpsertMock.mockResolvedValue(createDeviceRow());

    const app = createApp(mountRegisterPushDevice);
    const response = await app.request(
      "http://localhost/devices",
      post({ token: TOKEN, platform: "IOS" }),
    );

    expect(response.status).toBe(200);
    expect(pushDeviceUpsertMock).toHaveBeenCalledWith({
      where: { userId_token: { userId: "user_123", token: TOKEN } },
      create: { userId: "user_123", token: TOKEN, platform: "IOS" },
      update: { platform: "IOS", lastSeenAt: expect.any(Date) },
    });
  });

  it("refreshes rather than duplicating, so the app can register every launch", async () => {
    pushDeviceUpsertMock.mockResolvedValue(createDeviceRow());

    const app = createApp(mountRegisterPushDevice);
    await app.request(
      "http://localhost/devices",
      post({ token: TOKEN, platform: "IOS" }),
    );

    const call = pushDeviceUpsertMock.mock.calls[0][0];
    expect(call.update.lastSeenAt).toBeInstanceOf(Date);
    expect(call.where).toEqual({
      userId_token: { userId: "user_123", token: TOKEN },
    });
  });

  it("never returns the token it was given", async () => {
    // The response describes the registration, not the address. Echoing a push
    // token back adds a way to read one out that did not otherwise exist.
    pushDeviceUpsertMock.mockResolvedValue(createDeviceRow());

    const app = createApp(mountRegisterPushDevice);
    const response = await app.request(
      "http://localhost/devices",
      post({ token: TOKEN, platform: "IOS" }),
    );

    expect(JSON.stringify(await response.json())).not.toContain(TOKEN);
  });

  it("rejects an unknown platform", async () => {
    const app = createApp(mountRegisterPushDevice);
    const response = await app.request(
      "http://localhost/devices",
      post({ token: TOKEN, platform: "WINDOWS_PHONE" }),
    );

    expect(response.status).toBe(400);
    expect(pushDeviceUpsertMock).not.toHaveBeenCalled();
  });

  it("rejects an empty token", async () => {
    const app = createApp(mountRegisterPushDevice);
    const response = await app.request(
      "http://localhost/devices",
      post({ token: "", platform: "IOS" }),
    );

    expect(response.status).toBe(400);
    expect(pushDeviceUpsertMock).not.toHaveBeenCalled();
  });

  it("refuses a coworker acting on the user's behalf", async () => {
    // A coworker must not be able to point someone's notifications at a device.
    const app = createApp(mountRegisterPushDevice, COWORKER_AUTH_CONTEXT);
    const response = await app.request(
      "http://localhost/devices",
      post({ token: TOKEN, platform: "IOS" }),
    );

    expect(response.status).toBe(403);
    expect(pushDeviceUpsertMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /notifications/devices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes only this user's row for the token", async () => {
    // Scoped to the caller: unregistering must not be a way to silence someone
    // else's device by guessing their token.
    pushDeviceDeleteManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(mountUnregisterPushDevice);
    const response = await app.request("http://localhost/devices", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });

    expect(response.status).toBe(200);
    expect(pushDeviceDeleteManyMock).toHaveBeenCalledWith({
      where: { userId: "user_123", token: TOKEN },
    });

    const body = (await response.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it("is not an error to unregister something that was never registered", async () => {
    // Signing out twice is not a failure the app can act on.
    pushDeviceDeleteManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(mountUnregisterPushDevice);
    const response = await app.request("http://localhost/devices", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(false);
  });

  it("refuses a coworker acting on the user's behalf", async () => {
    const app = createApp(mountUnregisterPushDevice, COWORKER_AUTH_CONTEXT);
    const response = await app.request("http://localhost/devices", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });

    expect(response.status).toBe(403);
    expect(pushDeviceDeleteManyMock).not.toHaveBeenCalled();
  });
});
