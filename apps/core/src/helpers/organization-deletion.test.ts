import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarErasureBlockedError } from "./calendar-erasure";
import { prepareOrganizationForDeletion } from "./organization-deletion";

const {
  cancelNotificationEmailsMock,
  deleteTaskFileIfOwnedMock,
  captureMessageMock,
  eraseWorkspaceCalendarDataMock,
  evaluateOrganizationDeletionMock,
  lockCalendarErasureUserMock,
  lockWorkspaceCalendarForErasureMock,
  lockCalendarScopeMock,
  throwIfOrganizationDeletionBlockedMock,
} = vi.hoisted(() => ({
  cancelNotificationEmailsMock: vi.fn(),
  deleteTaskFileIfOwnedMock: vi.fn(),
  captureMessageMock: vi.fn(),
  eraseWorkspaceCalendarDataMock: vi.fn(),
  evaluateOrganizationDeletionMock: vi.fn(),
  lockCalendarErasureUserMock: vi.fn(),
  lockWorkspaceCalendarForErasureMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  throwIfOrganizationDeletionBlockedMock: vi.fn(),
}));

vi.mock("@/helpers/calendar-erasure", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/calendar-erasure")>();
  return {
    ...actual,
    eraseWorkspaceCalendarData: eraseWorkspaceCalendarDataMock,
    lockCalendarErasureUser: lockCalendarErasureUserMock,
    lockWorkspaceCalendarForErasure: lockWorkspaceCalendarForErasureMock,
  };
});

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
}));

vi.mock("@/helpers/deletion-evaluate", () => ({
  evaluateOrganizationDeletion: evaluateOrganizationDeletionMock,
  throwIfOrganizationDeletionBlocked: throwIfOrganizationDeletionBlockedMock,
}));

vi.mock("@/helpers/notification-email-dispatch", () => ({
  cancelNotificationEmails: cancelNotificationEmailsMock,
}));
vi.mock("@/lib/blob", () => ({
  deleteTaskFileIfOwned: deleteTaskFileIfOwnedMock,
}));
vi.mock("@sentry/node", () => ({ captureMessage: captureMessageMock }));

function createPrisma() {
  const queryRaw = vi.fn();
  const paymentFindFirst = vi.fn().mockResolvedValue(null);
  const committed = vi.fn();
  const workspaceFindUnique = vi.fn();
  const organizationDeleteMany = vi.fn();
  const transaction = vi.fn(async (callback) => {
    const result = await callback({
      taskX402Payment: { findFirst: paymentFindFirst },
      $queryRaw: queryRaw,
      workspace: { findUnique: workspaceFindUnique },
      organization: { deleteMany: organizationDeleteMany },
    });
    committed();
    return result;
  });

  return {
    prisma: { $transaction: transaction },
    paymentFindFirst,
    committed,
    queryRaw,
    workspaceFindUnique,
    organizationDeleteMany,
  };
}

describe("prepareOrganizationForDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalendarErasureUserMock.mockResolvedValue(true);
    lockCalendarScopeMock.mockResolvedValue(true);
    evaluateOrganizationDeletionMock.mockResolvedValue({ blockers: [] });
    eraseWorkspaceCalendarDataMock.mockResolvedValue({
      taskFiles: [],
      scheduledEmails: [],
    });
    lockWorkspaceCalendarForErasureMock.mockResolvedValue(true);
  });

  it("evaluates, erases, and deletes under canonical parent-first locks", async () => {
    const { prisma, queryRaw, workspaceFindUnique, organizationDeleteMany } =
      createPrisma();
    queryRaw.mockResolvedValue([{ id: "org-1", stripeCustomerId: "cus_123" }]);
    workspaceFindUnique.mockResolvedValue({ id: "workspace-1" });
    organizationDeleteMany.mockResolvedValue({ count: 1 });

    await expect(
      prepareOrganizationForDeletion("org-1", "user-1", prisma as never),
    ).resolves.toBe("cus_123");

    expect(lockCalendarErasureUserMock).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
    );
    expect(
      (queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("?"),
    ).toMatch(/FROM "organization"[\s\S]*WHERE id = \?[\s\S]*FOR UPDATE/);
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual(["org-1"]);
    expect(workspaceFindUnique).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      select: { id: true },
    });
    expect(lockCalendarScopeMock).toHaveBeenCalledWith(
      expect.any(Object),
      "workspace-1",
      [],
    );
    expect(evaluateOrganizationDeletionMock).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      expect.any(Object),
    );
    expect(eraseWorkspaceCalendarDataMock).toHaveBeenCalledWith(
      expect.any(Object),
      "workspace-1",
    );
    expect(organizationDeleteMany).toHaveBeenCalledWith({
      where: { id: "org-1" },
    });

    const orderedMocks = [
      lockCalendarErasureUserMock,
      queryRaw,
      workspaceFindUnique,
      lockCalendarScopeMock,
      evaluateOrganizationDeletionMock,
      throwIfOrganizationDeletionBlockedMock,
      lockWorkspaceCalendarForErasureMock,
      eraseWorkspaceCalendarDataMock,
      organizationDeleteMany,
    ];
    expect(
      orderedMocks.map((mock) => mock.mock.invocationCallOrder[0]),
    ).toEqual(
      [...orderedMocks]
        .map((mock) => mock.mock.invocationCallOrder[0])
        .sort((left, right) => left - right),
    );
  });

  it("maps calendar payment blockers to the organization deletion contract", async () => {
    const { prisma, queryRaw, workspaceFindUnique, organizationDeleteMany } =
      createPrisma();
    queryRaw.mockResolvedValue([{ id: "org-1", stripeCustomerId: null }]);
    workspaceFindUnique.mockResolvedValue({ id: "workspace-1" });
    lockWorkspaceCalendarForErasureMock.mockRejectedValue(
      new CalendarErasureBlockedError("task_payment_unresolved", "payment-1"),
    );

    let caught: unknown;
    try {
      await prepareOrganizationForDeletion("org-1", "user-1", prisma as never);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(APIError);
    expect((caught as APIError).status).toBe("BAD_REQUEST");
    expect((caught as APIError).body?.code).toBe(
      "ORGANIZATION_DELETION_TASK_PAYMENT_BLOCKED",
    );
    expect(organizationDeleteMany).not.toHaveBeenCalled();
  });
  it("cancels scheduled emails and deletes task blobs only after commit", async () => {
    const { prisma, queryRaw, workspaceFindUnique, committed } = createPrisma();
    queryRaw.mockResolvedValue([{ id: "org-1", stripeCustomerId: null }]);
    workspaceFindUnique.mockResolvedValue({ id: "workspace-1" });
    const scheduledEmails = [
      { id: "notice", emailId: "email", emailScheduledAt: new Date() },
    ];
    eraseWorkspaceCalendarDataMock.mockResolvedValue({
      scheduledEmails,
      taskFiles: [
        { fileUrl: "https://blob/tasks/task-1/file", taskId: "task-1" },
      ],
    });
    await prepareOrganizationForDeletion("org-1", "user-1", prisma as never);
    expect(cancelNotificationEmailsMock).toHaveBeenCalledWith(scheduledEmails);
    expect(deleteTaskFileIfOwnedMock).toHaveBeenCalledWith(
      "https://blob/tasks/task-1/file",
      "task-1",
    );
    for (const cleanup of [
      cancelNotificationEmailsMock,
      deleteTaskFileIfOwnedMock,
    ]) {
      expect(committed.mock.invocationCallOrder[0]).toBeLessThan(
        cleanup.mock.invocationCallOrder[0],
      );
    }
  });

  it("does not clean external resources when the transaction rolls back", async () => {
    const { prisma, queryRaw, workspaceFindUnique, organizationDeleteMany } =
      createPrisma();
    queryRaw.mockResolvedValue([{ id: "org-1", stripeCustomerId: null }]);
    workspaceFindUnique.mockResolvedValue({ id: "workspace-1" });
    organizationDeleteMany.mockRejectedValue(new Error("rollback"));
    await expect(
      prepareOrganizationForDeletion("org-1", "user-1", prisma as never),
    ).rejects.toThrow("rollback");
    expect(cancelNotificationEmailsMock).not.toHaveBeenCalled();
    expect(deleteTaskFileIfOwnedMock).not.toHaveBeenCalled();
  });

  it("preserves payment records charged to another user", async () => {
    const {
      prisma,
      queryRaw,
      workspaceFindUnique,
      paymentFindFirst,
      organizationDeleteMany,
    } = createPrisma();
    queryRaw.mockResolvedValue([{ id: "org-1", stripeCustomerId: null }]);
    workspaceFindUnique.mockResolvedValue({ id: "workspace-1" });
    paymentFindFirst.mockResolvedValue({
      id: "foreign-payment",
      taskId: "former-member-task",
      transaction: { userId: "former-member" },
    });
    await expect(
      prepareOrganizationForDeletion("org-1", "user-1", prisma as never),
    ).rejects.toMatchObject({
      body: { code: "TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH" },
    });
    expect(paymentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          task: { workspaceId: "workspace-1" },
          transaction: { userId: { not: "user-1" } },
        }),
      }),
    );
    expect(eraseWorkspaceCalendarDataMock).not.toHaveBeenCalled();
    expect(organizationDeleteMany).not.toHaveBeenCalled();
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          taskX402PaymentId: "foreign-payment",
        }),
      }),
    );
  });

  it("maps transaction deadlocks to a retryable organization error", async () => {
    const { prisma } = createPrisma();
    prisma.$transaction.mockRejectedValue({ code: "P2034" });
    await expect(
      prepareOrganizationForDeletion("org-1", "user-1", prisma as never),
    ).rejects.toMatchObject({
      body: { code: "ORGANIZATION_DELETION_CONCURRENT_CHANGE" },
    });
  });

  it.each([
    "task_payment_pending",
    "task_payment_unresolved",
    "task_payment_authorization_live",
  ] as const)("pages support for %s", async (blocker) => {
    const { prisma, queryRaw, workspaceFindUnique } = createPrisma();
    queryRaw.mockResolvedValue([{ id: "org-1", stripeCustomerId: null }]);
    workspaceFindUnique.mockResolvedValue({ id: "workspace-1" });
    lockWorkspaceCalendarForErasureMock.mockRejectedValue(
      new CalendarErasureBlockedError(blocker, "payment-1"),
    );
    await expect(
      prepareOrganizationForDeletion("org-1", "user-1", prisma as never),
    ).rejects.toMatchObject({
      body: {
        code: "ORGANIZATION_DELETION_TASK_PAYMENT_BLOCKED",
        message: expect.stringMatching(/contact support/i),
      },
    });
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          organizationId: "org-1",
          taskX402PaymentId: "payment-1",
        }),
      }),
    );
  });
});
