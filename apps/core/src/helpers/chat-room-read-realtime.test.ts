import {
  CHAT_ROOM_READ_EVENT_NAME,
  makeChatRoomChannelName,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCTION = {
  network: "Mainnet",
  vercelEnv: "production",
  vercelGitCommitRef: "main",
} as const;

const {
  publishMock,
  channelsGetMock,
  captureExceptionMock,
  channelEnvironmentMock,
} = vi.hoisted(() => ({
  publishMock: vi.fn(),
  channelsGetMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  channelEnvironmentMock: vi.fn(),
}));

vi.mock("@/lib/ably/realtime-channel-environment", () => ({
  getRealtimeChannelEnvironment: () => channelEnvironmentMock(),
}));

vi.mock("@/lib/ably/client", () => ({
  getRestClient: () => ({ channels: { get: channelsGetMock } }),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { publishChatRoomReadRealtime } from "./chat-room-read-realtime";

const ROOM_ID = "660e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_reader";
const LAST_READ_AT = new Date("2026-08-03T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  publishMock.mockResolvedValue(undefined);
  channelsGetMock.mockReturnValue({ publish: publishMock });
  channelEnvironmentMock.mockReturnValue(PRODUCTION);
});

describe("publishChatRoomReadRealtime", () => {
  it("publishes the room, the reader and the new Room last-read on the room channel", async () => {
    await publishChatRoomReadRealtime({
      roomId: ROOM_ID,
      userId: USER_ID,
      lastReadAt: LAST_READ_AT,
    });

    expect(channelsGetMock).toHaveBeenCalledWith(
      makeChatRoomChannelName(ROOM_ID, PRODUCTION),
    );
    expect(publishMock).toHaveBeenCalledWith({
      name: CHAT_ROOM_READ_EVENT_NAME,
      data: {
        roomId: ROOM_ID,
        userId: USER_ID,
        lastReadAt: LAST_READ_AT.toISOString(),
      },
      // Derived and re-sent with every room payload, so it has no business in
      // history, rewind or resume.
      extras: { ephemeral: true },
    });
  });

  it("publishes a preview read receipt on the scoped room channel", async () => {
    channelEnvironmentMock.mockReturnValueOnce({
      network: "Mainnet",
      vercelEnv: "preview",
      vercelGitCommitRef: "fix/x",
    });

    await publishChatRoomReadRealtime({
      roomId: ROOM_ID,
      userId: USER_ID,
      lastReadAt: LAST_READ_AT,
    });

    expect(channelsGetMock).toHaveBeenCalledWith(
      `chat_rooms:preview:mainnet:branch_fix%2Fx:room_${ROOM_ID}`,
    );
  });

  it("swallows a publish failure so the caller never sees it", async () => {
    publishMock.mockRejectedValue(new Error("ably down"));

    await expect(
      publishChatRoomReadRealtime({
        roomId: ROOM_ID,
        userId: USER_ID,
        lastReadAt: LAST_READ_AT,
      }),
    ).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
