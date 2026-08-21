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
  taskPaymentClaimFindFirstMock,
  taskPaymentClaimDeleteManyMock,
  taskX402PaymentFindFirstMock,
  taskX402PaymentDeleteManyMock,
  chatRoomFindManyMock,
  chatRoomUpdateMock,
  chatRoomDeleteMock,
  userDeleteManyMock,
  queryRawMock,
  transactionMock,
  deleteTaskFileIfOwnedMock,
  captureMessageMock,
} = vi.hoisted(() => ({
  captureMessageMock: vi.fn(),
  coworkerAssignmentFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskFileFindManyMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  taskDeleteManyMock: vi.fn(),
  taskPaymentClaimFindFirstMock: vi.fn(),
  taskPaymentClaimDeleteManyMock: vi.fn(),
  taskX402PaymentFindFirstMock: vi.fn(),
  taskX402PaymentDeleteManyMock: vi.fn(),
  chatRoomFindManyMock: vi.fn(),
  chatRoomUpdateMock: vi.fn(),
  chatRoomDeleteMock: vi.fn(),
  userDeleteManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  transactionMock: vi.fn(),
  deleteTaskFileIfOwnedMock: vi.fn(),
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
    taskPaymentClaimFindFirstMock.mockResolvedValue(null);
    taskPaymentClaimDeleteManyMock.mockResolvedValue({ count: 0 });
    taskX402PaymentFindFirstMock.mockResolvedValue(null);
    taskX402PaymentDeleteManyMock.mockResolvedValue({ count: 0 });
    chatRoomFindManyMock.mockResolvedValue([]);
    chatRoomUpdateMock.mockResolvedValue({});
    chatRoomDeleteMock.mockResolvedValue({});
    userDeleteManyMock.mockResolvedValue({ count: 1 });
    queryRawMock.mockResolvedValue([]);
    deleteTaskFileIfOwnedMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (callback) =>
      callback({
        $queryRaw: queryRawMock,
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
          findFirst: taskPaymentClaimFindFirstMock,
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
        user: {
          deleteMany: userDeleteManyMock,
        },
      }),
    );
  });

  it("locks owned tasks and reachable x402 payments before checking payment state", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(queryRawMock).toHaveBeenCalledTimes(3);
    const [userLockStrings, ...userLockValues] = queryRawMock.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const [taskLockStrings, ...taskLockValues] = queryRawMock.mock.calls[1] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const [paymentLockStrings, ...paymentLockValues] = queryRawMock.mock
      .calls[2] as [TemplateStringsArray, ...unknown[]];
    expect(userLockStrings.join("?")).toMatch(
      /FROM "user"[\s\S]*WHERE "id" = \?[\s\S]*FOR UPDATE/,
    );
    expect(userLockValues).toEqual(["user_delete"]);
    expect(taskLockStrings.join("?")).toMatch(
      /FROM "task"[\s\S]*WHERE "ownerId" = \?[\s\S]*FOR UPDATE/,
    );
    expect(taskLockValues).toEqual(["user_delete"]);
    expect(paymentLockStrings.join("?")).toMatch(
      /FROM "task_x402_payment" AS payment[\s\S]*FOR UPDATE OF payment/,
    );
    expect(paymentLockValues).toEqual([
      "user_delete",
      "user_delete",
      "user_delete",
    ]);
    expect(queryRawMock.mock.invocationCallOrder[2]).toBeLessThan(
      taskPaymentClaimFindFirstMock.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(queryRawMock.mock.invocationCallOrder[2]).toBeLessThan(
      taskX402PaymentDeleteManyMock.mock.invocationCallOrder[0] ?? Infinity,
    );
    // Explicit timeout: the default 5 s budget predates the x402 locks and
    // sweeps in this callback, and lock waits behind an in-flight charge
    // count against it. Without headroom a heavy account times out with
    // P2028, which the conflict mapping deliberately does not match.
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 30_000,
    });
    expect(userDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "user_delete" },
    });
    expect(taskDeleteManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      userDeleteManyMock.mock.invocationCallOrder[0],
    );
  });

  it("treats a concurrent delete that already removed the user as a no-op", async () => {
    coworkerAssignmentFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });
    userDeleteManyMock.mockResolvedValue({ count: 0 });

    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).resolves.toBeUndefined();

    expect(userDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "user_delete" },
    });
  });

  it("returns a retryable deletion error on a transaction write conflict", async () => {
    transactionMock.mockRejectedValue(
      Object.assign(new Error("Transaction failed"), { code: "P2034" }),
    );

    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({
        // Deliberately not an x402-specific code: the conflict can come from
        // the claim sweep, the creator-repoint loop, or the user-row lock
        // contending with an unrelated FK insert — not only from a payment.
        code: "ACCOUNT_DELETION_CONCURRENT_CHANGE",
        message: expect.stringContaining("Retry account deletion"),
      }),
    });
    expect(deleteTaskFileIfOwnedMock).not.toHaveBeenCalled();
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

  function mockPendingClaimLookups(options: {
    reviewRequired?: { id: string; reviewRequiredAt: Date } | null;
    pending?: { id: string } | null;
  }) {
    taskPaymentClaimFindFirstMock.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (
          where.reviewRequiredAt &&
          typeof where.reviewRequiredAt === "object" &&
          where.reviewRequiredAt !== null &&
          "not" in where.reviewRequiredAt
        ) {
          return options.reviewRequired ?? null;
        }
        return options.pending ?? null;
      },
    );
  }

  it("blocks deletion while a task payment claim is pending", async () => {
    mockPendingClaimLookups({
      reviewRequired: null,
      pending: { id: "claim_pending" },
    });

    const promise = prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    await expect(promise).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({ code: "TASK_PAYMENT_CLAIM_PENDING" }),
    });
    expect(taskPaymentClaimDeleteManyMock).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
  });

  it("directs reviewed claims to administrator recovery before deletion", async () => {
    mockPendingClaimLookups({
      reviewRequired: {
        id: "claim_review",
        reviewRequiredAt: new Date("2026-08-04T10:00:00.000Z"),
      },
    });

    const promise = prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    await expect(promise).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({
        code: "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
      }),
    });
    expect(taskPaymentClaimDeleteManyMock).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
    // Unlike a plain PENDING claim, this one clears only when an operator
    // acts, so the user's deletion is blocked for an unbounded time by an
    // internal queue. It has to be visible to someone who can clear it.
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Account deletion blocked by a task payment claim awaiting review",
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          userId: "user_delete",
          taskPaymentClaimId: "claim_review",
        }),
      }),
    );
  });

  it("prefers a review-required claim when the user also has plain pending ones", async () => {
    mockPendingClaimLookups({
      reviewRequired: {
        id: "claim_review",
        reviewRequiredAt: new Date("2026-08-04T10:00:00.000Z"),
      },
      // Would be the wrong branch if findFirst were unordered over both types.
      pending: { id: "claim_pending" },
    });

    const promise = prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    await expect(promise).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({
        code: "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
      }),
    });
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Account deletion blocked by a task payment claim awaiting review",
      expect.objectContaining({
        extra: expect.objectContaining({
          taskPaymentClaimId: "claim_review",
        }),
      }),
    );
    // Review path must short-circuit before the plain-PENDING lookup.
    expect(taskPaymentClaimFindFirstMock).toHaveBeenCalledTimes(1);
  });

  it("does not page for a pending claim that will settle on its own", async () => {
    mockPendingClaimLookups({
      reviewRequired: null,
      pending: { id: "claim_pending" },
    });

    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });

    expect(captureMessageMock).not.toHaveBeenCalled();
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
    taskX402PaymentFindFirstMock.mockResolvedValue({
      id: "x402_pending",
      status: TaskX402PaymentStatus.PENDING,
    });

    const promise = prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    await expect(promise).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({
        code: "TASK_X402_PAYMENT_PENDING",
        // The message must describe a remedy that EXISTS. Support now has the
        // admin resolve lever, so "contact support" is a real instruction
        // rather than a dead end the operator cannot act on.
        message: expect.stringContaining("contact support to have it resolved"),
      }),
    });
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledWith({
      where: {
        // The guard matches everything OUTSIDE the sweepable set, so a future
        // enum member blocks deletion instead of matching neither the guard
        // nor the sweep.
        status: {
          notIn: [
            TaskX402PaymentStatus.VERIFIED,
            TaskX402PaymentStatus.FAILED,
            TaskX402PaymentStatus.REFUNDED,
          ],
        },
        // All three RESTRICT branches, including refundTransaction — a
        // PENDING row carrying one should be impossible, but the FK would
        // 500 the user cascade if it existed, so the guard checks it.
        OR: [
          { transaction: { userId: "user_delete" } },
          { refundTransaction: { userId: "user_delete" } },
          { task: { ownerId: "user_delete" } },
        ],
      },
      select: { id: true, status: true },
    });
    expect(taskX402PaymentDeleteManyMock).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
    // No reconciler auto-refunds the held debit and the user cannot unblock
    // themselves, so the block is unbounded — it must page ops (like a
    // review-required claim) so support has a signal to act on. The page has
    // to name the lever: an operator woken by this must not have to go find
    // out which endpoint clears it.
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Account deletion blocked by a pending x402 task payment",
      expect.objectContaining({
        level: "error",
        tags: { error_type: "user_deletion_blocked_by_x402_pending" },
        extra: expect.objectContaining({
          userId: "user_delete",
          taskX402PaymentId: "x402_pending",
          resolveEndpoint:
            "POST /v1/admin/task-x402-payments/x402_pending/resolve",
        }),
      }),
    );
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
    //
    // The sweep ENUMERATES the sweepable statuses and the unresolved guard
    // above it holds the same list inverted (`notIn`). A future enum member
    // (e.g. EXPIRED_UNUSED) therefore matches the guard, not this sweep —
    // deletion blocks with a page until the code learns whether the new
    // status is sweepable, rather than hard-deleting a row that may still
    // represent money in flight. The un-swept-row RESTRICT-FK 500 the old
    // `not: PENDING` shape defended against cannot occur: nothing reaches
    // this sweep in a non-sweepable status past that guard.
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

  it("blocks deletion when a payment is in a status this code does not know", async () => {
    taskX402PaymentFindFirstMock.mockResolvedValue({
      id: "x402_future",
      status: "EXPIRED_UNUSED",
    });

    const promise = prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    await expect(promise).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({
        code: "TASK_X402_PAYMENT_UNRESOLVED",
      }),
    });
    // The resolve lever is PENDING-specific and may not apply here, so the
    // page carries the unexpected status instead of an endpoint.
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Account deletion blocked by an x402 task payment in an unhandled status",
      expect.objectContaining({
        level: "error",
        tags: { error_type: "user_deletion_blocked_by_x402_unhandled" },
        extra: expect.objectContaining({
          userId: "user_delete",
          taskX402PaymentId: "x402_future",
          status: "EXPIRED_UNUSED",
        }),
      }),
    );
    expect(taskX402PaymentDeleteManyMock).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
  });

  /**
   * The x402 `findFirst` is called three times with different predicates: the
   * unresolved-status blocker (`notIn` the sweepable set), the
   * live-authorization blocker (deliberately status-UNSCOPED — it keys on
   * xPaymentHeader alone), then the foreign-charge detector over rows the
   * sweep is about to delete. Discriminate the way the real query would.
   */
  function mockX402Lookups(options: {
    unresolved?: { id: string; status: string } | null;
    liveAuthorization?: { id: string; validBefore: Date | null } | null;
    foreignCharge?: {
      id: string;
      taskId: string;
      transaction: { userId: string };
    } | null;
  }) {
    taskX402PaymentFindFirstMock.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (
          typeof where.status === "object" &&
          where.status !== null &&
          "notIn" in where.status
        ) {
          return options.unresolved ?? null;
        }
        if ("xPaymentHeader" in where) {
          return options.liveAuthorization ?? null;
        }
        return options.foreignCharge ?? null;
      },
    );
  }

  it("blocks deletion while a bearer authorization can still settle", async () => {
    const validBefore = new Date(Date.now() + 60_000);
    mockX402Lookups({
      liveAuthorization: { id: "x402_live", validBefore },
    });

    const promise = prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    await expect(promise).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({
        code: "TASK_X402_PAYMENT_AUTHORIZATION_LIVE",
      }),
    });
    // Exact-match on purpose: the predicate must carry NO status filter.
    // Same principle as the header purge — a credential-retention control
    // must not depend on writer discipline. Only VERIFIED writes a header
    // today, but a status-scoped guard would let a header-bearing row in any
    // other sweepable status (a buggy or future FAILED writer, say) slip
    // past and be hard-deleted with its authorization still live.
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledWith({
      where: {
        xPaymentHeader: { not: null },
        AND: [
          {
            OR: [
              { validBefore: null },
              { validBefore: { gt: expect.any(Date) } },
            ],
          },
          {
            OR: [
              { transaction: { userId: "user_delete" } },
              { refundTransaction: { userId: "user_delete" } },
              { task: { ownerId: "user_delete" } },
            ],
          },
        ],
      },
      select: { id: true, validBefore: true },
    });
    expect(taskX402PaymentDeleteManyMock).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
  });

  it("blocks and pages when the sweep would remove another user's payment", async () => {
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

    const promise = prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    await expect(promise).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({
        code: "TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH",
      }),
    });

    // The detector must look at exactly the rows the sweep deletes whose
    // charge is someone else's: the sweep's own status set, reachable only
    // through the refund or task-owner branch, never the charge branch.
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledWith({
      where: {
        status: {
          in: [
            TaskX402PaymentStatus.VERIFIED,
            TaskX402PaymentStatus.FAILED,
            TaskX402PaymentStatus.REFUNDED,
          ],
        },
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
    // be unreachable. If it ever fires, deletion must stop before a live third
    // party's payment record is destroyed by someone else's account deletion.
    // The page must also say the repair is MANUAL: the admin refund/resolve
    // levers only move status, and every terminal status stays inside the
    // detector's predicate, so pulling them cannot clear this block.
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Account deletion would remove a task x402 payment charged to another user",
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
          repair: expect.stringContaining("No admin endpoint clears this"),
        }),
      }),
    );
    expect(taskX402PaymentDeleteManyMock).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledTimes(3);
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
    expect(taskX402PaymentFindFirstMock).toHaveBeenCalledTimes(3);
    expect(taskX402PaymentDeleteManyMock).toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("checks pending claims before pending x402 payments", async () => {
    mockPendingClaimLookups({
      reviewRequired: null,
      pending: { id: "claim_pending" },
    });
    taskX402PaymentFindFirstMock.mockResolvedValue({ id: "x402_pending" });

    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ code: "TASK_PAYMENT_CLAIM_PENDING" }),
    });
    expect(taskX402PaymentFindFirstMock).not.toHaveBeenCalled();
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
