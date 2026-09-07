import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  prismaTaskFindUniqueMock,
  prismaUserFindUniqueMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  prismaTaskFindUniqueMock: vi.fn(),
  prismaUserFindUniqueMock: vi.fn(),
}));

vi.mock("./notifications.js", () => ({
  createNotification: createNotificationMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findUnique: prismaTaskFindUniqueMock },
    user: { findUnique: prismaUserFindUniqueMock },
  },
}));

import {
  dispatchTaskNotification,
  notifyTaskHumanAssignee,
} from "./task-notifications";

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

describe("notifyTaskHumanAssignee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNotificationMock.mockResolvedValue({});
    prismaTaskFindUniqueMock.mockResolvedValue({
      id: "tsk_123",
      name: "Review onboarding",
      projectId: null,
      workspaceId: "ws_123",
      assigneeUserId: "user_assignee",
      project: null,
    });
    prismaUserFindUniqueMock.mockResolvedValue({ notificationsOptIn: true });
  });

  it("notifies the user when they become the assignee", async () => {
    await notifyTaskHumanAssignee("tsk_123", "user_assignee");

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_assignee",
        messageKey: "Notifications.Task.assigned",
      }),
    );
  });

  it("does nothing when the task no longer carries that assignee", async () => {
    prismaTaskFindUniqueMock.mockResolvedValue({
      id: "tsk_123",
      name: "Review onboarding",
      projectId: null,
      workspaceId: "ws_123",
      assigneeUserId: null,
      project: null,
    });

    await notifyTaskHumanAssignee("tsk_123", "user_assignee");

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("does nothing when the user opted out", async () => {
    prismaUserFindUniqueMock.mockResolvedValue({ notificationsOptIn: false });

    await notifyTaskHumanAssignee("tsk_123", "user_assignee");

    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});
