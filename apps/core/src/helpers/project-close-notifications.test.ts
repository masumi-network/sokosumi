import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  createNotificationMock,
  projectEventFindUniqueMock,
  projectEventUpdateManyMock,
  queryRawMock,
  workspaceFindFirstMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  createNotificationMock: vi.fn(),
  projectEventFindUniqueMock: vi.fn(),
  projectEventUpdateManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  workspaceFindFirstMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({ captureException: captureExceptionMock }));
vi.mock("./notifications.js", () => ({
  createNotification: createNotificationMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: queryRawMock,
    projectEvent: {
      findUnique: projectEventFindUniqueMock,
      updateMany: projectEventUpdateManyMock,
    },
    workspace: { findFirst: workspaceFindFirstMock },
  },
}));

import {
  notifyProjectCloseTransition,
  retryMissingProjectCloseNotifications,
} from "./project-close-notifications";

const EVENT_ID = "33333333-3333-7333-8333-333333333333";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const ACTOR_ID = "user_123";

function projectEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: EVENT_ID,
    kind: "CLOSE_FINALIZED",
    notificationHandledAt: null,
    payload: { completedAt: "2026-09-14T10:00:00.000Z" },
    closeOperation: { actorUserId: ACTOR_ID },
    project: {
      id: PROJECT_ID,
      name: "Launch",
      workspaceId: WORKSPACE_ID,
    },
    ...overrides,
  };
}

describe("notifyProjectCloseTransition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectEventFindUniqueMock.mockResolvedValue(projectEvent());
    queryRawMock.mockResolvedValue([]);
    workspaceFindFirstMock.mockResolvedValue({ id: WORKSPACE_ID });
    createNotificationMock.mockResolvedValue({ created: true });
    projectEventUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("notifies the original close actor for a finalized Project", async () => {
    await notifyProjectCloseTransition(EVENT_ID);

    expect(workspaceFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: WORKSPACE_ID,
        OR: [
          { userId: ACTOR_ID },
          {
            organization: {
              members: { some: { userId: ACTOR_ID } },
            },
          },
        ],
      },
      select: { id: true },
    });
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: ACTOR_ID,
      workspaceId: WORKSPACE_ID,
      kind: "PROJECT",
      referenceId: PROJECT_ID,
      eventId: EVENT_ID,
      messageKey: "Notifications.Project.closed",
      messageParams: { projectName: "Launch" },
      metadata: { workspaceId: WORKSPACE_ID },
    });
    expect(projectEventUpdateManyMock).toHaveBeenCalledWith({
      where: { id: EVENT_ID, notificationHandledAt: null },
      data: { notificationHandledAt: expect.any(Date) },
    });
  });

  it("notifies only for a terminal close failure", async () => {
    projectEventFindUniqueMock.mockResolvedValue(
      projectEvent({
        kind: "BATCH_FAILED",
        payload: { attempts: 3, failed: true },
      }),
    );

    await notifyProjectCloseTransition(EVENT_ID);

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        messageKey: "Notifications.Project.closeFailed",
      }),
    );

    vi.clearAllMocks();
    projectEventFindUniqueMock.mockResolvedValue(
      projectEvent({
        kind: "BATCH_FAILED",
        payload: { attempts: 1, failed: false },
      }),
    );
    await notifyProjectCloseTransition(EVENT_ID);
    expect(workspaceFindFirstMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("suppresses an erased actor", async () => {
    projectEventFindUniqueMock.mockResolvedValue(
      projectEvent({ closeOperation: { actorUserId: null } }),
    );

    await notifyProjectCloseTransition(EVENT_ID);

    expect(workspaceFindFirstMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("suppresses an actor whose workspace access was revoked", async () => {
    workspaceFindFirstMock.mockResolvedValue(null);

    await notifyProjectCloseTransition(EVENT_ID);

    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(projectEventUpdateManyMock).toHaveBeenCalledOnce();
  });

  it("does not recreate a notification after its durable attempt was handled", async () => {
    projectEventFindUniqueMock.mockResolvedValue(
      projectEvent({ notificationHandledAt: new Date() }),
    );

    await notifyProjectCloseTransition(EVENT_ID);

    expect(workspaceFindFirstMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(projectEventUpdateManyMock).not.toHaveBeenCalled();
  });

  it("contains dispatch failures without failing the close worker", async () => {
    createNotificationMock.mockRejectedValue(new Error("notification failed"));

    await expect(
      notifyProjectCloseTransition(EVENT_ID),
    ).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ eventId: EVENT_ID }),
      }),
    );
  });

  it("retries terminal events whose notification is missing", async () => {
    queryRawMock.mockResolvedValue([{ id: EVENT_ID }]);

    await retryMissingProjectCloseNotifications();

    expect(projectEventFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EVENT_ID } }),
    );
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_ID }),
    );
  });

  it("stops retrying when the worker budget is exhausted", async () => {
    queryRawMock.mockResolvedValue([{ id: EVENT_ID }]);

    await retryMissingProjectCloseNotifications({
      deadlineMs: Date.now() - 1,
      shouldContinue: () => true,
    });

    expect(projectEventFindUniqueMock).not.toHaveBeenCalled();
  });
});
