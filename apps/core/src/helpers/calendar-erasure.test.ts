import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CalendarErasureBlockedError,
  eraseWorkspaceCalendarData,
  lockCalendarErasureUser,
  lockWorkspaceCalendarForErasure,
} from "./calendar-erasure";

const WORKSPACE_ID = "01992833-2810-7000-8000-000000000001";

function createTransaction() {
  const queryRaw = vi.fn();
  const taskX402PaymentFindFirst = vi.fn();
  const taskScheduleOccurrenceDeleteMany = vi.fn();
  const taskLinkDeleteMany = vi.fn();
  const taskX402PaymentDeleteMany = vi.fn();
  const taskScheduleQuarantineDeleteMany = vi.fn();
  const taskScheduleCreateOperationDeleteMany = vi.fn();
  const taskEventDeleteMany = vi.fn();
  const taskDeleteMany = vi.fn();
  const taskScheduleDeleteMany = vi.fn();
  const projectEventDeleteMany = vi.fn();
  const projectCloseOperationDeleteMany = vi.fn();
  const projectDeleteMany = vi.fn();
  const notificationDeleteMany = vi.fn();
  const notificationUpdateMany = vi.fn();
  const notificationFindMany = vi.fn().mockResolvedValue([]);
  const taskFileFindMany = vi.fn().mockResolvedValue([]);
  const calendarInvalidationOutboxDeleteMany = vi.fn();

  return {
    tx: {
      $queryRaw: queryRaw,
      taskX402Payment: {
        findFirst: taskX402PaymentFindFirst,
        deleteMany: taskX402PaymentDeleteMany,
      },
      taskScheduleRun: {
        deleteMany: taskScheduleOccurrenceDeleteMany,
      },
      taskLink: { deleteMany: taskLinkDeleteMany },
      taskScheduleQuarantine: {
        deleteMany: taskScheduleQuarantineDeleteMany,
      },
      taskScheduleCreateOperation: {
        deleteMany: taskScheduleCreateOperationDeleteMany,
      },
      taskEvent: { deleteMany: taskEventDeleteMany },
      task: { deleteMany: taskDeleteMany },
      taskSchedule: { deleteMany: taskScheduleDeleteMany },
      projectEvent: { deleteMany: projectEventDeleteMany },
      projectCloseOperation: {
        deleteMany: projectCloseOperationDeleteMany,
      },
      project: { deleteMany: projectDeleteMany },
      notification: {
        deleteMany: notificationDeleteMany,
        updateMany: notificationUpdateMany,
        findMany: notificationFindMany,
      },
      taskFile: { findMany: taskFileFindMany },
      calendarInvalidationOutbox: {
        deleteMany: calendarInvalidationOutboxDeleteMany,
      },
    },
    queryRaw,
    taskX402PaymentFindFirst,
    deletionMocks: [
      taskScheduleOccurrenceDeleteMany,
      taskLinkDeleteMany,
      taskX402PaymentDeleteMany,
      taskScheduleQuarantineDeleteMany,
      taskScheduleCreateOperationDeleteMany,
      taskEventDeleteMany,
      taskDeleteMany,
      taskScheduleDeleteMany,
      projectEventDeleteMany,
      projectCloseOperationDeleteMany,
      projectDeleteMany,
      notificationDeleteMany,
      calendarInvalidationOutboxDeleteMany,
    ],
  };
}

function queryText(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?");
}

describe("calendar erasure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the acting user for deletion", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: "user-1" }]);

    await expect(
      lockCalendarErasureUser({ $queryRaw: queryRaw } as never, "user-1"),
    ).resolves.toBe(true);

    expect(queryText(queryRaw.mock.calls[0])).toMatch(
      /FROM "user"[\s\S]*WHERE id = \?[\s\S]*FOR UPDATE/,
    );
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual(["user-1"]);
  });

  it("locks workspace calendar data in canonical parent-to-child order", async () => {
    const { tx, queryRaw, taskX402PaymentFindFirst } = createTransaction();
    queryRaw
      .mockResolvedValueOnce([{ id: WORKSPACE_ID }])
      .mockResolvedValue([]);
    taskX402PaymentFindFirst.mockResolvedValue(null);

    await lockWorkspaceCalendarForErasure(tx as never, WORKSPACE_ID);

    expect(queryRaw).toHaveBeenCalledTimes(7);
    expect(queryRaw.mock.calls.map(queryText)).toEqual([
      expect.stringMatching(/FROM "workspace"[\s\S]*FOR UPDATE/),
      expect.stringMatching(/FROM "project"[\s\S]*FOR UPDATE/),
      expect.stringMatching(/FROM "task"[\s\S]*FOR UPDATE/),
      expect.stringMatching(
        /FROM "task_schedule_run" AS occurrence[\s\S]*FOR UPDATE OF occurrence/,
      ),
      expect.stringMatching(/FROM "task_schedule"\s[\s\S]*FOR UPDATE/),
      expect.stringMatching(
        /FROM "task_link" AS link[\s\S]*FOR UPDATE OF link/,
      ),
      expect.stringMatching(
        /FROM "task_x402_payment" AS payment[\s\S]*FOR UPDATE OF payment/,
      ),
    ]);
    expect(
      queryRaw.mock.calls.every((call) => call.slice(1).includes(WORKSPACE_ID)),
    ).toBe(true);
    expect(queryRaw.mock.invocationCallOrder[6]).toBeLessThan(
      taskX402PaymentFindFirst.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("blocks erasure before cleanup when a payment is unresolved", async () => {
    const { tx, queryRaw, taskX402PaymentFindFirst, deletionMocks } =
      createTransaction();
    queryRaw
      .mockResolvedValueOnce([{ id: WORKSPACE_ID }])
      .mockResolvedValue([]);
    taskX402PaymentFindFirst.mockResolvedValueOnce({ id: "payment-1" });

    await expect(
      lockWorkspaceCalendarForErasure(tx as never, WORKSPACE_ID),
    ).rejects.toMatchObject({
      name: "CalendarErasureBlockedError",
      blocker: "task_payment_unresolved",
    });
    expect(taskX402PaymentFindFirst).toHaveBeenCalledTimes(1);
    for (const deleteMany of deletionMocks) {
      expect(deleteMany).not.toHaveBeenCalled();
    }
  });

  it("blocks erasure when a payment authorization remains live", async () => {
    const { tx, queryRaw, taskX402PaymentFindFirst, deletionMocks } =
      createTransaction();
    queryRaw
      .mockResolvedValueOnce([{ id: WORKSPACE_ID }])
      .mockResolvedValue([]);
    taskX402PaymentFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "payment-1" });

    await expect(
      lockWorkspaceCalendarForErasure(tx as never, WORKSPACE_ID),
    ).rejects.toEqual(
      new CalendarErasureBlockedError(
        "task_payment_authorization_live",
        "payment-1",
      ),
    );
    for (const deleteMany of deletionMocks) {
      expect(deleteMany).not.toHaveBeenCalled();
    }
  });

  it("deletes children before parents and clears retained workspace history", async () => {
    const { tx, queryRaw, taskX402PaymentFindFirst, deletionMocks } =
      createTransaction();
    queryRaw
      .mockResolvedValueOnce([{ id: WORKSPACE_ID }])
      .mockResolvedValue([]);
    taskX402PaymentFindFirst.mockResolvedValue(null);

    await expect(
      lockWorkspaceCalendarForErasure(tx as never, WORKSPACE_ID),
    ).resolves.toBe(true);
    for (const deleteMany of deletionMocks) {
      expect(deleteMany).not.toHaveBeenCalled();
    }
    await eraseWorkspaceCalendarData(tx as never, WORKSPACE_ID);

    expect(
      deletionMocks.map((mock) => mock.mock.invocationCallOrder[0]),
    ).toEqual(
      [...deletionMocks]
        .map((mock) => mock.mock.invocationCallOrder[0])
        .sort((left, right) => left - right),
    );
    expect(tx.taskScheduleRun.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { sourceWorkspaceId: WORKSPACE_ID },
          { seriesTask: { workspaceId: WORKSPACE_ID } },
          { releasedTask: { workspaceId: WORKSPACE_ID } },
        ],
      },
    });
    expect(tx.task.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
    });
    // Task Schedule Runs carry the schedule's workspace as their source, so
    // the ledger delete above takes them; the schedules follow the Tasks.
    expect(tx.taskSchedule.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
    });
    expect(tx.project.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
    });
    expect(tx.calendarInvalidationOutbox.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
    });
  });
  it("captures queued emails under lock and task files before erasure", async () => {
    const { tx } = createTransaction();
    const scheduledEmails = [
      { id: "notice", emailId: "queued", emailScheduledAt: new Date() },
    ];
    const taskFiles = [
      { fileUrl: "https://blob/tasks/task-1/file", taskId: "task-1" },
    ];
    tx.notification.findMany.mockResolvedValue(scheduledEmails);
    tx.taskFile.findMany.mockResolvedValue(taskFiles);
    await expect(
      eraseWorkspaceCalendarData(tx as never, WORKSPACE_ID),
    ).resolves.toEqual({ scheduledEmails, taskFiles });
    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
      data: { isRead: true },
    });
    expect(tx.notification.findMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, emailScheduledAt: { not: null } },
      select: { id: true, emailId: true, emailScheduledAt: true },
    });
    expect(tx.taskFile.findMany).toHaveBeenCalledWith({
      where: { task: { workspaceId: WORKSPACE_ID } },
      select: { fileUrl: true, taskId: true },
    });
    expect(tx.notification.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.notification.findMany.mock.invocationCallOrder[0],
    );
    expect(tx.notification.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.notification.deleteMany.mock.invocationCallOrder[0],
    );
    expect(tx.taskFile.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.task.deleteMany.mock.invocationCallOrder[0],
    );
  });
});
