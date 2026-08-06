import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPostAblyToken from "./post";

const { findManyMembersMock, createAblySubscribeTokenRequestMock } = vi.hoisted(
  () => ({
    findManyMembersMock: vi.fn(),
    createAblySubscribeTokenRequestMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomUserMember: {
      findMany: (...args: unknown[]) => findManyMembersMock(...args),
    },
  },
}));

vi.mock("@/lib/ably/create-token-request", () => ({
  createAblySubscribeTokenRequest: (...args: unknown[]) =>
    createAblySubscribeTokenRequestMock(...args),
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{ Variables: EnvVariables["Variables"] }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostAblyToken(app);
  return app;
}

describe("POST /realtime/ably-token", () => {
  beforeEach(() => {
    findManyMembersMock.mockReset();
    createAblySubscribeTokenRequestMock.mockReset();
  });

  it("mints a token from the caller's membership room ids", async () => {
    findManyMembersMock.mockResolvedValue([
      { roomId: "room-a" },
      { roomId: "room-b" },
    ]);
    createAblySubscribeTokenRequestMock.mockResolvedValue({
      keyName: "app.key",
      capability: '{"x":["subscribe"]}',
      timestamp: 1_700_000_000_000,
      nonce: "n1",
      mac: "m1",
      clientId: "user_123",
    });

    const app = createApp();
    const response = await app.request("http://localhost/ably-token", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(findManyMembersMock).toHaveBeenCalledWith({
      where: { userId: "user_123" },
      select: { roomId: true },
    });
    expect(createAblySubscribeTokenRequestMock).toHaveBeenCalledWith(
      "user_123",
      ["room-a", "room-b"],
    );

    const body = await response.json();
    expect(body.data).toMatchObject({
      keyName: "app.key",
      clientId: "user_123",
      mac: "m1",
    });
  });

  it("mints with an empty room list when the user has no memberships", async () => {
    findManyMembersMock.mockResolvedValue([]);
    createAblySubscribeTokenRequestMock.mockResolvedValue({
      keyName: "app.key",
      capability: "{}",
      timestamp: 1_700_000_000_000,
      nonce: "n1",
      mac: "m1",
      clientId: "user_123",
    });

    const app = createApp();
    const response = await app.request("http://localhost/ably-token", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(createAblySubscribeTokenRequestMock).toHaveBeenCalledWith(
      "user_123",
      [],
    );
  });

  it("rejects coworker actors (owner-only mint)", async () => {
    const coworkerContext: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "vendor_123",
    };
    const app = createApp(coworkerContext);
    const response = await app.request("http://localhost/ably-token", {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(createAblySubscribeTokenRequestMock).not.toHaveBeenCalled();
    expect(findManyMembersMock).not.toHaveBeenCalled();
  });
});
