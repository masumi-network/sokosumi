import { describe, expect, it } from "vitest";

import {
  makeAgentJobsChannelName,
  makeChatRoomChannelName,
  makeUserTasksChannelName,
} from "./utils";

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
    expect(makeChatRoomChannelName("room_abc")).toBe(
      "chat_rooms:room_room_abc",
    );
  });
});
