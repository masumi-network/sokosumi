import {
  TaskScheduleState,
  TaskVisibility,
  TaskX402PaymentStatus,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarErasureBlockedError } from "./calendar-erasure";
import { lastVendorAdminBlockerWhere } from "./deletion-evaluate";
import { prepareTasksForUserDeletion } from "./user-deletion-tasks";

const {
  taskFileFindManyMock,
  taskUpdateMock,
  taskDeleteManyMock,
  taskScheduleUpdateMock,
  taskScheduleDeleteManyMock,
  taskScheduleFindManyMock,
  taskScheduleUpdateManyMock,
  network,
  rules,
  chatRoomFindManyMock,
  chatRoomUpdateMock,
  chatRoomDeleteMock,
  userDeleteManyMock,
  vendorMemberFindManyMock,
  vendorMemberFindFirstMock,
  vendorUpdateMock,
  vendorMemberInviteUpdateManyMock,
  calendarInvalidationOutboxDeleteManyMock,
  queryRawMock,
  executeRawMock,
  transactionMock,
  deleteTaskFileIfOwnedMock,
  cancelNotificationEmailsMock,
  captureMessageMock,
  eraseWorkspaceCalendarDataMock,
  lockWorkspaceCalendarForErasureMock,
} = vi.hoisted(() => ({
  cancelNotificationEmailsMock: vi.fn(),
  captureMessageMock: vi.fn(),
  taskFileFindManyMock: vi.fn(),
  taskUpdateMock: vi.fn(),
  taskDeleteManyMock: vi.fn(),
  taskScheduleUpdateMock: vi.fn(),
  taskScheduleDeleteManyMock: vi.fn(),
  taskScheduleFindManyMock: vi.fn(),
  taskScheduleUpdateManyMock: vi.fn(),
  // The statements on a Network's rows, and the rules of the keys that cross
  // into it, are raw SQL: `user-deletion-crossing-rules.postgres.test.ts`
  // proves them on PostgreSQL. Here they are mocked, so these tests hold the
  // order, the error contract and the paging.
  network: {
    lockX402PaymentsOfUser: vi.fn(),
    findReviewRequiredClaim: vi.fn(),
    findPendingClaim: vi.fn(),
    deleteTerminalClaims: vi.fn(),
    findUnresolvedX402Payment: vi.fn(),
    findLiveAuthorizationX402Payment: vi.fn(),
    findForeignChargeX402Payment: vi.fn(),
    deleteSweepableX402Payments: vi.fn(),
    findJobsDeletedWithUser: vi.fn(),
    deleteJobs: vi.fn(),
  },
  rules: {
    applyPersonalWorkspaceRules: vi.fn(),
    applyJobRules: vi.fn(),
    applyPrivateTaskRules: vi.fn(),
    applyUserRules: vi.fn(),
  },
  chatRoomFindManyMock: vi.fn(),
  chatRoomUpdateMock: vi.fn(),
  chatRoomDeleteMock: vi.fn(),
  userDeleteManyMock: vi.fn(),
  vendorMemberFindManyMock: vi.fn(),
  vendorMemberFindFirstMock: vi.fn(),
  vendorUpdateMock: vi.fn(),
  vendorMemberInviteUpdateManyMock: vi.fn(),
  calendarInvalidationOutboxDeleteManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  executeRawMock: vi.fn(),
  transactionMock: vi.fn(),
  deleteTaskFileIfOwnedMock: vi.fn(),
  eraseWorkspaceCalendarDataMock: vi.fn(),
  lockWorkspaceCalendarForErasureMock: vi.fn(),
}));

vi.mock("@/helpers/calendar-erasure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/calendar-erasure")>()),
  eraseWorkspaceCalendarData: eraseWorkspaceCalendarDataMock,
  lockWorkspaceCalendarForErasure: lockWorkspaceCalendarForErasureMock,
}));

vi.mock("@/helpers/user-deletion-network", () => network);
vi.mock("@/helpers/user-deletion-crossing-rules", () => rules);

vi.mock("@/helpers/notification-email-dispatch", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-email-dispatch")
  >()),
  cancelNotificationEmails: cancelNotificationEmailsMock,
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
    for (const mock of Object.values({ ...network, ...rules })) {
      mock.mockResolvedValue(undefined);
    }
    network.findJobsDeletedWithUser.mockResolvedValue([]);
    chatRoomFindManyMock.mockResolvedValue([]);
    chatRoomUpdateMock.mockResolvedValue({});
    chatRoomDeleteMock.mockResolvedValue({});
    userDeleteManyMock.mockResolvedValue({ count: 1 });
    vendorMemberFindManyMock.mockResolvedValue([]);
    vendorMemberFindFirstMock.mockResolvedValue(null);
    vendorUpdateMock.mockResolvedValue({});
    vendorMemberInviteUpdateManyMock.mockResolvedValue({ count: 0 });
    calendarInvalidationOutboxDeleteManyMock.mockResolvedValue({ count: 0 });
    taskScheduleDeleteManyMock.mockResolvedValue({ count: 0 });
    taskScheduleFindManyMock.mockResolvedValue([]);
    taskScheduleUpdateManyMock.mockResolvedValue({ count: 0 });
    queryRawMock.mockResolvedValue([]);
    executeRawMock.mockResolvedValue(0);
    eraseWorkspaceCalendarDataMock.mockResolvedValue({
      taskFiles: [],
      scheduledEmails: [],
    });
    lockWorkspaceCalendarForErasureMock.mockResolvedValue(true);
    deleteTaskFileIfOwnedMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (callback) =>
      callback({
        $queryRaw: queryRawMock,
        $executeRaw: executeRawMock,
        task: {
          update: taskUpdateMock,
          deleteMany: taskDeleteManyMock,
        },
        taskSchedule: {
          update: taskScheduleUpdateMock,
          deleteMany: taskScheduleDeleteManyMock,
          findMany: taskScheduleFindManyMock,
          updateMany: taskScheduleUpdateManyMock,
        },
        taskFile: {
          findMany: taskFileFindManyMock,
        },
        chatRoom: {
          findMany: chatRoomFindManyMock,
          update: chatRoomUpdateMock,
          delete: chatRoomDeleteMock,
        },
        user: {
          deleteMany: userDeleteManyMock,
        },
        vendorMember: {
          findMany: vendorMemberFindManyMock,
          findFirst: vendorMemberFindFirstMock,
        },
        vendor: {
          update: vendorUpdateMock,
        },
        vendorMemberInvite: {
          updateMany: vendorMemberInviteUpdateManyMock,
        },
        calendarInvalidationOutbox: {
          deleteMany: calendarInvalidationOutboxDeleteManyMock,
        },
      }),
    );
  });

  it("locks owned tasks and reachable x402 payments before checking payment state", async () => {
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(queryRawMock).toHaveBeenCalledTimes(4);
    const [userLock, workspaceLock, projectLock, taskLock] =
      queryRawMock.mock.calls.map(([strings, ...values]) =>
        PrismaRaw.sql(strings as TemplateStringsArray, ...values),
      );
    expect(userLock.sql).toMatch(
      /FROM "public"."user"[\s\S]*WHERE "id" = \?[\s\S]*FOR UPDATE/,
    );
    expect(userLock.values).toEqual(["user_delete"]);
    expect(workspaceLock.sql).toMatch(
      /FROM "public"."workspace"[\s\S]*FOR UPDATE OF workspace/,
    );
    expect(workspaceLock.values).toEqual(["user_delete", "user_delete"]);
    expect(projectLock.sql).toMatch(
      /FROM "public"."project"[\s\S]*FOR UPDATE OF project/,
    );
    expect(projectLock.values).toEqual(["user_delete", "user_delete"]);
    expect(taskLock.sql).toMatch(
      /FROM "public"."task"[\s\S]*WHERE "ownerId" = \?[\s\S]*FOR UPDATE/,
    );
    expect(taskLock.values).toEqual(["user_delete"]);
    // Mainnet only: Preprod is off in a unit run.
    expect(network.lockX402PaymentsOfUser.mock.calls).toEqual([
      [expect.any(Object), "mainnet", "user_delete"],
    ]);
    const paymentLockOrder =
      network.lockX402PaymentsOfUser.mock.invocationCallOrder[0];
    expect(queryRawMock.mock.invocationCallOrder[3]).toBeLessThan(
      paymentLockOrder,
    );
    expect(paymentLockOrder).toBeLessThan(
      network.findReviewRequiredClaim.mock.invocationCallOrder[0],
    );
    expect(paymentLockOrder).toBeLessThan(
      network.deleteSweepableX402Payments.mock.invocationCallOrder[0],
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
    expect(calendarInvalidationOutboxDeleteManyMock).toHaveBeenCalledWith({
      where: {
        payload: { path: ["userId"], equals: "user_delete" },
        publishedAt: { not: null },
      },
    });
    expect(taskDeleteManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      userDeleteManyMock.mock.invocationCallOrder[0],
    );
  });

  it("writes each Vendor row, then rechecks the last-admin rule before deleting (V87)", async () => {
    const vendorIds = [
      "01960001-0001-7001-8001-000000000001",
      "01960001-0001-7001-8001-000000000002",
    ];
    vendorMemberFindManyMock.mockResolvedValue(
      vendorIds.map((vendorId) => ({ vendorId })),
    );
    vendorMemberFindFirstMock.mockResolvedValue({ id: "vendor_admin_member" });

    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({
        code: "USER_IS_LAST_VENDOR_ADMIN",
        message: expect.stringContaining("archive the Vendor's coworkers"),
      }),
    });

    // A FOR UPDATE lock is not enough: a Serializable membership change
    // queued on the row took its snapshot before waiting, so only a
    // committed write makes Postgres abort it for a retry.
    expect(vendorMemberFindManyMock).toHaveBeenCalledWith({
      where: { userId: "user_delete" },
      select: { vendorId: true },
      orderBy: { vendorId: "asc" },
    });
    expect(vendorUpdateMock.mock.calls).toEqual(
      vendorIds.map((vendorId) => [
        {
          where: { id: vendorId },
          data: { updatedAt: expect.any(Date) },
          select: { id: true },
        },
      ]),
    );
    // A pending invite to a Vendor the user alone administers would add a
    // member to an admin-less Vendor once accepted. Revoking before the
    // recheck also makes a concurrent accept either visible to the recheck
    // or blocked on the invite row until it fails serialization.
    expect(vendorMemberInviteUpdateManyMock).toHaveBeenCalledWith({
      where: {
        status: "PENDING",
        vendor: {
          vendorMembers: {
            some: { userId: "user_delete", role: "admin" },
            none: { userId: { not: "user_delete" }, role: "admin" },
          },
        },
      },
      data: { status: "REVOKED", resolvedAt: expect.any(Date) },
    });
    expect(vendorMemberFindFirstMock).toHaveBeenCalledWith({
      where: lastVendorAdminBlockerWhere("user_delete"),
      select: { id: true },
    });
    expect(vendorUpdateMock.mock.invocationCallOrder[1]).toBeLessThan(
      vendorMemberInviteUpdateManyMock.mock.invocationCallOrder[0],
    );
    expect(
      vendorMemberInviteUpdateManyMock.mock.invocationCallOrder[0],
    ).toBeLessThan(vendorMemberFindFirstMock.mock.invocationCallOrder[0]);
    expect(userDeleteManyMock).not.toHaveBeenCalled();
  });

  it("lets a sole Vendor admin with nothing left to hand over delete (V87)", async () => {
    vendorMemberFindManyMock.mockResolvedValue([
      { vendorId: "01960001-0001-7001-8001-000000000001" },
    ]);
    vendorMemberFindFirstMock.mockResolvedValue(null);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(userDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "user_delete" },
    });
  });

  it("erases Calendar data for the user's personal Workspace", async () => {
    queryRawMock
      .mockResolvedValueOnce([{ id: "user_delete" }])
      .mockResolvedValueOnce([
        { id: "workspace_personal", userId: "user_delete" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(eraseWorkspaceCalendarDataMock).toHaveBeenCalledWith(
      expect.any(Object),
      "workspace_personal",
    );
  });

  it.each([
    ["task_payment_unresolved", "TASK_X402_PAYMENT_UNRESOLVED"],
    ["task_payment_authorization_live", "TASK_X402_PAYMENT_AUTHORIZATION_LIVE"],
  ] as const)("maps a %s erasure blocker to %s", async (blocker, code) => {
    queryRawMock
      .mockResolvedValueOnce([{ id: "user_delete" }])
      .mockResolvedValueOnce([
        { id: "workspace_personal", userId: "user_delete" },
      ]);
    lockWorkspaceCalendarForErasureMock.mockRejectedValue(
      new CalendarErasureBlockedError(blocker, "payment-1"),
    );

    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({ code }),
    });
    expect(userDeleteManyMock).not.toHaveBeenCalled();
  });

  it("treats a concurrent delete that already removed the user as a no-op", async () => {
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
        // the claim sweep, the owned-task delete, or the user-row lock
        // contending with an unrelated FK insert — not only from a payment.
        code: "ACCOUNT_DELETION_CONCURRENT_CHANGE",
        message: expect.stringContaining("Retry account deletion"),
      }),
    });
    expect(deleteTaskFileIfOwnedMock).not.toHaveBeenCalled();
  });

  it("deletes only private work and leaves public work to the database, which empties the Owner and Creator", async () => {
    taskDeleteManyMock.mockResolvedValue({ count: 1 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(taskUpdateMock).not.toHaveBeenCalled();
    expect(taskScheduleUpdateMock).not.toHaveBeenCalled();
    const privateWork = {
      ownerId: "user_delete",
      visibility: TaskVisibility.PRIVATE,
    };
    expect(taskDeleteManyMock).toHaveBeenCalledWith({ where: privateWork });
    expect(taskScheduleDeleteManyMock).toHaveBeenCalledWith({
      where: privateWork,
    });
  });

  it("applies each crossing rule before the delete of its parent", async () => {
    queryRawMock.mockImplementation(
      async (strings: TemplateStringsArray, ...values: unknown[]) =>
        PrismaRaw.sql(strings, ...values).sql.includes(
          'FROM "public"."workspace"',
        )
          ? [{ id: "workspace_personal", userId: "user_delete" }]
          : [],
    );
    network.findJobsDeletedWithUser.mockResolvedValue(["job_private"]);
    taskDeleteManyMock.mockResolvedValue({ count: 1 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(rules.applyPersonalWorkspaceRules.mock.calls).toEqual([
      [expect.any(Object), "workspace_personal"],
    ]);
    expect(rules.applyJobRules.mock.calls).toEqual([
      [expect.any(Object), "mainnet", ["job_private"]],
    ]);
    expect(network.deleteJobs.mock.calls).toEqual([
      [expect.any(Object), "mainnet", ["job_private"]],
    ]);
    const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
      mock.mock.invocationCallOrder[0];
    expect(
      [
        network.deleteSweepableX402Payments,
        rules.applyPersonalWorkspaceRules,
        eraseWorkspaceCalendarDataMock,
        rules.applyJobRules,
        network.deleteJobs,
        rules.applyPrivateTaskRules,
        taskDeleteManyMock,
        rules.applyUserRules,
        userDeleteManyMock,
      ].map(order),
    ).toEqual(
      [
        network.deleteSweepableX402Payments,
        rules.applyPersonalWorkspaceRules,
        eraseWorkspaceCalendarDataMock,
        rules.applyJobRules,
        network.deleteJobs,
        rules.applyPrivateTaskRules,
        taskDeleteManyMock,
        rules.applyUserRules,
        userDeleteManyMock,
      ]
        .map(order)
        .sort((a, b) => a - b),
    );
  });

  it("pauses the public Task Schedules the user owned", async () => {
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(taskScheduleFindManyMock).toHaveBeenCalledWith({
      where: {
        ownerId: "user_delete",
        visibility: TaskVisibility.PUBLIC,
        state: TaskScheduleState.ACTIVE,
      },
      select: { id: true },
    });
    expect(taskScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [] } },
      data: {
        state: TaskScheduleState.PAUSED,
        nextRunAt: null,
        revision: { increment: 1 },
      },
    });
  });

  function mockPendingClaimLookups(options: {
    reviewRequired?: { id: string; reviewRequiredAt: Date } | null;
    pending?: { id: string } | null;
  }) {
    network.findReviewRequiredClaim.mockResolvedValue(
      options.reviewRequired ?? undefined,
    );
    network.findPendingClaim.mockResolvedValue(options.pending ?? undefined);
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
    expect(network.deleteTerminalClaims).not.toHaveBeenCalled();
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
    expect(network.deleteTerminalClaims).not.toHaveBeenCalled();
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
    expect(network.findPendingClaim).not.toHaveBeenCalled();
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
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(network.deleteTerminalClaims.mock.calls).toEqual([
      [expect.any(Object), "mainnet", "user_delete"],
    ]);
    expect(
      network.deleteTerminalClaims.mock.invocationCallOrder[0],
    ).toBeLessThan(rules.applyUserRules.mock.invocationCallOrder[0]);
    expect(taskDeleteManyMock).toHaveBeenCalled();
  });

  it("blocks deletion while a task x402 payment is pending", async () => {
    network.findUnresolvedX402Payment.mockResolvedValue({
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
    expect(network.findUnresolvedX402Payment.mock.calls).toEqual([
      [expect.any(Object), "mainnet", "user_delete"],
    ]);
    expect(network.deleteSweepableX402Payments).not.toHaveBeenCalled();
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
    taskDeleteManyMock.mockResolvedValue({ count: 0 });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(network.deleteSweepableX402Payments.mock.calls).toEqual([
      [expect.any(Object), "mainnet", "user_delete"],
    ]);
    // ORDER is the invariant, not just both-called: taskId is RESTRICT, so
    // sweeping x402 payments after the task delete fails the owned-task
    // delete on task_x402_payment_taskId_fkey and account deletion 500s.
    const x402SweepCallOrder =
      network.deleteSweepableX402Payments.mock.invocationCallOrder[0];
    const taskDeleteCallOrder = taskDeleteManyMock.mock.invocationCallOrder[0];
    expect(x402SweepCallOrder).toBeLessThan(taskDeleteCallOrder);
  });

  it("blocks deletion when a payment is in a status this code does not know", async () => {
    network.findUnresolvedX402Payment.mockResolvedValue({
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
    expect(network.deleteSweepableX402Payments).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
  });

  function mockX402Lookups(options: {
    unresolved?: { id: string; status: string };
    liveAuthorization?: { id: string };
    foreignCharge?: { id: string; taskId: string; chargedUserId: string };
  }) {
    network.findUnresolvedX402Payment.mockResolvedValue(options.unresolved);
    network.findLiveAuthorizationX402Payment.mockResolvedValue(
      options.liveAuthorization,
    );
    network.findForeignChargeX402Payment.mockResolvedValue(
      options.foreignCharge,
    );
  }

  it("blocks deletion while a bearer authorization can still settle", async () => {
    mockX402Lookups({ liveAuthorization: { id: "x402_live" } });

    const promise = prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    await expect(promise).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: expect.objectContaining({
        code: "TASK_X402_PAYMENT_AUTHORIZATION_LIVE",
      }),
    });
    expect(network.findLiveAuthorizationX402Payment.mock.calls).toEqual([
      [expect.any(Object), "mainnet", "user_delete", expect.any(Date)],
    ]);
    expect(network.deleteSweepableX402Payments).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
  });

  it("blocks and pages when the sweep would remove another user's payment", async () => {
    taskDeleteManyMock.mockResolvedValue({ count: 0 });
    mockX402Lookups({
      foreignCharge: {
        id: "x402_foreign",
        taskId: "tsk_owned",
        chargedUserId: "user_charged",
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

    expect(network.findForeignChargeX402Payment.mock.calls).toEqual([
      [expect.any(Object), "mainnet", "user_delete"],
    ]);
    // A Task's charges go to its Owner, so this should
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
    expect(network.deleteSweepableX402Payments).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
  });

  it("does not page when every swept payment is charged to the deleted user", async () => {
    taskDeleteManyMock.mockResolvedValue({ count: 0 });
    mockX402Lookups({});

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    // The detector still has to run — silence must come from finding nothing,
    // not from skipping the check.
    expect(network.findForeignChargeX402Payment).toHaveBeenCalledTimes(1);
    expect(network.deleteSweepableX402Payments).toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("checks pending claims before pending x402 payments", async () => {
    mockPendingClaimLookups({
      reviewRequired: null,
      pending: { id: "claim_pending" },
    });
    network.findUnresolvedX402Payment.mockResolvedValue({ id: "x402_pending" });

    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ code: "TASK_PAYMENT_CLAIM_PENDING" }),
    });
    expect(network.findUnresolvedX402Payment).not.toHaveBeenCalled();
  });

  /** `unresolvedPayment`: what the workspace's unresolved-payment read finds. */
  async function useRealPersonalWorkspaceErasure(unresolvedPayment?: {
    id: string;
    status: string;
  }) {
    const actual =
      await vi.importActual<typeof import("./calendar-erasure")>(
        "./calendar-erasure",
      );
    eraseWorkspaceCalendarDataMock.mockImplementation(
      actual.eraseWorkspaceCalendarData,
    );
    lockWorkspaceCalendarForErasureMock.mockImplementation(
      actual.lockWorkspaceCalendarForErasure,
    );
    queryRawMock.mockImplementation(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = PrismaRaw.sql(strings, ...values);
        if (query.sql.includes('FROM "public"."workspace"')) {
          return [{ id: "workspace_personal", userId: "user_delete" }];
        }
        return unresolvedPayment && query.sql.includes("payment.status <> ALL")
          ? [unresolvedPayment]
          : [];
      },
    );
    const runTransaction = transactionMock.getMockImplementation();
    transactionMock.mockImplementation(async (callback) =>
      runTransaction?.(async (tx: Record<string, unknown>) => {
        const calendarModels = Object.fromEntries(
          [
            "taskScheduleRun",
            "taskLink",
            "taskScheduleCreateOperation",
            "taskEvent",
            "projectEvent",
            "projectCloseOperation",
            "project",
            "notification",
          ].map((name) => [
            name,
            {
              deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
              updateMany: vi.fn(),
              findMany: vi.fn().mockResolvedValue([]),
            },
          ]),
        );
        return callback({ ...tx, ...calendarModels });
      }),
    );
  }

  it("preserves the pending-payment support flow for personal workspace erasure", async () => {
    await useRealPersonalWorkspaceErasure({
      id: "x402_personal_pending",
      status: TaskX402PaymentStatus.PENDING,
    });

    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).rejects.toMatchObject({
      body: { code: "TASK_X402_PAYMENT_PENDING" },
    });
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Account deletion blocked by a pending x402 task payment",
      {
        level: "error",
        tags: { error_type: "user_deletion_blocked_by_x402_pending" },
        extra: {
          userId: "user_delete",
          taskX402PaymentId: "x402_personal_pending",
          resolveEndpoint:
            "POST /v1/admin/task-x402-payments/x402_personal_pending/resolve",
        },
      },
    );
    expect(network.deleteSweepableX402Payments).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
    expect(userDeleteManyMock).not.toHaveBeenCalled();
  });

  it("pages support for an unknown payment status in a personal workspace", async () => {
    await useRealPersonalWorkspaceErasure({
      id: "unknown-payment",
      status: "FUTURE_STATUS",
    });
    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).rejects.toMatchObject({ body: { code: "TASK_X402_PAYMENT_UNRESOLVED" } });
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tags: { error_type: "user_deletion_blocked_by_x402_unhandled" },
        extra: expect.objectContaining({
          taskX402PaymentId: "unknown-payment",
          status: "FUTURE_STATUS",
        }),
      }),
    );
  });

  it("cancels personal workspace emails after account deletion commits", async () => {
    queryRawMock.mockResolvedValue([{ id: "personal", userId: "user_delete" }]);
    const scheduledEmails = [
      { id: "notice", emailId: "queued", emailScheduledAt: new Date() },
    ];
    eraseWorkspaceCalendarDataMock.mockResolvedValue({
      taskFiles: [],
      scheduledEmails,
    });
    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);
    expect(cancelNotificationEmailsMock).toHaveBeenCalledWith(scheduledEmails);
    expect(userDeleteManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      cancelNotificationEmailsMock.mock.invocationCallOrder[0],
    );
  });

  it("cleans personal task blobs after Calendar erasure cascades file records", async () => {
    await useRealPersonalWorkspaceErasure();
    const file = {
      fileUrl:
        "https://abc.public.blob.vercel-storage.com/tasks/tsk_owned/a.pdf",
      taskId: "tsk_owned",
    };
    let files = [file];
    taskFileFindManyMock.mockImplementation(async () => [...files]);
    taskDeleteManyMock.mockImplementation(async () => {
      files = [];
      return { count: 1 };
    });

    await prepareTasksForUserDeletion("user_delete", {
      $transaction: transactionMock,
    } as never);

    expect(files).toEqual([]);
    expect(deleteTaskFileIfOwnedMock).toHaveBeenCalledWith(
      file.fileUrl,
      file.taskId,
    );
    expect(userDeleteManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteTaskFileIfOwnedMock.mock.invocationCallOrder[0],
    );
  });

  it("preserves another user's payment evidence during personal Calendar erasure", async () => {
    await useRealPersonalWorkspaceErasure();
    network.findForeignChargeX402Payment.mockResolvedValue({
      id: "x402_foreign",
      taskId: "tsk_owned",
      chargedUserId: "user_charged",
    });

    await expect(
      prepareTasksForUserDeletion("user_delete", {
        $transaction: transactionMock,
      } as never),
    ).rejects.toMatchObject({
      body: { code: "TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH" },
    });
    // Neither sweep ran: the account's, and the workspace's raw delete.
    expect(network.deleteSweepableX402Payments).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(taskDeleteManyMock).not.toHaveBeenCalled();
    expect(userDeleteManyMock).not.toHaveBeenCalled();
    expect(deleteTaskFileIfOwnedMock).not.toHaveBeenCalled();
  });

  it("best-effort deletes blob files for owned tasks after cascade", async () => {
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
      where: {
        task: { ownerId: "user_delete", visibility: TaskVisibility.PRIVATE },
      },
      select: { fileUrl: true, taskId: true },
    });
    expect(deleteTaskFileIfOwnedMock).toHaveBeenCalledWith(
      "https://abc.public.blob.vercel-storage.com/tasks/tsk_owned/a.pdf",
      "tsk_owned",
    );
  });

  it("repoints chat room createdByUserId to a remaining member", async () => {
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
