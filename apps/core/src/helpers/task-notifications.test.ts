import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  markAttentionReadMock,
  markSettledAttentionReadMock,
  prismaTaskFindFirstMock,
  prismaTaskFindUniqueMock,
  prismaTaskParticipantFindManyMock,
  prismaTaskEventFindUniqueMock,
  prismaUserFindUniqueMock,
} = vi.hoisted(() => ({
  prismaTaskEventFindUniqueMock: vi.fn(),
  createNotificationMock: vi.fn(),
  markAttentionReadMock: vi.fn(),
  markSettledAttentionReadMock: vi.fn(),
  prismaTaskFindFirstMock: vi.fn(),
  prismaTaskFindUniqueMock: vi.fn(),
  prismaTaskParticipantFindManyMock: vi.fn().mockResolvedValue([]),
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
    taskEvent: { findUnique: prismaTaskEventFindUniqueMock },
    taskParticipant: { findMany: prismaTaskParticipantFindManyMock },
    user: { findUnique: prismaUserFindUniqueMock },
  },
}));

import { TASK_ATTENTION_MESSAGE_KEYS } from "@/helpers/notification-delivery";

import {
  dispatchTaskNotification,
  markTaskArchivedRead,
  markTaskAssignedRead,
  markTaskParticipantRemovedRead,
  notifyTaskHumanAssignee,
  notifyTaskParticipantsAdded,
} from "./task-notifications";

describe("notifyTaskParticipantsAdded", () => {
  const eventCreatedAt = new Date("2026-09-24T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    prismaTaskEventFindUniqueMock.mockResolvedValue({
      createdAt: eventCreatedAt,
    });
    createNotificationMock.mockResolvedValue({});
  });

  function taskWithParticipants(userIds: string[]) {
    return {
      id: "task_1",
      name: "Launch",
      projectId: null,
      workspaceId: "workspace_1",
      project: null,
      participants: userIds.map((userId) => ({ userId })),
    };
  }

  it("skips a Task archived or settled after the mentioning event", async () => {
    prismaTaskFindFirstMock.mockResolvedValue(null);

    await notifyTaskParticipantsAdded("task_1", "event_1", ["user_a"]);

    expect(prismaTaskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "task_1",
          archivedAt: null,
          events: {
            none: {
              status: { in: ["COMPLETED", "FAILED", "CANCELED"] },
              createdAt: { gt: eventCreatedAt },
            },
          },
        },
      }),
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("only alerts users who are still participants", async () => {
    prismaTaskFindFirstMock.mockResolvedValue(taskWithParticipants(["user_b"]));

    await notifyTaskParticipantsAdded("task_1", "event_1", [
      "user_a",
      "user_b",
    ]);

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_b",
        messageKey: "Notifications.Task.participantAdded",
      }),
    );
  });

  it("keeps alerting the rest when one user's notification fails", async () => {
    prismaTaskFindFirstMock.mockResolvedValue(
      taskWithParticipants(["user_a", "user_b"]),
    );
    createNotificationMock
      .mockRejectedValueOnce(new Error("delivery failed"))
      .mockResolvedValueOnce({});

    await notifyTaskParticipantsAdded("task_1", "event_1", [
      "user_a",
      "user_b",
    ]);

    expect(createNotificationMock.mock.calls.map(([n]) => n.userId)).toEqual([
      "user_a",
      "user_b",
    ]);
  });

  it("alerts on a synthetic eventId when no TaskEvent row exists", async () => {
    prismaTaskEventFindUniqueMock.mockResolvedValue(null);
    prismaTaskFindFirstMock.mockResolvedValue(taskWithParticipants(["user_a"]));

    await notifyTaskParticipantsAdded("task_1", "synthetic-uuid", ["user_a"]);

    expect(prismaTaskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "task_1",
          archivedAt: null,
          events: {
            none: {
              status: { in: ["COMPLETED", "FAILED", "CANCELED"] },
            },
          },
        },
      }),
    );
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_a",
        eventId: "synthetic-uuid",
        messageKey: "Notifications.Task.participantAdded",
      }),
    );
  });
});

describe("dispatchTaskNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNotificationMock.mockResolvedValue({});
    markSettledAttentionReadMock.mockResolvedValue(0);
    prismaTaskParticipantFindManyMock.mockResolvedValue([]);
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
      expect(prismaTaskParticipantFindManyMock).not.toHaveBeenCalled();
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
  /**
   * A mention writes `participantAdded` to someone who is neither owner nor
   * assignee. Settling clears the readers' run rows and leaves that one, so
   * the day-later follow-up would still go out after the task is over.
   */
  it("marks a mentioned person's added row read when the task settles", async () => {
    prismaTaskParticipantFindManyMock.mockResolvedValue([{ userId: "user_3" }]);

    await dispatchTaskNotification(SETTLED_TASK, "event_1", "COMPLETED");

    expect(markAttentionReadMock).toHaveBeenCalledWith(
      "user_3",
      "TASK",
      "task_1",
      ["Notifications.Task.participantAdded"],
      "task-participant-settled-read",
    );
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1" }),
    );
  });

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

  /**
   * The account-wide field is the email gate, and this row sends no email.
   * Reading it here silenced a notification whose `TASK_ATTENTION` row the
   * reader had switched on, and no setting could bring it back.
   */
  it("notifies even when the account-wide email opt-in is off", async () => {
    prismaUserFindUniqueMock.mockResolvedValue({ notificationsOptIn: false });

    await notifyTaskHumanAssignee("tsk_123", "user_assignee");

    expect(prismaUserFindUniqueMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_assignee",
        messageKey: "Notifications.Task.assigned",
      }),
    );
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

describe("markTaskParticipantRemovedRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markAttentionReadMock.mockResolvedValue(1);
  });

  it("marks the removed person's added row read", async () => {
    await markTaskParticipantRemovedRead("user_3", "task_1");

    expect(markAttentionReadMock).toHaveBeenCalledWith(
      "user_3",
      "TASK",
      "task_1",
      ["Notifications.Task.participantAdded"],
      "task-participant-removed-read",
    );
  });
});

describe("markTaskArchivedRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markAttentionReadMock.mockResolvedValue(1);
    prismaTaskParticipantFindManyMock.mockResolvedValue([]);
  });

  const ARCHIVED_TASK = {
    id: "task_1",
    ownerId: "user_1",
    assigneeUserId: "user_2",
  };

  /**
   * Nobody can open an archived task, so every row still asking somebody to
   * act on it is about a question nobody is asking. The `assigned` row is the
   * concrete one: it is written on assignment whatever the status, and a task
   * carrying it archives from a non-terminal status.
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

  it("marks a mentioned person's added row read", async () => {
    prismaTaskParticipantFindManyMock.mockResolvedValue([{ userId: "user_3" }]);

    await markTaskArchivedRead(ARCHIVED_TASK);

    expect(markAttentionReadMock).toHaveBeenCalledWith(
      "user_3",
      "TASK",
      "task_1",
      ["Notifications.Task.participantAdded"],
      "task-participant-settled-read",
    );
  });

  /** One reader under two names on every task nobody delegated. */
  it("writes once when the owner holds the task", async () => {
    await markTaskArchivedRead({ ...ARCHIVED_TASK, assigneeUserId: "user_1" });

    expect(markAttentionReadMock).toHaveBeenCalledTimes(1);
  });
});
