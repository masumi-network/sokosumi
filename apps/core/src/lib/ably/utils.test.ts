import { describe, expect, it } from "vitest";

import { makeUserTasksChannelName } from "./utils";

describe("makeUserTasksChannelName", () => {
  it("builds a user-scoped tasks channel", () => {
    expect(makeUserTasksChannelName("user_123")).toBe(
      "tasks:all:user_user_123",
    );
  });
});
