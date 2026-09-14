import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  prismaTaskFindFirstMock,
  prismaTaskFindUniqueMock,
  prismaUserFindUniqueMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  prismaTaskFindFirstMock: vi.fn(),
  prismaTaskFindUniqueMock: vi.fn(),
  prismaUserFindUniqueMock: vi.fn(),
}));

vi.mock("./notifications.js", () => ({
  createNotification: createNotificationMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findFirst: prismaTaskFindFirstMock,
      findUnique: prismaTaskFindUniqueMock,
    },
    user: { findUnique: prismaUserFindUniqueMock },
  },
}));

import {
  dispatchTaskNotification,
  notifyTaskCalendarAction,
  notifyTaskHumanAssignee,
} from "./task-notifications";

describe("notifyTaskCalendarAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTaskFindFirstMock.mockResolvedValue({
      id: "task_1",
      workspaceId: "workspace_1",
    });
    createNotificationMock.mockResolvedValue({});
  });

  it("notifies the owner only after confirming their current Task access", async () => {
    await notifyTaskCalendarAction({
      taskId: "task_1",
      taskName: "Launch",
      ownerId: "owner_1",
      actorUserId: "member_1",
      eventId: "event_1",
      messageKey: "Notifications.Task.scheduleUpdatedByMember",
      action: "update_schedule",
    });

    expect(prismaTaskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "task_1",
        ownerId: "owner_1",
        archivedAt: null,
        workspace: {
          OR: [
            { userId: "owner_1" },
            {
              organization: {
                members: { some: { userId: "owner_1" } },
              },
            },
          ],
        },
      },
      select: { id: true, workspaceId: true },
    });
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: "owner_1",
      kind: "TASK",
      referenceId: "task_1",
      eventId: "event_1",
      messageKey: "Notifications.Task.scheduleUpdatedByMember",
      messageParams: { taskName: "Launch" },
      metadata: { workspaceId: "workspace_1" },
      workspaceId: "workspace_1",
    });
  });

  it("suppresses self-actions without querying for access", async () => {
    await notifyTaskCalendarAction({
      taskId: "task_1",
      taskName: "Launch",
      ownerId: "owner_1",
      actorUserId: "owner_1",
      eventId: "event_1",
      messageKey: "Notifications.Task.scheduleUpdatedByMember",
      action: "update_schedule",
    });

    expect(prismaTaskFindFirstMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("suppresses notifications when the owner no longer has access", async () => {
    prismaTaskFindFirstMock.mockResolvedValue(null);

    await notifyTaskCalendarAction({
      taskId: "task_1",
      taskName: "Launch",
      ownerId: "owner_1",
      actorUserId: "member_1",
      eventId: "event_1",
      messageKey: "Notifications.Task.scheduleUpdatedByMember",
      action: "update_schedule",
    });

    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});

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
