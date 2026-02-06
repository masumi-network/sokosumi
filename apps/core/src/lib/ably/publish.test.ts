import { describe, expect, it, vi } from "vitest";

import { publishTaskEventData } from "./publish";

const { publishMock, getMock } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock("./client", () => ({
  getRestClient: () => ({
    channels: {
      get: (...args: unknown[]) => {
        getMock(...args);
        return { publish: publishMock };
      },
    },
  }),
}));

describe("publishTaskEventData", () => {
  it("publishes task event data to the user channel", async () => {
    await publishTaskEventData({
      userId: "user_123",
      taskId: "tsk_123",
      eventType: "task_event",
    });

    expect(getMock).toHaveBeenCalledWith("tasks:all:user_user_123");
    expect(publishMock).toHaveBeenCalledWith("task_event", {
      taskId: "tsk_123",
      eventType: "task_event",
    });
  });
});
