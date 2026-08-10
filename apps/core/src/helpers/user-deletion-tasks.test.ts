import { TaskPaymentClaimStatus } from "@sokosumi/database";
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
          findFirst: taskPaymentClaimFindFirstMock,
          deleteMany: taskPaymentClaimDeleteManyMock,
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
});
