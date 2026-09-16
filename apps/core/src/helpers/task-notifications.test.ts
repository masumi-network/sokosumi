import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  markSettledAttentionReadMock,
  prismaTaskFindUniqueMock,
  prismaUserFindUniqueMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  markSettledAttentionReadMock: vi.fn(),
  prismaTaskFindUniqueMock: vi.fn(),
  prismaUserFindUniqueMock: vi.fn(),
}));

vi.mock("./notification-read.js", () => ({
  markSettledAttentionRead: markSettledAttentionReadMock,
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

import { TASK_ATTENTION_MESSAGE_KEYS } from "@/helpers/notification-delivery";

import {
  dispatchTaskNotification,
  notifyTaskHumanAssignee,
} from "./task-notifications";

describe("dispatchTaskNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNotificationMock.mockResolvedValue({});
    markSettledAttentionReadMock.mockResolvedValue(0);
  });

  const SETTLED_TASK = {
    id: "task_1",
    ownerId: "user_1",
    assigneeUserId: null,
    name: "Launch",
    assignee: null,
    assigneeSokoBot: null,
    project: null,
    projectId: null,
    workspaceId: null,
  };

  /**
   * SOK-916 stories 14 and 15. Nothing marks a task's attention row read when
   * the task settles by itself: a teammate cancels it, or a run fails. This is
   * the seam every task status event already passes through, so it is where
   * that is recorded, rather than the follow-up sync re-checking the status.
   *
   * The key is handed on rather than the status, because what clears a row is
   * a property of the key and the two lists live side by side.
   */
  it.each(["COMPLETED", "FAILED", "CANCELED"])(
    "says a %s task has stopped waiting on its reader",
    async (status) => {
      await dispatchTaskNotification(SETTLED_TASK, "event_1", status);

      expect(markSettledAttentionReadMock).toHaveBeenCalledWith(
        "user_1",
        "TASK",
        "task_1",
        `Notifications.Task.${status.toLowerCase()}`,
      );
    },
  );

  /**
   * A task that is waiting on the reader must not clear its own attention
   * row: that is the row the reminder exists for. The helper refuses these
   * keys itself, and this pins that the seam does not decide differently.
   */
  it.each(["INPUT_REQUIRED", "APPROVAL_REQUIRED", "OUT_OF_CREDITS"])(
    "still hands a %s task's key on, for the helper to refuse",
    async (status) => {
      await dispatchTaskNotification(SETTLED_TASK, "event_1", status);

      const [, , , messageKey] =
        markSettledAttentionReadMock.mock.calls[0] ?? [];

      expect(TASK_ATTENTION_MESSAGE_KEYS).toContain(messageKey);
    },
  );

  /**
   * The owner is not always the reader who was asked. `notifyTaskHumanAssignee`
   * writes an `assigned` row to the assignee, and that key is an attention key,
   * so a delegated task that settles leaves the assignee a reminder about a
   * question nobody is asking unless their rows are cleared too.
   */
  it("says so to a teammate the task was delegated to as well", async () => {
    await dispatchTaskNotification(
      { ...SETTLED_TASK, assigneeUserId: "user_2" },
      "event_1",
      "CANCELED",
    );

    expect(markSettledAttentionReadMock).toHaveBeenCalledWith(
      "user_2",
      "TASK",
      "task_1",
      "Notifications.Task.canceled",
    );
  });

  /**
   * A task nobody delegated has one reader under two names. Clearing twice
   * would be harmless and would still read as two people to anyone counting.
   */
  it("says so once when the owner is also the assignee", async () => {
    await dispatchTaskNotification(
      { ...SETTLED_TASK, assigneeUserId: "user_1" },
      "event_1",
      "CANCELED",
    );

    expect(markSettledAttentionReadMock).toHaveBeenCalledTimes(1);
  });

  it("names the assigned soko bot in task notifications", async () => {
    await dispatchTaskNotification(
      {
        id: "task_1",
        ownerId: "user_1",
        assigneeUserId: null,
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
