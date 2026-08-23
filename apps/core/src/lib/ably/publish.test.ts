import { NotificationKind } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

import {
  ABLY_MAX_MESSAGE_SIZE,
  ablyPublishSize,
  CHAT_ROOM_MESSAGE_EVENT_NAME,
} from "./ably-message-size";
import {
  publishChatMembershipRevoked,
  publishChatMembershipRevokedToUsers,
  publishChatRoomMessageEvent,
  publishJobStatusData,
  publishNotificationEvent,
  publishTaskEventData,
} from "./publish";

const { publishMock, getMock } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock("./client", () => ({
  getRestClient: () => ({
    channels: {
      get: (...args: unknown[]) => {
        getMock(...args);
        return { publish: publishMock };
      },
    },
  }),
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
  it("publishes notification event to the user channel", async () => {
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
    };

    await publishNotificationEvent({
      userId: "user_123",
      notification,
    });

    expect(getMock).toHaveBeenCalledWith("notifications:all:user_user_123");
    expect(publishMock).toHaveBeenCalledWith(
      "notification_created",
      notification,
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

  it("slims an oversized full create so the Ably payload fits maxMessageSize", async () => {
    publishMock.mockClear();
    const message = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      roomId: "660e8400-e29b-41d4-a716-446655440000",
      parentMessageId: null,
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
        reasoning: [{ type: "reasoning", text: "y".repeat(1000) }],
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
    const [eventName, body] = publishMock.mock.calls[0] as [string, unknown];
    expect(eventName).toBe(CHAT_ROOM_MESSAGE_EVENT_NAME);
    expect(ablyPublishSize(eventName, body)).toBeLessThanOrEqual(
      ABLY_MAX_MESSAGE_SIZE,
    );
    expect(body).toEqual(
      expect.objectContaining({
        eventType: "create",
        message: expect.objectContaining({
          id: message.id,
          roomId: message.roomId,
        }),
      }),
    );
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
