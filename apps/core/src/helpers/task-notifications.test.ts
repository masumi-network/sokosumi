import { beforeEach, describe, expect, it, vi } from "vitest";

const { createNotificationMock } = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
}));

vi.mock("./notifications.js", () => ({
  createNotification: createNotificationMock,
}));

import { dispatchTaskNotification } from "./task-notifications";

describe("dispatchTaskNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNotificationMock.mockResolvedValue({});
  });

  it("names the assigned orchestrator in task notifications", async () => {
    await dispatchTaskNotification(
      {
        id: "task_1",
        ownerId: "user_1",
        name: "Launch",
        assignee: null,
        assigneeOrchestrator: { name: "Nora" },
        project: null,
        projectId: null,
        workspaceId: null,
      },
      "event_1",
      "COMPLETED",
    );

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageParams: {
          coworkerName: "Nora",
          taskName: "Launch",
        },
      }),
    );
  });
});
