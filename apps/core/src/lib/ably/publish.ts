import { NotificationKind } from "@sokosumi/database";
import {
  type ChatRoomMessageEventType,
  makeAgentJobsChannelName,
  makeChatRoomChannelName,
  makeUserNotificationsChannelName,
  makeUserTasksChannelName,
  SokosumiJobStatus,
} from "@sokosumi/utils";

import type { ChatRoomMessage } from "@/schemas/chat-room.schema";

import { getRestClient } from "./client";

interface JobStatusData {
  jobId: string;
  jobStatus: SokosumiJobStatus;
  jobStatusSettled: boolean;
}

interface PublishJobStatusDataInput extends JobStatusData {
  agentId: string;
  userId: string;
}

interface TaskEventData {
  taskId: string;
  eventType: "task_event";
}

interface PublishTaskEventDataInput extends TaskEventData {
  userId: string;
}

interface NotificationEventData {
  id: string;
  userId: string;
  kind: NotificationKind;
  referenceId: string;
  eventId: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

interface PublishNotificationEventInput {
  userId: string;
  notification: NotificationEventData;
}

export async function publishTaskEventData({
  userId,
  taskId,
}: PublishTaskEventDataInput) {
  const client = getRestClient();
  const channel = client.channels.get(makeUserTasksChannelName(userId));
  await channel.publish("task_event", {
    taskId,
    eventType: "task_event",
  });
}

export async function publishJobStatusData({
  agentId,
  userId,
  jobId,
  jobStatus,
  jobStatusSettled,
}: PublishJobStatusDataInput) {
  const client = getRestClient();
  const channel = client.channels.get(
    makeAgentJobsChannelName(agentId, userId),
  );
  await channel.publish("job_status_data", {
    jobId,
    jobStatus,
    jobStatusSettled,
  });
}

export async function publishNotificationEvent({
  userId,
  notification,
}: PublishNotificationEventInput) {
  const client = getRestClient();
  const channel = client.channels.get(makeUserNotificationsChannelName(userId));
  await channel.publish("notification_created", notification);
}

/** Full DTO body for create / update / delete. */
export type ChatRoomMessageFullEventType = Extract<
  ChatRoomMessageEventType,
  "create" | "update" | "delete"
>;

/** Patch body for high-chatter slices (SOK-737). */
export type ChatRoomMessagePatchEventType = Extract<
  ChatRoomMessageEventType,
  "reaction" | "unfurl" | "mention_status"
>;

export type ChatRoomMessageReactionPatch = {
  reactions: ChatRoomMessage["reactions"];
};

export type ChatRoomMessageUnfurlPatch = {
  unfurls: ChatRoomMessage["unfurls"];
};

export type ChatRoomMessageMentionStatusPatch = {
  mentions: ChatRoomMessage["mentions"];
};

export type ChatRoomMessageEventPatch =
  | ChatRoomMessageReactionPatch
  | ChatRoomMessageUnfurlPatch
  | ChatRoomMessageMentionStatusPatch;

interface PublishChatRoomMessageFullEventInput {
  eventType: ChatRoomMessageFullEventType;
  message: ChatRoomMessage;
}

interface PublishChatRoomMessagePatchEventInput {
  eventType: ChatRoomMessagePatchEventType;
  messageId: string;
  roomId: string;
  parentMessageId: string | null;
  patch: ChatRoomMessageEventPatch;
}

export type PublishChatRoomMessageEventInput =
  | PublishChatRoomMessageFullEventInput
  | PublishChatRoomMessagePatchEventInput;

function isPatchEventInput(
  input: PublishChatRoomMessageEventInput,
): input is PublishChatRoomMessagePatchEventInput {
  return (
    input.eventType === "reaction" ||
    input.eventType === "unfurl" ||
    input.eventType === "mention_status"
  );
}

export async function publishChatRoomMessageEvent(
  input: PublishChatRoomMessageEventInput,
) {
  const client = getRestClient();
  const roomId = isPatchEventInput(input) ? input.roomId : input.message.roomId;
  const channel = client.channels.get(makeChatRoomChannelName(roomId));

  if (isPatchEventInput(input)) {
    await channel.publish("chat_room_message", {
      eventType: input.eventType,
      messageId: input.messageId,
      roomId: input.roomId,
      parentMessageId: input.parentMessageId,
      patch: input.patch,
    });
    return;
  }

  await channel.publish("chat_room_message", {
    eventType: input.eventType,
    message: input.message,
  });
}
