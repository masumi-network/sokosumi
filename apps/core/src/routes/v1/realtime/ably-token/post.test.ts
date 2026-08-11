import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPostAblyToken from "./post";

const {
  findManyRoomMembersMock,
  findManyOrgMembersMock,
  createAblyClientTokenRequestMock,
} = vi.hoisted(() => ({
  findManyRoomMembersMock: vi.fn(),
  findManyOrgMembersMock: vi.fn(),
  createAblyClientTokenRequestMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomUserMember: {
      findMany: (...args: unknown[]) => findManyRoomMembersMock(...args),
    },
    member: {
      findMany: (...args: unknown[]) => findManyOrgMembersMock(...args),
    },
  },
}));

vi.mock("@/lib/ably/create-token-request", () => ({
  createAblyClientTokenRequest: (...args: unknown[]) =>
    createAblyClientTokenRequestMock(...args),
  createAblySubscribeTokenRequest: vi.fn(),
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
    findManyRoomMembersMock.mockReset();
    findManyOrgMembersMock.mockReset();
    createAblyClientTokenRequestMock.mockReset();
  });

  it("mints a token from room + org memberships and client instance id", async () => {
    findManyRoomMembersMock.mockResolvedValue([
      { roomId: "room-a" },
      { roomId: "room-b" },
    ]);
    findManyOrgMembersMock.mockResolvedValue([
      { organizationId: "org_a" },
      { organizationId: "org_b" },
    ]);
    createAblyClientTokenRequestMock.mockResolvedValue({
      keyName: "app.key",
      capability: '{"x":["subscribe"]}',
      timestamp: 1_700_000_000_000,
      nonce: "n1",
      mac: "m1",
      clientId: "user_123:inst_abcd",
    });

    const app = createApp();
    const response = await app.request(
      "http://localhost/ably-token?clientInstanceId=inst_abcd",
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(findManyRoomMembersMock).toHaveBeenCalledWith({
      where: { userId: "user_123" },
      select: { roomId: true },
    });
    expect(findManyOrgMembersMock).toHaveBeenCalledWith({
      where: { userId: "user_123" },
      select: { organizationId: true },
    });
    expect(createAblyClientTokenRequestMock).toHaveBeenCalledWith({
      userId: "user_123",
      roomIds: ["room-a", "room-b"],
      organizationIds: ["org_a", "org_b"],
      clientInstanceId: "inst_abcd",
    });

    const body = await response.json();
    expect(body.data).toMatchObject({
      keyName: "app.key",
      clientId: "user_123:inst_abcd",
      mac: "m1",
    });
  });

  it("mints with empty lists when the user has no memberships", async () => {
    findManyRoomMembersMock.mockResolvedValue([]);
    findManyOrgMembersMock.mockResolvedValue([]);
    createAblyClientTokenRequestMock.mockResolvedValue({
      keyName: "app.key",
      capability: "{}",
      timestamp: 1_700_000_000_000,
      nonce: "n1",
      mac: "m1",
      clientId: "user_123:default00",
    });

    const app = createApp();
    const response = await app.request("http://localhost/ably-token", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(createAblyClientTokenRequestMock).toHaveBeenCalledWith({
      userId: "user_123",
      roomIds: [],
      organizationIds: [],
      clientInstanceId: "default00",
    });
  });

  it("rejects invalid clientInstanceId", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/ably-token?clientInstanceId=bad",
      { method: "POST" },
    );

    expect(response.status).toBe(400);
    expect(createAblyClientTokenRequestMock).not.toHaveBeenCalled();
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
    expect(createAblyClientTokenRequestMock).not.toHaveBeenCalled();
    expect(findManyRoomMembersMock).not.toHaveBeenCalled();
  });
});
