import { describe, expect, it } from "vitest";

import {
  makeAgentJobsChannelName,
  makeUserTasksChannelName,
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
