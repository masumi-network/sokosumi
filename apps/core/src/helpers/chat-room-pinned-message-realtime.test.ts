import { CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishMock, channelsGetMock, channelEnvironmentMock } = vi.hoisted(
  () => ({
    publishMock: vi.fn(),
    channelsGetMock: vi.fn(),
    channelEnvironmentMock: vi.fn(),
  }),
);

vi.mock("@/lib/ably/realtime-channel-environment", () => ({
  getRealtimeChannelEnvironment: () => channelEnvironmentMock(),
}));

vi.mock("@/lib/ably/client", () => ({
  getRestClient: () => ({ channels: { get: channelsGetMock } }),
}));

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import { publishChatRoomPinnedMessageRealtime } from "./chat-room-pinned-message-realtime";

const ROOM_ID = "660e8400-e29b-41d4-a716-446655440000";
const INPUT = {
  action: "pin",
  roomId: ROOM_ID,
  messageId: "550e8400-e29b-41d4-a716-446655440000",
  pinnedMessageCount: 1,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  publishMock.mockResolvedValue(undefined);
  channelsGetMock.mockReturnValue({ publish: publishMock });
});

describe("publishChatRoomPinnedMessageRealtime", () => {
  it("publishes on the production room channel in production", async () => {
    channelEnvironmentMock.mockReturnValue({
      network: "Mainnet",
      vercelEnv: "production",
      vercelGitCommitRef: "main",
    });

    await publishChatRoomPinnedMessageRealtime(INPUT);

    expect(channelsGetMock).toHaveBeenCalledWith(`chat_rooms:room_${ROOM_ID}`);
    expect(publishMock).toHaveBeenCalledWith(
      CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME,
      INPUT,
    );
  });

  it("publishes a preview pin on the scoped room channel", async () => {
    channelEnvironmentMock.mockReturnValue({
      network: "Mainnet",
      vercelEnv: "preview",
      vercelGitCommitRef: "fix/x",
    });

    await publishChatRoomPinnedMessageRealtime(INPUT);

    expect(channelsGetMock).toHaveBeenCalledWith(
      `chat_rooms:preview:mainnet:branch_fix%2Fx:room_${ROOM_ID}`,
    );
  });
});
