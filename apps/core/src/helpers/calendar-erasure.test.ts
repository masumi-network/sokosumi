import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CalendarErasureBlockedError,
  eraseWorkspaceCalendarData,
  lockCalendarErasureUser,
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
  const projectEventDeleteMany = vi.fn();
  const projectCloseOperationDeleteMany = vi.fn();
  const projectDeleteMany = vi.fn();
  const notificationDeleteMany = vi.fn();
  const projectDeletionTombstoneDeleteMany = vi.fn();
  const calendarInvalidationOutboxDeleteMany = vi.fn();

  return {
    tx: {
      $queryRaw: queryRaw,
      taskX402Payment: {
        findFirst: taskX402PaymentFindFirst,
        deleteMany: taskX402PaymentDeleteMany,
      },
      taskScheduleOccurrence: {
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
      projectEvent: { deleteMany: projectEventDeleteMany },
      projectCloseOperation: {
        deleteMany: projectCloseOperationDeleteMany,
      },
      project: { deleteMany: projectDeleteMany },
      notification: { deleteMany: notificationDeleteMany },
      projectDeletionTombstone: {
        deleteMany: projectDeletionTombstoneDeleteMany,
      },
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
      projectEventDeleteMany,
      projectCloseOperationDeleteMany,
      projectDeleteMany,
      notificationDeleteMany,
      projectDeletionTombstoneDeleteMany,
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

    await eraseWorkspaceCalendarData(tx as never, WORKSPACE_ID);

    expect(queryRaw).toHaveBeenCalledTimes(6);
    expect(queryRaw.mock.calls.map(queryText)).toEqual([
      expect.stringMatching(/FROM "workspace"[\s\S]*FOR UPDATE/),
      expect.stringMatching(/FROM "project"[\s\S]*FOR UPDATE/),
      expect.stringMatching(/FROM "task"[\s\S]*FOR UPDATE/),
      expect.stringMatching(
        /FROM "task_schedule_occurrence" AS occurrence[\s\S]*FOR UPDATE OF occurrence/,
      ),
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
    expect(queryRaw.mock.invocationCallOrder[5]).toBeLessThan(
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
      eraseWorkspaceCalendarData(tx as never, WORKSPACE_ID),
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
      eraseWorkspaceCalendarData(tx as never, WORKSPACE_ID),
    ).rejects.toEqual(
      new CalendarErasureBlockedError("task_payment_authorization_live"),
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
      eraseWorkspaceCalendarData(tx as never, WORKSPACE_ID),
    ).resolves.toBe(true);

    expect(
      deletionMocks.map((mock) => mock.mock.invocationCallOrder[0]),
    ).toEqual(
      [...deletionMocks]
        .map((mock) => mock.mock.invocationCallOrder[0])
        .sort((left, right) => left - right),
    );
    expect(tx.taskScheduleOccurrence.deleteMany).toHaveBeenCalledWith({
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
    expect(tx.project.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
    });
    expect(tx.projectDeletionTombstone.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
    });
    expect(tx.calendarInvalidationOutbox.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID },
    });
  });
});
