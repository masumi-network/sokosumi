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
        status: { not: TaskX402PaymentStatus.PENDING },
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

  it("sweeps every non-pending x402 status instead of enumerating them", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    // Asserting the predicate shape, not a fixture row: the enum has no
    // fifth member today, so a future status (e.g. EXPIRED_UNUSED) cannot be
    // exercised here. An enumerated `in: [...]` would match neither this
    // sweep nor the PENDING guard above it, leaving the row behind — and
    // taskId is RESTRICT, so the task.deleteMany below would then fail with
    // a raw FK error and 500 the account deletion. Negating PENDING keeps
    // the sweep exhaustive by construction as the enum grows.
    const [sweepArgs] = taskX402PaymentDeleteManyMock.mock.calls[0] as [
      { where: { status: unknown } },
    ];
    expect(sweepArgs.where.status).toEqual({
      not: TaskX402PaymentStatus.PENDING,
    });
    expect(sweepArgs.where.status).not.toHaveProperty("in");
  });

  /**
   * The x402 `findFirst` is called twice with different predicates: the
   * PENDING blocker guard, then the foreign-charge detector that runs over the
   * rows the sweep is about to delete. Discriminate on `status` the way the
   * real query would.
   */
  function mockX402Lookups(options: {
    pending?: { id: string } | null;
    foreignCharge?: {
      id: string;
      taskId: string;
      transaction: { userId: string };
    } | null;
  }) {
    taskX402PaymentFindFirstMock.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === TaskX402PaymentStatus.PENDING) {
          return options.pending ?? null;
        }
        return options.foreignCharge ?? null;
      },
    );
  }

  it("pages when the sweep would remove a payment charged to another user", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });
    mockX402Lookups({
      foreignCharge: {
        id: "x402_foreign",
        taskId: "tsk_owned",
        transaction: { userId: "user_charged" },
      },
    });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    // The detector must look at exactly the rows the sweep deletes whose
    // charge is someone else's: reachable only through the refund or
    // task-owner branch, never the charge branch.
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledWith({
      where: {
        status: { not: TaskX402PaymentStatus.PENDING },
        transaction: { userId: { not: "user_delete" } },
        OR: [
          { refundTransaction: { userId: "user_delete" } },
          { task: { ownerId: "user_delete" } },
        ],
      },
      select: {
        id: true,
        taskId: true,
        transaction: { select: { userId: true } },
      },
    });
    // Task.ownerId is documented as always the billing owner, so this should
    // be unreachable. If it ever fires, a live third party's payment record is
    // being destroyed by someone else's account deletion — silent today.
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Account deletion is removing a task x402 payment charged to another user",
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          error_type: "user_deletion_x402_payment_foreign_charge",
        }),
        extra: expect.objectContaining({
          userId: "user_delete",
          taskX402PaymentId: "x402_foreign",
          taskId: "tsk_owned",
          chargedUserId: "user_charged",
        }),
      }),
    );
  });

  it("still sweeps the foreign-charge row it paged about", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });
    mockX402Lookups({
      foreignCharge: {
        id: "x402_foreign",
        taskId: "tsk_owned",
        transaction: { userId: "user_charged" },
      },
    });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    // Narrowing the OR to hide the row is not the fix: the task-owner branch
    // is load-bearing for the RESTRICT on taskId, so dropping it would fail
    // the owned-task delete with a raw FK 500. Make it visible, not silent.
    expect(taskX402PaymentDeleteManyMock).toHaveBeenCalledWith({
      where: {
        status: { not: TaskX402PaymentStatus.PENDING },
        OR: [
          { transaction: { userId: "user_delete" } },
          { refundTransaction: { userId: "user_delete" } },
          { task: { ownerId: "user_delete" } },
        ],
      },
    });
    expect(taskDeleteManyMock).toHaveBeenCalled();

    // Two lookups: the PENDING blocker guard, then the foreign-charge
    // detector. The detector reads rows the sweep deletes, so it is only
    // meaningful before it.
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledTimes(2);
    const detectCallOrder =
      taskX402PaymentFindFirstMock.mock.invocationCallOrder[1];
    const sweepCallOrder =
      taskX402PaymentDeleteManyMock.mock.invocationCallOrder[0];
    expect(detectCallOrder).toBeLessThan(sweepCallOrder);
  });

  it("does not page when every swept payment is charged to the deleted user", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });
    mockX402Lookups({ foreignCharge: null });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    // The detector still has to run — silence must come from finding nothing,
    // not from skipping the check.
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledTimes(2);
    expect(taskX402PaymentDeleteManyMock).toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
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
