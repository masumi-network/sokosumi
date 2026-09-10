import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
  CHAT_ROOMS_CHANGED_EVENT_NAME,
  type ChatMembershipRevokeReason,
  type ChatRoomCollection,
  type ChatRoomMessageEventType,
  makeAgentJobsChannelName,
  makeChatRoomChannelName,
  makeUserChatControlChannelName,
  makeUserNotificationsChannelName,
  makeUserTasksChannelName,
  SokosumiJobStatus,
} from "@sokosumi/utils";
import type { ChatRoomMessage } from "@/schemas/chat-room.schema";

import {
  CHAT_ROOM_MESSAGE_EVENT_NAME,
  type ChatRoomMessageFullEventType,
  chatRoomMessagePublishBody,
} from "./ably-message-size";
import { getRestClient } from "./client";
import { getNotificationChannelEnvironment } from "./notification-channel-environment";

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
  /**
   * Whether the app shows this at all: the Notification Center for a feed
   * kind, the in-app toast for a browser-only one. False when the reader
   * silenced its category in the app but still wants the OS banner, which is
   * why the event is published at all in that case.
   */
  inApp: boolean;
  /**
   * Whether this may interrupt with an OS banner. An open tab renders its own
   * banner from this event rather than waiting for the push, so it has to read
   * the same answer the push extras were gated on.
   */
  osBanner: boolean;
  /**
   * Whether the row was written by this event rather than changed by it.
   *
   * A room's messages are counted onto one row, so a reader's tab can be sent
   * a row that was already there. It counts a row it does not hold towards the
   * badge, which is right for a new row and one too many for this one.
   */
  created: boolean;
  /**
   * How many messages are waiting for the reader in this room.
   *
   * Chat only, and only on a row that is still unread. One OS banner holds a
   * whole room and each arrival replaces the one standing, so the banner says
   * how many it stands for; the push service worker can query nothing, so the
   * number has to arrive with the payload (ADR-0023).
   *
   * Absent on everything else, and the reader shows the single-message line.
   */
  groupCount?: number;
}

interface PublishNotificationEventInput {
  userId: string;
  notification: NotificationEventData;
  /** Also deliver as a closed-app OS banner (ADR-0022 channel-based push). */
  push?: boolean;
}

/**
 * The closed-app push payload the service worker receives. Data only, by
 * design: the worker renders title, body, and destination, so Core ships no
 * display strings (ADR-0023).
 *
 * Flat, and every value a string: Ably documents push `data` as a
 * string-to-string map, and FCM's HTTP v1 API rejects nested JSON outright.
 * The plain string fields stay tied to the event shape so the two cannot
 * drift; the two structured fields are JSON-encoded for the worker to parse.
 */
interface NotificationPushData
  extends Pick<
    NotificationEventData,
    "id" | "kind" | "referenceId" | "messageKey" | "createdAt"
  > {
  messageParams: string;
  /** Omitted, not null, when the notification carries no metadata. */
  metadata?: string;
  /** Decimal, because push data is a string-to-string map. Omitted when the
   * notification carries no count. */
  groupCount?: string;
}

/**
 * The longest string a single push parameter may carry.
 *
 * A display name has no server-side length limit: the 128 in the web form's
 * schema is client-side only, and the column is unbounded text. The whole push
 * payload rides a 4 KB Web Push ceiling, so one very long name would cost
 * every recipient of that account's messages their banner.
 *
 * The values are capped rather than the encoded string, because a truncated
 * JSON document does not parse and the worker would fall back to a generic
 * banner instead of a shortened name. `metadata` is left alone: it carries
 * ids Core generates, and truncating one would break routing silently.
 */
export const MAX_PUSH_PARAM_LENGTH = 128;

/** Codepoint-safe, so a cut never lands inside a surrogate pair. */
function capPushParamValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const codePoints = [...value];
  if (codePoints.length <= MAX_PUSH_PARAM_LENGTH) {
    return value;
  }

  return codePoints.slice(0, MAX_PUSH_PARAM_LENGTH).join("");
}

function toNotificationPushData(
  notification: NotificationEventData,
): NotificationPushData {
  return {
    id: notification.id,
    kind: notification.kind,
    referenceId: notification.referenceId,
    messageKey: notification.messageKey,
    createdAt: notification.createdAt,
    messageParams: JSON.stringify(
      Object.fromEntries(
        Object.entries(notification.messageParams).map(([key, value]) => [
          key,
          capPushParamValue(value),
        ]),
      ),
    ),
    ...(notification.metadata !== null && {
      metadata: JSON.stringify(notification.metadata),
    }),
    ...(notification.groupCount !== undefined && {
      groupCount: String(notification.groupCount),
    }),
  };
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
  push = false,
}: PublishNotificationEventInput) {
  const client = getRestClient();
  const channel = client.channels.get(
    makeUserNotificationsChannelName(
      userId,
      getNotificationChannelEnvironment(),
    ),
  );
  await channel.publish({
    name: "notification_created",
    data: notification,
    ...(push && {
      extras: { push: { data: toNotificationPushData(notification) } },
    }),
  });
}

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
    await channel.publish(CHAT_ROOM_MESSAGE_EVENT_NAME, {
      eventType: input.eventType,
      messageId: input.messageId,
      roomId: input.roomId,
      parentMessageId: input.parentMessageId,
      patch: input.patch,
    });
    return;
  }

  const body = chatRoomMessagePublishBody(input.eventType, input.message);
  await channel.publish(CHAT_ROOM_MESSAGE_EVENT_NAME, body);
}

interface PublishChatMembershipRevokedInput {
  userId: string;
  roomId: string;
  reason: ChatMembershipRevokeReason;
}

/**
 * Tell a user they lost membership for a room so their client can detach and
 * re-authorize promptly (SOK-742). Publishes on the always-subscribed control
 * channel — not the room channel they may be kicked from.
 */
export async function publishChatMembershipRevoked({
  userId,
  roomId,
  reason,
}: PublishChatMembershipRevokedInput) {
  const client = getRestClient();
  const channel = client.channels.get(makeUserChatControlChannelName(userId));
  await channel.publish(CHAT_MEMBERSHIP_REVOKED_EVENT_NAME, {
    roomId,
    reason,
    at: new Date().toISOString(),
  });
}

/**
 * Best-effort per-user fan-out: every recipient is attempted, one failure is
 * logged and never blocks the others, and a user listed twice is sent once.
 */
async function publishToUsers(
  userIds: readonly string[],
  label: string,
  publish: (userId: string) => Promise<unknown>,
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) {
    return;
  }
  const results = await Promise.allSettled(uniqueUserIds.map(publish));
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`Failed to publish ${label} to a user`, result.reason);
    }
  }
}

/** Best-effort fan-out of revoke signals; one failure does not block others. */
export async function publishChatMembershipRevokedToUsers(
  roomId: string,
  userIds: readonly string[],
  reason: ChatMembershipRevokeReason,
): Promise<void> {
  await publishToUsers(userIds, "chat membership revoke", (userId) =>
    publishChatMembershipRevoked({ userId, roomId, reason }),
  );
}

interface PublishChatRoomsChangedInput {
  userIds: readonly string[];
  collections: readonly ChatRoomCollection[];
  roomId: string | null;
}

// Ably batchPublish accepts at most 100 channels per spec.
const CHAT_CONTROL_BATCH_CHANNEL_LIMIT = 100;

/**
 * Refresh sidebar collections after message or membership changes.
 * Batch the existing per-user control channels; call only after commit.
 */
export async function publishChatRoomsChanged({
  userIds,
  collections,
  roomId,
}: PublishChatRoomsChangedInput): Promise<void> {
  const channels = [...new Set(userIds)].map(makeUserChatControlChannelName);
  if (channels.length === 0) return;
  try {
    const client = getRestClient();
    const messages = [
      {
        name: CHAT_ROOMS_CHANGED_EVENT_NAME,
        data: {
          collections: [...collections],
          roomId,
          at: new Date().toISOString(),
        },
      },
    ];
    const batches = [];
    for (
      let offset = 0;
      offset < channels.length;
      offset += CHAT_CONTROL_BATCH_CHANNEL_LIMIT
    ) {
      batches.push(
        channels.slice(offset, offset + CHAT_CONTROL_BATCH_CHANNEL_LIMIT),
      );
    }
    const outcomes = await Promise.allSettled(
      batches.map(async (batch) => {
        const result = await client.batchPublish({ channels: batch, messages });
        for (const entry of result.results) {
          if ("error" in entry) {
            console.error(
              "Failed to publish chat rooms changed to channel",
              entry.channel,
              entry.error,
            );
          }
        }
      }),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        console.error(
          "Failed to publish chat rooms changed batch",
          outcome.reason,
        );
      }
    }
  } catch (error) {
    console.error("Failed to publish chat rooms changed", error);
  }
}
