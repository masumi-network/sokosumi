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

  it("names the assigned soko bot in task notifications", async () => {
    await dispatchTaskNotification(
      {
        id: "task_1",
        ownerId: "user_1",
        name: "Launch",
        assignee: null,
        assigneeSokoBot: { name: "Nora" },
        project: null,
        projectId: null,
        workspaceId: null,
        owner: { notificationsOptIn: true },
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
