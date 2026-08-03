import type { Notification, NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  pushSubscriptionFindManyMock,
  pushSubscriptionDeleteMock,
  sendNotificationMock,
  setVapidDetailsMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  pushSubscriptionFindManyMock: vi.fn(),
  pushSubscriptionDeleteMock: vi.fn(),
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    pushSubscription: {
      findMany: pushSubscriptionFindManyMock,
      delete: pushSubscriptionDeleteMock,
    },
  },
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    VAPID_PUBLIC_KEY: "BPtest-public-key-for-web-push-xxxxxxxxxxxxxxxxx",
    VAPID_PRIVATE_KEY: "test-private-key-for-web-push-xxxxxxxx",
    VAPID_SUBJECT: "mailto:noreply@sokosumi.test",
  }),
}));

import { sendPushForNotification } from "./push-notification";

const CREATED_AT = new Date("2026-06-18T09:00:00.000Z");

function createNotificationRecord(
  overrides: Partial<Notification> = {},
): Notification {
  return {
    id: "notification_123",
    userId: "user_123",
    kind: "JOB" as NotificationKind,
    referenceId: "job_123",
    eventId: "job_event_123",
    messageKey: "Notifications.Job.completed",
    messageParams: JSON.stringify({
      agentName: "Research Agent",
      jobName: "Market Analysis",
    }),
    metadata: JSON.stringify({ agentId: "agent_123" }),
    isRead: false,
    readAt: null,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe("sendPushForNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the subscription when web-push returns 410", async () => {
    pushSubscriptionFindManyMock.mockResolvedValue([
      {
        id: "sub_123",
        userId: "user_123",
        endpoint: "https://push.example/expired",
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
    ]);
    sendNotificationMock.mockRejectedValue(
      Object.assign(new Error("Gone"), { statusCode: 410 }),
    );
    pushSubscriptionDeleteMock.mockResolvedValue({ id: "sub_123" });

    await sendPushForNotification(createNotificationRecord());

    expect(pushSubscriptionDeleteMock).toHaveBeenCalledWith({
      where: { endpoint: "https://push.example/expired" },
    });
  });

  it("deletes the subscription when web-push returns 404", async () => {
    pushSubscriptionFindManyMock.mockResolvedValue([
      {
        id: "sub_456",
        userId: "user_123",
        endpoint: "https://push.example/missing",
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
    ]);
    sendNotificationMock.mockRejectedValue(
      Object.assign(new Error("Not Found"), { statusCode: 404 }),
    );
    pushSubscriptionDeleteMock.mockResolvedValue({ id: "sub_456" });

    await sendPushForNotification(createNotificationRecord());

    expect(pushSubscriptionDeleteMock).toHaveBeenCalledWith({
      where: { endpoint: "https://push.example/missing" },
    });
  });

  it("does not throw when send fails with a non-gone status", async () => {
    pushSubscriptionFindManyMock.mockResolvedValue([
      {
        id: "sub_789",
        userId: "user_123",
        endpoint: "https://push.example/fail",
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
    ]);
    sendNotificationMock.mockRejectedValue(
      Object.assign(new Error("Server Error"), { statusCode: 500 }),
    );

    await expect(
      sendPushForNotification(createNotificationRecord()),
    ).resolves.toBeUndefined();

    expect(pushSubscriptionDeleteMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("sends payload with tag, title, body, and url", async () => {
    pushSubscriptionFindManyMock.mockResolvedValue([
      {
        id: "sub_ok",
        userId: "user_123",
        endpoint: "https://push.example/ok",
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
    ]);
    sendNotificationMock.mockResolvedValue(undefined);

    await sendPushForNotification(createNotificationRecord());

    expect(sendNotificationMock).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example/ok",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      },
      JSON.stringify({
        tag: "notification_123",
        title: "Sokosumi",
        body: "Research Agent completed Market Analysis",
        url: "/agents/agent_123/jobs/job_123",
      }),
    );
  });
});
