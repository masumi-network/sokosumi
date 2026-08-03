import { NotificationKind } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

import {
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
  it("publishes chat room message event to the user channel", async () => {
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
    };

    await publishChatRoomMessageEvent({
      userId: "user_123",
      message,
    });

    expect(getMock).toHaveBeenCalledWith("chat_rooms:all:user_user_123");
    expect(publishMock).toHaveBeenCalledWith("chat_room_message", { message });
  });
});
