import { NotificationKind } from "@sokosumi/database";
import {
  buildChatMessagePreview,
  CHAT_MESSAGE_PREVIEW_MAX_LENGTH,
  SokosumiJobStatus,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_PUSH_PARAM_LENGTH,
  publishChatMembershipRevoked,
  publishChatMembershipRevokedToUsers,
  publishChatRoomMessageEvent,
  publishChatRoomsChanged,
  publishJobStatusData,
  publishNotificationEvent,
  publishTaskEventData,
} from "./publish";

const { envMock, publishMock, batchPublishMock, getMock, getRestClientMock } =
  vi.hoisted(() => ({
    envMock: {
      NETWORK: "Mainnet",
      VERCEL_ENV: "production" as "production" | "preview",
      VERCEL_GIT_COMMIT_REF: "main" as string | undefined,
    },
    publishMock: vi.fn(),
    batchPublishMock: vi.fn(),
    getMock: vi.fn(),
    getRestClientMock: vi.fn(),
  }));

vi.mock("@/config/env", () => ({ getEnv: () => envMock }));

vi.mock("./client", () => ({
  getRestClient: () => getRestClientMock(),
}));

getRestClientMock.mockImplementation(() => ({
  batchPublish: batchPublishMock,
  channels: {
    get: (...args: unknown[]) => {
      getMock(...args);
      return { publish: publishMock };
    },
  },
}));

describe("publishTaskEventData", () => {
  it("publishes task event data to the user channel", async () => {
    await publishTaskEventData({
      userId: "user_123",
      taskId: "tsk_123",
      eventType: "task_event",
    });

    expect(getMock).toHaveBeenCalledWith("tasks:all:user_user_123");
    expect(publishMock).toHaveBeenCalledWith("task_event", {
      taskId: "tsk_123",
      eventType: "task_event",
    });
  });
});

describe("publishJobStatusData", () => {
  it("publishes job status data to the agent-user channel", async () => {
    await publishJobStatusData({
      agentId: "agent_123",
      userId: "user_123",
      jobId: "job_123",
      jobStatus: SokosumiJobStatus.PROCESSING,
      jobStatusSettled: false,
    });

    expect(getMock).toHaveBeenCalledWith(
      "agent_jobs:agent_agent_123:user_user_123",
    );
    expect(publishMock).toHaveBeenCalledWith("job_status_data", {
      jobId: "job_123",
      jobStatus: SokosumiJobStatus.PROCESSING,
      jobStatusSettled: false,
    });
  });
});

describe("publishNotificationEvent", () => {
  const notification = {
    id: "notif_123",
    userId: "user_123",
    kind: NotificationKind.JOB,
    referenceId: "job_123",
    eventId: "event_123",
    messageKey: "Notifications.Job.completed",
    messageParams: { agentName: "Test Agent", jobName: "Test Job" },
    metadata: { agentId: "agent_123" },
    isRead: false,
    readAt: null,
    createdAt: "2026-06-17T12:00:00.000Z",
    inApp: true,
    osBanner: false,
    created: true,
  };

  beforeEach(() => {
    // getMock is shared file-wide: clear it too, so the channel-name assertion
    // cannot pass on a stale call from a test declared above this block.
    publishMock.mockClear();
    getMock.mockClear();
    getRestClientMock.mockClear();
    envMock.NETWORK = "Mainnet";
    envMock.VERCEL_ENV = "production";
    envMock.VERCEL_GIT_COMMIT_REF = "main";
  });

  it("publishes notification event to the user channel", async () => {
    await publishNotificationEvent({
      userId: "user_123",
      notification,
    });

    expect(getMock).toHaveBeenCalledWith("notifications:all:user_user_123");
    expect(publishMock).toHaveBeenCalledWith({
      name: "notification_created",
      data: notification,
    });
  });

  it("publishes a preview notification only to its branch channel", async () => {
    envMock.VERCEL_ENV = "preview";
    envMock.VERCEL_GIT_COMMIT_REF = "fix/push-urls";

    await publishNotificationEvent({
      userId: "user_123",
      notification,
      push: true,
    });

    expect(getMock).toHaveBeenCalledWith(
      "notifications:preview:mainnet:branch_fix%2Fpush-urls:user_user_123",
    );
  });

  it("carries no push extras unless push is requested", async () => {
    await publishNotificationEvent({
      userId: "user_123",
      notification,
      push: false,
    });

    expect(publishMock).toHaveBeenCalledWith({
      name: "notification_created",
      data: notification,
    });
  });

  it("attaches a data-only push payload when push is requested", async () => {
    await publishNotificationEvent({
      userId: "user_123",
      notification,
      push: true,
    });

    expect(publishMock).toHaveBeenCalledWith({
      name: "notification_created",
      data: notification,
      extras: {
        push: {
          data: {
            id: notification.id,
            kind: notification.kind,
            referenceId: notification.referenceId,
            messageKey: notification.messageKey,
            createdAt: notification.createdAt,
            messageParams: JSON.stringify(notification.messageParams),
            metadata: JSON.stringify(notification.metadata),
          },
        },
      },
    });
    // ADR-0023: the service worker renders text, so Core ships no display part.
    //
    // The part must be absent, not empty. Ably defines `notification` as
    // title, body, icon, sound and collapseKey, so a `notification` holding
    // only a `ttl` carries no field Ably reads. An earlier revision sent
    // exactly that, and this guard keeps it from coming back.
    //
    // It was removed as undefined input, not as a proven delivery failure.
    // The silence that prompted the change was macOS: it suppresses banners
    // while the display is shared, and files them into Notification Centre
    // instead. Push delivery itself was working the whole time.
    expect(publishMock.mock.calls[0]?.[0]?.extras?.push).not.toHaveProperty(
      "notification",
    );
  });

  it("keeps every push data value a string", async () => {
    // Ably documents push data as a string-to-string map and FCM rejects
    // nested JSON, so no value may be an object, array, number, or null.
    await publishNotificationEvent({
      userId: "user_123",
      notification,
      push: true,
    });

    const pushData = publishMock.mock.calls[0]?.[0]?.extras?.push?.data as
      | Record<string, unknown>
      | undefined;

    expect(pushData).toBeDefined();
    expect(Object.keys(pushData ?? {})).toHaveLength(7);
    for (const value of Object.values(pushData ?? {})) {
      expect(typeof value).toBe("string");
    }
  });

  /**
   * A display name has no server-side length limit, and the whole push payload
   * rides a 4 KB Web Push ceiling. Without a cap, one account with a very long
   * name would silence the banner for everyone it messages.
   */
  it("caps a long push parameter so one name cannot break the payload", async () => {
    const longName = "a".repeat(500);
    await publishNotificationEvent({
      userId: "user_123",
      notification: {
        ...notification,
        messageParams: { authorName: longName, roomName: "General" },
      },
      push: true,
    });

    const pushData = publishMock.mock.calls[0]?.[0]?.extras?.push?.data as
      | Record<string, string>
      | undefined;
    const params = JSON.parse(pushData?.messageParams ?? "{}") as {
      authorName: string;
      roomName: string;
    };

    expect(params.authorName).toBe("a".repeat(128));
    // Everything else rides through untouched, and the document still parses.
    expect(params.roomName).toBe("General");
  });

  /** A cut inside a surrogate pair would send a lone half to the worker. */
  it("cuts a long parameter on a codepoint, not a code unit", async () => {
    await publishNotificationEvent({
      userId: "user_123",
      notification: {
        ...notification,
        messageParams: { authorName: "\u{1F600}".repeat(200) },
      },
      push: true,
    });

    const pushData = publishMock.mock.calls[0]?.[0]?.extras?.push?.data as
      | Record<string, string>
      | undefined;
    const params = JSON.parse(pushData?.messageParams ?? "{}") as {
      authorName: string;
    };

    expect([...params.authorName]).toHaveLength(128);
    expect(params.authorName).toBe("\u{1F600}".repeat(128));
  });

  /**
   * The preview is cut where it is built, so that the reader gets an ellipsis
   * saying the message goes on. Cutting it again here would eat that mark and
   * leave a push that reads as the whole message.
   */
  it("carries a preview of the greatest allowed length whole", async () => {
    const preview = buildChatMessagePreview("a".repeat(500));

    await publishNotificationEvent({
      userId: "user_123",
      notification: {
        ...notification,
        messageParams: { authorName: "Ada", messagePreview: preview },
      },
      push: true,
    });

    const pushData = publishMock.mock.calls[0]?.[0]?.extras?.push?.data as
      | Record<string, string>
      | undefined;
    const params = JSON.parse(pushData?.messageParams ?? "{}") as {
      messagePreview: string;
    };

    expect([...preview]).toHaveLength(CHAT_MESSAGE_PREVIEW_MAX_LENGTH);
    expect(params.messagePreview).toBe(preview);
  });

  /**
   * The two caps live in two packages with nothing to hold them together. The
   * preview is cut to its own length and then never cut again, which is only
   * true while the two are equal.
   */
  it("cuts the preview at the same length this cap allows", () => {
    expect(CHAT_MESSAGE_PREVIEW_MAX_LENGTH).toBe(MAX_PUSH_PARAM_LENGTH);
  });

  it("omits metadata rather than sending null when there is none", async () => {
    await publishNotificationEvent({
      userId: "user_123",
      notification: { ...notification, metadata: null },
      push: true,
    });

    const pushData = publishMock.mock.calls[0]?.[0]?.extras?.push?.data as
      | Record<string, unknown>
      | undefined;

    expect(pushData).not.toHaveProperty("metadata");
    expect(pushData?.messageParams).toBe(
      JSON.stringify(notification.messageParams),
    );
  });
});

describe("publishChatRoomMessageEvent", () => {
  it("publishes chat room message event to the room channel", async () => {
    const message = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      content: "hello",
      createdAt: "2026-08-03T12:00:00.000Z",
      deletedAt: null,
      editedAt: null,
      sender: {
        type: "user" as const,
        user: {
          id: "user_123",
          name: "Alice",
          email: "alice@example.com",
          image: null,
          presence: "online" as const,
        },
      },
      mentions: [],
      reactions: [],
      threadReplyCount: 0,
      threadLastReplyAt: null,
      metadata: null,
      quote: null,
      membership: null,
      unfurls: null,
    };

    await publishChatRoomMessageEvent({
      eventType: "create",
      message,
    });

    expect(getMock).toHaveBeenCalledWith(
      "chat_rooms:room_660e8400-e29b-41d4-a716-446655440000",
    );
    expect(publishMock).toHaveBeenCalledWith("chat_room_message", {
      eventType: "create",
      message,
    });
  });

  it("publishes an id envelope when the full create exceeds Ably maxMessageSize", async () => {
    publishMock.mockClear();
    const message = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null as string | null,
      content: "x".repeat(70_000),
      createdAt: "2026-08-03T12:00:00.000Z",
      deletedAt: null,
      editedAt: null,
      sender: {
        type: "coworker" as const,
        coworker: {
          id: "cow_123",
          name: "Hermes",
          slug: "hermes",
          caption: null,
          image: null,
          presence: "online" as const,
        },
      },
      mentions: [],
      reactions: [],
      threadReplyCount: 0,
      threadLastReplyAt: null,
      metadata: {
        reasoning: [{ type: "reasoning", text: "y".repeat(400) }],
      },
      quote: null,
      membership: null,
      unfurls: null,
    };

    await publishChatRoomMessageEvent({
      eventType: "create",
      message,
    });

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith("chat_room_message", {
      eventType: "create",
      messageId: message.id,
      roomId: message.roomId,
      parentMessageId: null,
    });
  });

  it("publishes a patch envelope for reaction events on the room channel", async () => {
    const patch = {
      reactions: [
        {
          emoji: "👍",
          count: 1,
          reactedByCurrentUser: false,
          reactors: [{ id: "user_123", name: "Alice" }],
        },
      ],
    };

    await publishChatRoomMessageEvent({
      eventType: "reaction",
      messageId: "550e8400-e29b-41d4-a716-446655440000",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      patch,
    });

    expect(getMock).toHaveBeenCalledWith(
      "chat_rooms:room_660e8400-e29b-41d4-a716-446655440000",
    );
    expect(publishMock).toHaveBeenCalledWith("chat_room_message", {
      eventType: "reaction",
      messageId: "550e8400-e29b-41d4-a716-446655440000",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
      patch,
    });
  });
});

describe("publishChatMembershipRevoked", () => {
  it("publishes revoke on the user chat control channel", async () => {
    await publishChatMembershipRevoked({
      userId: "user_123",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      reason: "removed",
    });

    expect(getMock).toHaveBeenCalledWith("chat_control:user_user_123");
    expect(publishMock).toHaveBeenCalledWith(
      "chat_membership_revoked",
      expect.objectContaining({
        roomId: "660e8400-e29b-41d4-a716-446655440000",
        reason: "removed",
        at: expect.any(String),
      }),
    );
  });

  it("no-ops when fan-out user list is empty", async () => {
    publishMock.mockClear();
    getMock.mockClear();
    await publishChatMembershipRevokedToUsers(
      "660e8400-e29b-41d4-a716-446655440000",
      [],
      "removed",
    );
    expect(publishMock).not.toHaveBeenCalled();
  });
});

describe("publishChatRoomsChanged", () => {
  beforeEach(() => {
    batchPublishMock
      .mockReset()
      .mockResolvedValue({ successCount: 1, failureCount: 0, results: [] });
  });

  it("batches distinct control channels with the unchanged event payload", async () => {
    await publishChatRoomsChanged({
      userIds: ["a", "b", "a"],
      collections: ["active", "archived"],
      roomId: "room",
    });
    expect(batchPublishMock).toHaveBeenCalledExactlyOnceWith({
      channels: ["chat_control:user_a", "chat_control:user_b"],
      messages: [
        {
          name: "chat_rooms_changed",
          data: {
            collections: ["active", "archived"],
            roomId: "room",
            at: expect.any(String),
          },
        },
      ],
    });
  });

  it("splits audiences at Ably's 100-channel limit", async () => {
    await publishChatRoomsChanged({
      userIds: Array.from({ length: 201 }, (_, i) => String(i)),
      collections: ["active"],
      roomId: null,
    });
    expect(
      batchPublishMock.mock.calls.map(([spec]) => spec.channels.length),
    ).toEqual([100, 100, 1]);
    expect(
      batchPublishMock.mock.calls.flatMap(([spec]) => spec.channels),
    ).toEqual(Array.from({ length: 201 }, (_, i) => `chat_control:user_${i}`));
  });

  it("logs per-channel failures without replaying successful channels", async () => {
    const error = new Error("denied");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    batchPublishMock.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 1,
      results: [
        { channel: "chat_control:user_a", messageId: "id" },
        { channel: "chat_control:user_b", error },
      ],
    });
    await publishChatRoomsChanged({
      userIds: ["a", "b"],
      collections: ["active"],
      roomId: null,
    });
    expect(batchPublishMock).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "Failed to publish chat rooms changed to channel",
      "chat_control:user_b",
      error,
    );
    log.mockRestore();
  });

  it("attempts remaining batches when one request rejects", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    batchPublishMock.mockRejectedValueOnce(new Error("unavailable"));
    await expect(
      publishChatRoomsChanged({
        userIds: Array.from({ length: 101 }, (_, i) => String(i)),
        collections: ["active"],
        roomId: null,
      }),
    ).resolves.toBeUndefined();
    expect(batchPublishMock).toHaveBeenCalledTimes(2);
    expect(batchPublishMock).toHaveBeenNthCalledWith(2, {
      channels: ["chat_control:user_100"],
      messages: [
        {
          name: "chat_rooms_changed",
          data: {
            collections: ["active"],
            roomId: null,
            at: expect.any(String),
          },
        },
      ],
    });
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("does not publish for an empty audience", async () => {
    await publishChatRoomsChanged({
      userIds: [],
      collections: ["active"],
      roomId: null,
    });
    expect(batchPublishMock).not.toHaveBeenCalled();
  });

  it("does not throw when the rest client cannot be created", async () => {
    getRestClientMock.mockImplementationOnce(() => {
      throw new Error("no ably");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      publishChatRoomsChanged({
        userIds: ["a"],
        collections: ["active"],
        roomId: null,
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
