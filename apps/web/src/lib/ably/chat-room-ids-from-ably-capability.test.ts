import type { RealtimeChannelEnvironment } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatRoomIdsFromAblyCapability } from "./chat-room-ids-from-ably-capability";

const { channelEnvironment } = vi.hoisted(() => ({
  channelEnvironment: vi.fn<() => RealtimeChannelEnvironment>(),
}));

vi.mock("./realtime-channel-environment", () => ({
  getRealtimeChannelEnvironment: channelEnvironment,
}));

beforeEach(() => {
  channelEnvironment.mockReturnValue({
    network: "Mainnet",
    vercelEnv: "production",
  });
});

describe("chatRoomIdsFromAblyCapability", () => {
  it("reads only this preview's rooms from a preview token", () => {
    channelEnvironment.mockReturnValue({
      network: "Mainnet",
      vercelEnv: "preview",
      vercelGitCommitRef: "fix/x",
    });

    expect(
      chatRoomIdsFromAblyCapability({
        "chat_rooms:preview:mainnet:branch_fix%2Fx:room_r1": ["subscribe"],
        "chat_rooms:room_r2": ["subscribe"],
      }),
    ).toEqual(new Set(["r1"]));
  });

  it("parses JSON string capability and ignores non-room channels", () => {
    const capability = JSON.stringify({
      "chat_rooms:room_room-a": ["subscribe"],
      "chat_rooms:room_room-b": ["subscribe"],
      "notifications:all:user_x": ["subscribe"],
      "agent_jobs:*:user_x": ["subscribe"],
    });

    expect(chatRoomIdsFromAblyCapability(capability)).toEqual(
      new Set(["room-a", "room-b"]),
    );
  });

  it("parses object capability and returns empty set when no rooms", () => {
    expect(
      chatRoomIdsFromAblyCapability({
        "notifications:all:user_x": ["subscribe"],
      }),
    ).toEqual(new Set());
  });

  it("ignores room channels without subscribe capability", () => {
    expect(
      chatRoomIdsFromAblyCapability({
        "chat_rooms:room_room-a": ["subscribe"],
        "chat_rooms:room_room-b": ["publish"],
        "chat_rooms:room_room-c": ["presence", "history"],
      }),
    ).toEqual(new Set(["room-a"]));
  });

  it("returns null for missing or malformed capability", () => {
    expect(chatRoomIdsFromAblyCapability(undefined)).toBeNull();
    expect(chatRoomIdsFromAblyCapability(null)).toBeNull();
    expect(chatRoomIdsFromAblyCapability("not-json")).toBeNull();
    expect(chatRoomIdsFromAblyCapability(["chat_rooms:room_a"])).toBeNull();
  });
});
