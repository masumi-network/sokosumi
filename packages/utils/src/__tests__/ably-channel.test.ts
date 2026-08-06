import { describe, expect, it } from "vitest";

import {
  makeAgentJobsChannelName,
  makeChatRoomChannelName,
  makeUserTasksChannelName,
  parseChatRoomIdFromChannelName,
} from "../ably-channel";

describe("makeUserTasksChannelName", () => {
  it("builds a user-scoped tasks channel", () => {
    expect(makeUserTasksChannelName("user_123")).toBe(
      "tasks:all:user_user_123",
    );
  });
});

describe("makeAgentJobsChannelName", () => {
  it("builds an agent-user scoped jobs channel", () => {
    expect(makeAgentJobsChannelName("agent_123", "user_123")).toBe(
      "agent_jobs:agent_agent_123:user_user_123",
    );
  });
});

describe("makeChatRoomChannelName", () => {
  it("builds a room-scoped chat channel", () => {
    expect(
      makeChatRoomChannelName("660e8400-e29b-41d4-a716-446655440000"),
    ).toBe("chat_rooms:room_660e8400-e29b-41d4-a716-446655440000");
  });
});

describe("parseChatRoomIdFromChannelName", () => {
  it("round-trips makeChatRoomChannelName", () => {
    const roomId = "660e8400-e29b-41d4-a716-446655440000";
    expect(
      parseChatRoomIdFromChannelName(makeChatRoomChannelName(roomId)),
    ).toBe(roomId);
  });

  it("returns null for non-room channels and empty id", () => {
    expect(
      parseChatRoomIdFromChannelName("notifications:all:user_abc"),
    ).toBeNull();
    expect(parseChatRoomIdFromChannelName("chat_rooms:room_")).toBeNull();
    expect(parseChatRoomIdFromChannelName("chat_rooms:all:user_x")).toBeNull();
  });
});
