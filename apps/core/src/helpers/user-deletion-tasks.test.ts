import {
  TaskPaymentClaimStatus,
  TaskX402PaymentStatus,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepareTasksForUserDeletion } from "./user-deletion-tasks";

const {
  coworkerAssignmentFindManyMock,
  taskFindManyMock,
  taskFileFindManyMock,
  taskUpdateMock,
  taskDeleteManyMock,
  taskPaymentClaimDeleteManyMock,
  taskX402PaymentFindFirstMock,
  taskX402PaymentDeleteManyMock,
  chatRoomFindManyMock,
  chatRoomUpdateMock,
  chatRoomDeleteMock,
  transactionMock,
  deleteTaskFileIfOwnedMock,
  captureMessageMock,
} = vi.hoisted(() => ({
  coworkerAssignmentFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskFileFindManyMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  taskDeleteManyMock: vi.fn(),
  taskPaymentClaimDeleteManyMock: vi.fn(),
  taskX402PaymentFindFirstMock: vi.fn(),
  taskX402PaymentDeleteManyMock: vi.fn(),
  chatRoomFindManyMock: vi.fn(),
  chatRoomUpdateMock: vi.fn(),
  chatRoomDeleteMock: vi.fn(),
  transactionMock: vi.fn(),
  deleteTaskFileIfOwnedMock: vi.fn(),
  captureMessageMock: vi.fn(),
}));

vi.mock("@/lib/blob", () => ({
  deleteTaskFileIfOwned: deleteTaskFileIfOwnedMock,
}));

vi.mock("@sentry/node", () => ({
  captureMessage: captureMessageMock,
}));

describe("prepareTasksForUserDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFileFindManyMock.mockResolvedValue([]);
    taskPaymentClaimDeleteManyMock.mockResolvedValue({ count: 0 });
    taskX402PaymentFindFirstMock.mockResolvedValue(null);
    taskX402PaymentDeleteManyMock.mockResolvedValue({ count: 0 });
    chatRoomFindManyMock.mockResolvedValue([]);
    chatRoomUpdateMock.mockResolvedValue({});
    chatRoomDeleteMock.mockResolvedValue({});
    deleteTaskFileIfOwnedMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (callback) =>
      callback({
        coworkerAssignment: {
          findMany: coworkerAssignmentFindManyMock,
        },
        task: {
          findMany: taskFindManyMock,
          update: taskUpdateMock,
          deleteMany: taskDeleteManyMock,
        },
        taskFile: {
          findMany: taskFileFindManyMock,
        },
        taskPaymentClaim: {
          deleteMany: taskPaymentClaimDeleteManyMock,
        },
        taskX402Payment: {
          findFirst: taskX402PaymentFindFirstMock,
          deleteMany: taskX402PaymentDeleteManyMock,
        },
        chatRoom: {
          findMany: chatRoomFindManyMock,
          update: chatRoomUpdateMock,
          delete: chatRoomDeleteMock,
        },
      }),
    );
  });

  it("reassigns foreign-owned user creators then deletes owned tasks", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([
      { id: "tsk_owned", ownerId: "user_delete" },
      { id: "tsk_other", ownerId: "user_other" },
    ]);
    taskUpdateMock.mockResolvedValue({});
    taskDeleteManyMock.mockResolvedValue({ count: 1 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(coworkerAssignmentFindManyMock).toHaveBeenCalledWith({
      where: { userId: "user_delete" },
      select: { coworkerId: true },
    });
    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [{ creatorUserId: "user_delete" }],
      },
      select: { id: true, ownerId: true },
    });
    expect(taskUpdateMock).toHaveBeenCalledTimes(1);
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: "tsk_other" },
      data: {
        creatorUserId: "user_other",
        creatorCoworkerId: null,
        creatorOrchestratorId: null,
      },
    });
    expect(taskDeleteManyMock).toHaveBeenCalledWith({
      where: { ownerId: "user_delete" },
    });
  });

  it("removes terminal claims before transaction cascade", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(taskPaymentClaimDeleteManyMock).toHaveBeenCalledWith({
      where: {
        status: {
          in: [
            TaskPaymentClaimStatus.PURCHASED,
            TaskPaymentClaimStatus.REFUNDED,
          ],
        },
        OR: [
          { transaction: { userId: "user_delete" } },
          { refundTransaction: { userId: "user_delete" } },
        ],
      },
    });
    expect(taskDeleteManyMock).toHaveBeenCalled();
  });

  it("blocks deletion while a task x402 payment is pending", async () => {
    taskX402PaymentFindFirstMock.mockResolvedValue({ id: "x402_pending" });

    const promise = prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    await expect(promise).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({ code: "TASK_X402_PAYMENT_PENDING" }),
    });
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledWith({
      where: {
        status: TaskX402PaymentStatus.PENDING,
        // All three RESTRICT branches, including refundTransaction — a
        // PENDING row carrying one should be impossible, but the FK would
        // 500 the user cascade if it existed, so the guard checks it.
        OR: [
          { transaction: { userId: "user_delete" } },
          { refundTransaction: { userId: "user_delete" } },
          { task: { ownerId: "user_delete" } },
        ],
      },
      select: { id: true },
    });
    expect(taskX402PaymentDeleteManyMock).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
    // A pending x402 payment clears itself (coworker retry or reconciler
    // auto-refund), so unlike a review-required claim it must not page.
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("removes terminal x402 payments before the task and transaction cascades", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    // Every RESTRICT branch (charge, refund, task owner) must be swept, or
    // the owned-task delete / user cascade fails on the FK.
    expect(taskX402PaymentDeleteManyMock).toHaveBeenCalledWith({
      where: {
        status: {
          in: [
            TaskX402PaymentStatus.VERIFIED,
            TaskX402PaymentStatus.FAILED,
            TaskX402PaymentStatus.REFUNDED,
          ],
        },
        OR: [
          { transaction: { userId: "user_delete" } },
          { refundTransaction: { userId: "user_delete" } },
          { task: { ownerId: "user_delete" } },
        ],
      },
    });
    // ORDER is the invariant, not just both-called: taskId is RESTRICT, so
    // sweeping x402 payments after the task delete fails the owned-task
    // delete on task_x402_payment_taskId_fkey and account deletion 500s.
    const x402SweepCallOrder =
      taskX402PaymentDeleteManyMock.mock.invocationCallOrder[0];
    const taskDeleteCallOrder = taskDeleteManyMock.mock.invocationCallOrder[0];
    expect(x402SweepCallOrder).toBeLessThan(taskDeleteCallOrder);
  });

  it("clears coworker-creator RESTRICT refs for foreign-owned tasks", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([{ coworkerId: "cow_1" }]);
    taskFindManyMock.mockResolvedValue([
      { id: "tsk_foreign", ownerId: "user_other" },
    ]);
    taskUpdateMock.mockResolvedValue({});
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { creatorUserId: "user_delete" },
          { creatorCoworkerId: { in: ["cow_1"] } },
        ],
      },
      select: { id: true, ownerId: true },
    });
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: "tsk_foreign" },
      data: {
        creatorUserId: "user_other",
        creatorCoworkerId: null,
        creatorOrchestratorId: null,
      },
    });
  });

  it("best-effort deletes blob files for owned tasks after cascade", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskFileFindManyMock.mockResolvedValue([
      {
        fileUrl:
          "https://abc.public.blob.vercel-storage.com/tasks/tsk_owned/a.pdf",
        taskId: "tsk_owned",
      },
    ]);
    taskDeleteManyMock.mockResolvedValue({ count: 1 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(taskFileFindManyMock).toHaveBeenCalledWith({
      where: { task: { ownerId: "user_delete" } },
      select: { fileUrl: true, taskId: true },
    });
    expect(deleteTaskFileIfOwnedMock).toHaveBeenCalledWith(
      "https://abc.public.blob.vercel-storage.com/tasks/tsk_owned/a.pdf",
      "tsk_owned",
    );
  });

  it("repoints chat room createdByUserId to a remaining member", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });
    chatRoomFindManyMock.mockResolvedValue([
      {
        id: "room_keep",
        userMembers: [{ userId: "user_other" }],
      },
    ]);

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(chatRoomFindManyMock).toHaveBeenCalledWith({
      where: { createdByUserId: "user_delete" },
      select: {
        id: true,
        userMembers: {
          where: { userId: { not: "user_delete" } },
          select: { userId: true },
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
    });
    expect(chatRoomUpdateMock).toHaveBeenCalledWith({
      where: { id: "room_keep" },
      data: { createdByUserId: "user_other" },
    });
    expect(chatRoomDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes creator-only chat rooms so Restrict does not block allow", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });
    chatRoomFindManyMock.mockResolvedValue([
      {
        id: "room_solo",
        userMembers: [],
      },
    ]);

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(chatRoomDeleteMock).toHaveBeenCalledWith({
      where: { id: "room_solo" },
    });
    expect(chatRoomUpdateMock).not.toHaveBeenCalled();
  });
});
