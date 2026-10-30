import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultValidationHook, type EnvVariables } from "@/lib/hono";

import mountPostAblyToken from "./post";

const { findRoomMembers } = vi.hoisted(() => ({
  findRoomMembers: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    ABLY_SUBSCRIBE_ONLY_KEY: "fake.key:ZmFrZQ==",
    NETWORK: "Mainnet",
    VERCEL_ENV: "production",
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomUserMember: { findMany: findRoomMembers },
    member: { findMany: async () => [] },
    workspace: { findMany: async () => [] },
  },
}));

const SELECTED_ROOM_ID = "00000000-0000-4000-8000-000000000001";
const FOREIGN_ROOM_ID = "10000000-0000-4000-8000-000000000001";
const MEMBERSHIP_COUNT = 1_000;
const SDK_AUTH_PAYLOAD_LIMIT = 131_072;
const memberships = Array.from({ length: MEMBERSHIP_COUNT }, (_, index) => ({
  roomId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
}));

function createApp() {
  const app = new OpenAPIHono<{ Variables: EnvVariables["Variables"] }>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
    await next();
  });
  mountPostAblyToken(app);
  return app;
}

describe("browser Ably room scope", () => {
  beforeEach(() => {
    findRoomMembers.mockReset();
    findRoomMembers.mockImplementation(
      async ({ where }: { where: { roomId?: { in: string[] } } }) =>
        memberships.filter(
          ({ roomId }) => !where.roomId || where.roomId.in.includes(roomId),
        ),
    );
  });

  it("keeps the selected room token small with 1,000 historical memberships", async () => {
    const response = await createApp().request(
      `http://localhost/ably-token?roomIds=${SELECTED_ROOM_ID}`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(JSON.stringify(data).length).toBeLessThan(SDK_AUTH_PAYLOAD_LIMIT);
    expect(JSON.parse(data.capability)).toEqual({
      "agent_jobs:*:user_user_123": ["subscribe"],
      "tasks:all:user_user_123": ["subscribe"],
      "notifications:all:user_user_123": [
        "presence",
        "push-subscribe",
        "subscribe",
      ],
      "chat_control:user_user_123": ["subscribe"],
      "calendar_control:user_user_123": ["subscribe"],
      [`chat_rooms:room_${SELECTED_ROOM_ID}`]: ["subscribe"],
      [`chat_typing:room_${SELECTED_ROOM_ID}`]: ["publish", "subscribe"],
    });
  });

  it("never grants a requested room without current membership", async () => {
    const response = await createApp().request(
      `http://localhost/ably-token?roomIds=${SELECTED_ROOM_ID},${FOREIGN_ROOM_ID}`,
      { method: "POST" },
    );
    const { data } = await response.json();
    const capability = JSON.parse(data.capability);
    expect(capability[`chat_rooms:room_${SELECTED_ROOM_ID}`]).toEqual([
      "subscribe",
    ]);
    expect(capability).not.toHaveProperty(`chat_rooms:room_${FOREIGN_ROOM_ID}`);
    expect(capability).not.toHaveProperty(
      `chat_typing:room_${FOREIGN_ROOM_ID}`,
    );
  });

  it("grants no chat rooms for an explicit empty browser scope", async () => {
    const response = await createApp().request(
      "http://localhost/ably-token?roomIds=",
      {
        method: "POST",
      },
    );
    const { data } = await response.json();
    expect(Object.keys(JSON.parse(data.capability))).toHaveLength(5);
  });

  it("preserves every membership when a native client omits the scope", async () => {
    const response = await createApp().request("http://localhost/ably-token", {
      method: "POST",
    });
    const { data } = await response.json();
    expect(Object.keys(JSON.parse(data.capability))).toHaveLength(2_005);
  });

  it("rejects malformed room ids before reading memberships", async () => {
    const response = await createApp().request(
      "http://localhost/ably-token?roomIds=bad",
      {
        method: "POST",
      },
    );
    expect(response.status).toBe(422);
    expect(findRoomMembers).not.toHaveBeenCalled();
  });
});
