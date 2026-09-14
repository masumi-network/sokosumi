import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  markAttentionReadMock,
  markSettledAttentionReadMock,
  prismaTaskFindFirstMock,
  prismaTaskFindUniqueMock,
  prismaUserFindUniqueMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  markAttentionReadMock: vi.fn(),
  markSettledAttentionReadMock: vi.fn(),
  prismaTaskFindFirstMock: vi.fn(),
  prismaTaskFindUniqueMock: vi.fn(),
  prismaUserFindUniqueMock: vi.fn(),
}));

vi.mock("./notification-read.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./notification-read.js")>()),
  markAttentionRead: markAttentionReadMock,
  markSettledAttentionRead: markSettledAttentionReadMock,
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

import { TASK_ATTENTION_MESSAGE_KEYS } from "@/helpers/notification-delivery";

import {
  dispatchTaskNotification,
  markTaskArchivedRead,
  markTaskAssignedRead,
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

  it.each([
    "RUNNING",
    "READY",
    "QUEUED",
    "AWAITING_EXTERNAL",
    "CREDITS_TOPPED_UP",
  ])(
    "clears stale run attention for both readers when work moves to %s",
    async (status) => {
      await dispatchTaskNotification(
        { ...SETTLED_TASK, assigneeUserId: "user_2" },
        "event_resume",
        status,
      );

      for (const readerId of ["user_1", "user_2"]) {
        expect(markAttentionReadMock).toHaveBeenCalledWith(
          readerId,
          "TASK",
          "task_1",
          [
            "Notifications.Task.assigned",
            "Notifications.Task.inputRequired",
            "Notifications.Task.approvalRequired",
            "Notifications.Task.authenticationRequired",
            "Notifications.Task.outOfCredits",
          ],
          "task-resumed-read",
        );
      }
      expect(markAttentionReadMock).toHaveBeenCalledTimes(2);
      expect(createNotificationMock).not.toHaveBeenCalled();
    },
  );

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
   * The exact key, because a membership check would pass on any of them.
   */
  it.each([
    ["INPUT_REQUIRED", "Notifications.Task.inputRequired"],
    ["APPROVAL_REQUIRED", "Notifications.Task.approvalRequired"],
    ["AUTHENTICATION_REQUIRED", "Notifications.Task.authenticationRequired"],
    ["OUT_OF_CREDITS", "Notifications.Task.outOfCredits"],
  ])(
    "still hands a %s task's key on, for the helper to refuse",
    async (status, expectedKey) => {
      await dispatchTaskNotification(SETTLED_TASK, "event_1", status);

      expect(markSettledAttentionReadMock).toHaveBeenCalledWith(
        "user_1",
        "TASK",
        "task_1",
        expectedKey,
      );
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

  /**
   * `createNotification` rethrows any write error that is not a unique
   * violation. If the clearing ran after it, the one run that settled the
   * task would skip it and the reminder would go out. So the clearing goes
   * first, and this pins that.
   */
  it("clears the settled rows even when the outcome write fails", async () => {
    createNotificationMock.mockRejectedValue(new Error("write failed"));

    await dispatchTaskNotification(SETTLED_TASK, "event_1", "COMPLETED");

    expect(markSettledAttentionReadMock).toHaveBeenCalledWith(
      "user_1",
      "TASK",
      "task_1",
      "Notifications.Task.completed",
    );
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

describe("markTaskAssignedRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markAttentionReadMock.mockResolvedValue(1);
  });

  /**
   * The row says the task is yours, and it stops being true when the task
   * moves on. Nothing else clears it: the settled read reaches whoever holds
   * the task when it settles, which by then is somebody else.
   */
  it("marks the previous holder's assigned row read", async () => {
    await markTaskAssignedRead("user_2", "task_1");

    expect(markAttentionReadMock).toHaveBeenCalledWith(
      "user_2",
      "TASK",
      "task_1",
      ["Notifications.Task.assigned"],
      "task-assigned-read",
    );
  });
});

describe("markTaskArchivedRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markAttentionReadMock.mockResolvedValue(1);
  });

  const ARCHIVED_TASK = {
    id: "task_1",
    ownerId: "user_1",
    assigneeUserId: "user_2",
  };

  /**
   * Nobody can open an archived task, so every row still asking somebody to
   * act on it is about a question nobody is asking. The operator-removed
   * schedule row is the concrete one: it is written to the owner with no
   * status condition, and a task carrying it archives from a non-terminal
   * status.
   */
  it("marks every attention row read, for both readers", async () => {
    await markTaskArchivedRead(ARCHIVED_TASK);

    for (const readerId of ["user_1", "user_2"]) {
      expect(markAttentionReadMock).toHaveBeenCalledWith(
        readerId,
        "TASK",
        "task_1",
        TASK_ATTENTION_MESSAGE_KEYS,
        "task-archived-read",
      );
    }
  });

  /** One reader under two names on every task nobody delegated. */
  it("writes once when the owner holds the task", async () => {
    await markTaskArchivedRead({ ...ARCHIVED_TASK, assigneeUserId: "user_1" });

    expect(markAttentionReadMock).toHaveBeenCalledTimes(1);
  });
});
