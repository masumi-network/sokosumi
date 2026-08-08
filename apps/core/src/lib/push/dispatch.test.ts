import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  userFindUniqueMock,
  pushDeviceFindManyMock,
  pushDeviceDeleteManyMock,
  sendExpoPushMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  pushDeviceFindManyMock: vi.fn(),
  pushDeviceDeleteManyMock: vi.fn(),
  sendExpoPushMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    pushDevice: {
      findMany: pushDeviceFindManyMock,
      deleteMany: pushDeviceDeleteManyMock,
    },
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ EXPO_ACCESS_TOKEN: undefined }),
}));

vi.mock("@sentry/node", () => ({ captureException: captureExceptionMock }));

vi.mock("./expo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./expo")>();
  return { ...actual, sendExpoPush: sendExpoPushMock };
});

const { dispatchPushNotification } = await import("./dispatch");

/**
 * Injected explicitly, as `createNotification` does — the dispatcher runs on
 * the caller's client so it can take part in an open transaction.
 */
const prismaMock = {
  user: { findUnique: userFindUniqueMock },
  pushDevice: {
    findMany: pushDeviceFindManyMock,
    deleteMany: pushDeviceDeleteManyMock,
  },
} as unknown as Parameters<typeof dispatchPushNotification>[1];

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: "notif_123",
    userId: "user_123",
    kind: NotificationKind.JOB,
    referenceId: "job_123",
    eventId: "event_123",
    messageKey: "Notifications.Job.completed",
    messageParams: JSON.stringify({
      agentName: "Research Agent",
      jobName: "Market Analysis",
    }),
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-08-08T09:00:00.000Z"),
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindUniqueMock.mockResolvedValue({ notificationsOptIn: true });
  pushDeviceFindManyMock.mockResolvedValue([{ token: "tok_a" }]);
  sendExpoPushMock.mockResolvedValue([{ status: "ok" }]);
});

describe("dispatchPushNotification", () => {
  it("sends to every device the user registered", async () => {
    pushDeviceFindManyMock.mockResolvedValue([
      { token: "tok_a" },
      { token: "tok_b" },
    ]);
    sendExpoPushMock.mockResolvedValue([{ status: "ok" }, { status: "ok" }]);

    await dispatchPushNotification(notification(), prismaMock);

    const [messages] = sendExpoPushMock.mock.calls[0];
    expect(messages.map((m: { to: string }) => m.to)).toEqual([
      "tok_a",
      "tok_b",
    ]);
  });

  it("carries the key and params so a client can render its own copy", async () => {
    // The English body is a fallback; Core cannot localise it.
    await dispatchPushNotification(notification(), prismaMock);

    const [messages] = sendExpoPushMock.mock.calls[0];
    expect(messages[0].data).toMatchObject({
      notificationId: "notif_123",
      kind: NotificationKind.JOB,
      referenceId: "job_123",
      messageKey: "Notifications.Job.completed",
    });
  });

  it("respects the user opting out", async () => {
    userFindUniqueMock.mockResolvedValue({ notificationsOptIn: false });

    await dispatchPushNotification(notification(), prismaMock);

    expect(sendExpoPushMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a key it has no copy for", async () => {
    await dispatchPushNotification(
      notification({ messageKey: "Notifications.Some.newKey" }),
      prismaMock,
    );

    expect(sendExpoPushMock).not.toHaveBeenCalled();
    // Checked before the user lookup, so an unknown key costs no queries.
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("does nothing when no device is registered", async () => {
    pushDeviceFindManyMock.mockResolvedValue([]);

    await dispatchPushNotification(notification(), prismaMock);

    expect(sendExpoPushMock).not.toHaveBeenCalled();
  });

  it("reaps installs the provider says are gone", async () => {
    pushDeviceFindManyMock.mockResolvedValue([
      { token: "live" },
      { token: "gone" },
    ]);
    sendExpoPushMock.mockResolvedValue([
      { status: "ok" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    await dispatchPushNotification(notification(), prismaMock);

    expect(pushDeviceDeleteManyMock).toHaveBeenCalledWith({
      where: { token: { in: ["gone"] } },
    });
  });

  it("keeps a device whose send merely failed", async () => {
    sendExpoPushMock.mockResolvedValue([
      { status: "error", details: { error: "MessageRateExceeded" } },
    ]);

    await dispatchPushNotification(notification(), prismaMock);

    expect(pushDeviceDeleteManyMock).not.toHaveBeenCalled();
  });

  it("never lets a push failure reach the caller", async () => {
    // A notification that exists but did not reach a phone is degraded
    // delivery. One that was never written because a push provider was down is
    // lost work.
    sendExpoPushMock.mockRejectedValue(new Error("Expo is down"));

    await expect(
      dispatchPushNotification(notification(), prismaMock),
    ).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("survives a notification whose params are not valid JSON", async () => {
    await expect(
      dispatchPushNotification(
        notification({ messageParams: "{oops" }),
        prismaMock,
      ),
    ).resolves.toBeUndefined();
    expect(sendExpoPushMock).not.toHaveBeenCalled();
  });
});
