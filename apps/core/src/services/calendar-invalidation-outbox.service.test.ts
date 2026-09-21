import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cancelNotificationEmailsMock,
  findManyMock,
  findUniqueMock,
  deleteManyMock,
  executeRawMock,
  queryRawMock,
  projectUpdateManyMock,
  publishAccessRevokedMock,
  publishMock,
  transactionMock,
  updateManyMock,
  workspaceUpdateManyMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  cancelNotificationEmailsMock: vi.fn(),
  deleteManyMock: vi.fn(),
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  executeRawMock: vi.fn(),
  queryRawMock: vi.fn(),
  projectUpdateManyMock: vi.fn(),
  publishAccessRevokedMock: vi.fn(),
  publishMock: vi.fn(),
  transactionMock: vi.fn(),
  updateManyMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  workspaceUpdateManyMock: vi.fn(),
}));

vi.mock("@/helpers/notification-email-dispatch", () => ({
  cancelNotificationEmails: cancelNotificationEmailsMock,
}));

vi.mock("@/lib/ably/publish", () => ({
  publishCalendarAccessRevoked: publishAccessRevokedMock,
  publishCalendarInvalidationToUsers: publishMock,
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    $executeRaw: executeRawMock,
    $queryRaw: queryRawMock,
    calendarInvalidationOutbox: {
      deleteMany: deleteManyMock,
      findMany: findManyMock,
      findUnique: findUniqueMock,
      updateMany: updateManyMock,
    },
    project: { updateMany: projectUpdateManyMock },
    workspace: {
      findUnique: workspaceFindUniqueMock,
      updateMany: workspaceUpdateManyMock,
    },
  };
  transactionMock.mockImplementation(
    async (operation: (tx: typeof client) => unknown) => operation(client),
  );
  return { default: { ...client, $transaction: transactionMock } };
});

const OUTBOX_ROW = {
  id: "11111111-1111-7111-8111-111111111111",
  workspaceId: "22222222-2222-7222-8222-222222222222",
  projectId: "33333333-3333-7333-8333-333333333333",
  calendarRevision: 7,
  attempts: 1,
  publishedAt: null,
  payload: {
    kind: "task_changed",
    projectIds: ["33333333-3333-7333-8333-333333333333"],
  },
};

const WORKSPACE = {
  userId: null,
  organization: {
    members: [{ userId: "user-1" }, { userId: "user-2" }],
  },
};

describe("calendarInvalidationOutboxService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelNotificationEmailsMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([{ id: OUTBOX_ROW.id, attempts: 0 }]);
    findUniqueMock.mockResolvedValue(OUTBOX_ROW);
    workspaceFindUniqueMock.mockResolvedValue(WORKSPACE);
    deleteManyMock.mockResolvedValue({ count: 1 });
    updateManyMock.mockResolvedValue({ count: 1 });
    executeRawMock.mockResolvedValue(0);
    queryRawMock.mockResolvedValue([{ id: OUTBOX_ROW.id }]);
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
    workspaceUpdateManyMock.mockResolvedValue({ count: 1 });
    publishMock.mockResolvedValue(undefined);
    publishAccessRevokedMock.mockResolvedValue(undefined);
  });

  it("cancels departed members' scheduled emails without exposing provider IDs", async () => {
    findUniqueMock.mockResolvedValue({
      ...OUTBOX_ROW,
      payload: {
        kind: "calendar_access_revoked",
        userId: "departed-user",
        organizationId: "org-1",
        pendingNotificationEmails: [
          {
            id: "n1",
            emailId: "e1",
            emailScheduledAt: "2026-09-21T20:00:00.000Z",
          },
        ],
      },
    });
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );
    await calendarInvalidationOutboxService.syncInvalidations({
      shouldContinue: () => true,
      maxBatches: 1,
    });
    expect(cancelNotificationEmailsMock).toHaveBeenCalledWith(
      [
        {
          id: "n1",
          emailId: "e1",
          emailScheduledAt: new Date("2026-09-21T20:00:00.000Z"),
        },
      ],
      { retryOnFailure: true },
    );
    expect(
      publishMock.mock.calls[0]?.[0].invalidation.payload,
    ).not.toHaveProperty("pendingNotificationEmails");
  });

  it("keeps revocations retryable when email cancellation fails", async () => {
    findUniqueMock.mockResolvedValue({
      ...OUTBOX_ROW,
      payload: {
        kind: "calendar_access_revoked",
        userId: "departed-user",
        organizationId: "org-1",
      },
    });
    cancelNotificationEmailsMock.mockRejectedValue(
      new Error("provider unavailable"),
    );
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );
    const result = await calendarInvalidationOutboxService.syncInvalidations({
      shouldContinue: () => true,
      maxBatches: 1,
    });
    expect(result.failed).toBe(1);
    expect(publishAccessRevokedMock).toHaveBeenCalled();
  });

  it("signals a departed member on the always-owned control channel", async () => {
    findUniqueMock.mockResolvedValue({
      ...OUTBOX_ROW,
      projectId: null,
      payload: {
        kind: "calendar_access_revoked",
        userId: "departed-user",
        organizationId: "org-1",
      },
    });
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await calendarInvalidationOutboxService.syncInvalidations({
      shouldContinue: () => true,
    });

    expect(publishAccessRevokedMock).toHaveBeenCalledWith({
      userId: "departed-user",
      organizationId: "org-1",
      workspaceId: OUTBOX_ROW.workspaceId,
    });
  });

  it("claims and publishes a committed invalidation to current members", async () => {
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await expect(
      calendarInvalidationOutboxService.syncInvalidations({
        shouldContinue: () => true,
      }),
    ).resolves.toEqual({ claimed: 1, published: 1, failed: 0 });

    expect(updateManyMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          id: OUTBOX_ROW.id,
          attempts: 0,
          publishedAt: null,
          nextAttemptAt: { lte: expect.any(Date) },
        }),
      }),
    );
    expect(publishMock).toHaveBeenCalledWith({
      userIds: ["user-1", "user-2"],
      workspaceId: OUTBOX_ROW.workspaceId,
      invalidation: expect.objectContaining({
        id: OUTBOX_ROW.id,
        calendarRevision: 7,
      }),
    });
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(executeRawMock).toHaveBeenCalledTimes(2);
    expect(workspaceUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: OUTBOX_ROW.workspaceId,
        calendarRevision: { lt: OUTBOX_ROW.calendarRevision },
      },
      data: { calendarRevision: OUTBOX_ROW.calendarRevision },
    });
    expect(projectUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: [OUTBOX_ROW.projectId] },
        workspaceId: OUTBOX_ROW.workspaceId,
        calendarRevision: { lt: OUTBOX_ROW.calendarRevision },
      },
      data: { calendarRevision: OUTBOX_ROW.calendarRevision },
    });
    expect(updateManyMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: {
          id: OUTBOX_ROW.id,
          attempts: 1,
          publishedAt: null,
        },
        data: expect.objectContaining({ publishedAt: expect.any(Date) }),
      }),
    );
  });

  it("can restrict a low-latency delivery pass to one workspace", async () => {
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await calendarInvalidationOutboxService.syncInvalidations({
      newestFirst: true,
      shouldContinue: () => true,
      workspaceId: OUTBOX_ROW.workspaceId,
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: OUTBOX_ROW.workspaceId,
        }),
        orderBy: [{ calendarRevision: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("can target one former member's durable revocation", async () => {
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await calendarInvalidationOutboxService.syncInvalidations({
      maxBatches: 1,
      newestFirst: true,
      revokedUserId: "departed-user",
      shouldContinue: () => true,
      workspaceId: OUTBOX_ROW.workspaceId,
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              payload: {
                path: ["kind"],
                equals: "calendar_access_revoked",
              },
            },
            {
              payload: { path: ["userId"], equals: "departed-user" },
            },
          ],
        }),
      }),
    );
  });

  it("drains every due batch in one run", async () => {
    const candidates = Array.from({ length: 25 }, (_, index) => ({
      id: `00000000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      attempts: 0,
    }));
    findManyMock.mockResolvedValueOnce(candidates).mockResolvedValueOnce([]);
    findUniqueMock.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ ...OUTBOX_ROW, id: where.id }),
    );
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await expect(
      calendarInvalidationOutboxService.syncInvalidations({
        shouldContinue: () => true,
      }),
    ).resolves.toEqual({ claimed: 25, published: 25, failed: 0 });

    expect(findManyMock).toHaveBeenCalledTimes(2);
  });

  it("can bound immediate delivery to one batch", async () => {
    const candidates = Array.from({ length: 25 }, (_, index) => ({
      id: `00000000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      attempts: 0,
    }));
    findManyMock.mockResolvedValue(candidates);
    findUniqueMock.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ ...OUTBOX_ROW, id: where.id }),
    );
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await expect(
      calendarInvalidationOutboxService.syncInvalidations({
        maxBatches: 1,
        shouldContinue: () => true,
      }),
    ).resolves.toEqual({ claimed: 25, published: 25, failed: 0 });

    expect(findManyMock).toHaveBeenCalledOnce();
  });

  it("discards an invalidation after its workspace is deleted", async () => {
    workspaceFindUniqueMock.mockResolvedValue(null);
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await expect(
      calendarInvalidationOutboxService.syncInvalidations({
        shouldContinue: () => true,
      }),
    ).resolves.toEqual({ claimed: 1, published: 0, failed: 0 });

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { id: OUTBOX_ROW.id, attempts: 1 },
    });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("does not revoke Calendar access after the user has rejoined", async () => {
    findUniqueMock.mockResolvedValue({
      ...OUTBOX_ROW,
      projectId: null,
      payload: {
        kind: "calendar_access_revoked",
        userId: "user-1",
        organizationId: "org-1",
      },
    });
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await calendarInvalidationOutboxService.syncInvalidations({
      shouldContinue: () => true,
    });

    expect(publishAccessRevokedMock).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledOnce();
  });

  it("does not publish after another worker supersedes the claim", async () => {
    queryRawMock.mockResolvedValue([]);
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await calendarInvalidationOutboxService.syncInvalidations({
      shouldContinue: () => true,
    });

    expect(publishMock).not.toHaveBeenCalled();
    expect(publishAccessRevokedMock).not.toHaveBeenCalled();
  });

  it("retries a failed publish without marking the row published", async () => {
    publishMock.mockRejectedValue(new Error("Ably unavailable"));
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await expect(
      calendarInvalidationOutboxService.syncInvalidations({
        shouldContinue: () => true,
      }),
    ).resolves.toEqual({ claimed: 1, published: 0, failed: 1 });

    expect(updateManyMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: {
          id: OUTBOX_ROW.id,
          attempts: 1,
          publishedAt: null,
        },
        data: expect.objectContaining({
          nextAttemptAt: expect.any(Date),
          lastError: "Ably unavailable",
        }),
      }),
    );
  });

  it("stops before claiming when the execution budget is exhausted", async () => {
    const { calendarInvalidationOutboxService } = await import(
      "./calendar-invalidation-outbox.service"
    );

    await expect(
      calendarInvalidationOutboxService.syncInvalidations({
        shouldContinue: () => false,
      }),
    ).resolves.toEqual({ claimed: 0, published: 0, failed: 0 });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });
});
