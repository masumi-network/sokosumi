import {
  CHAT_ROOM_MESSAGE_EVENT_TYPES,
  CHAT_ROOM_PINNED_MESSAGE_ACTIONS,
} from "@sokosumi/utils";
import * as z from "zod";
import {
  NotificationKind,
  SokosumiJobStatus,
} from "@/lib/clients/generated/core";

export const jobStatusDataSchema = z.object({
  jobId: z.string().min(1),
  jobStatus: z.enum(SokosumiJobStatus),
  jobStatusSettled: z.boolean(),
});

export type JobStatusData = z.infer<typeof jobStatusDataSchema>;

export const taskEventDataSchema = z.object({
  taskId: z.string().min(1),
  eventType: z.literal("task_event"),
});

export type TaskEventData = z.infer<typeof taskEventDataSchema>;

export const notificationEventDataSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: z.nativeEnum(NotificationKind),
  referenceId: z.string(),
  eventId: z.string(),
  messageKey: z.string(),
  messageParams: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  isRead: z.boolean(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  /**
   * Where the reader's preference matrix said this goes. Both default to true
   * for an event published by a Core that predates the matrix: it was delivered
   * on both channels, so that is what the reader saw.
   */
  inApp: z.boolean().default(true),
  osBanner: z.boolean().default(true),
  /**
   * Whether this event wrote the row or changed one that was already there.
   * A room's messages are counted onto one row, so a row can arrive twice.
   * True for an event published by a Core that only ever wrote rows.
   */
  created: z.boolean().default(true),
  /**
   * How many messages are waiting for the reader in this room.
   *
   * Chat only, and only while the row is unread. One OS banner holds a whole
   * room and each arrival replaces the one standing, so the banner says how
   * many it stands for. Core sends it because the push service worker can
   * query nothing and has to read the same number for a closed app.
   *
   * Absent from an event a Core that predates the count published, and from
   * every kind but chat. The banner then names the arrival, which is what it
   * did before there was a count.
   */
  groupCount: z.number().int().min(1).optional(),
});

export type NotificationEventData = z.infer<typeof notificationEventDataSchema>;

const chatRoomMessageUnfurlEventSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  siteName: z.string().nullable(),
});

export const chatRoomMessageEventTypeSchema = z.enum(
  CHAT_ROOM_MESSAGE_EVENT_TYPES,
);

/** Full message DTO carried on create / update / delete Ably events. */
export const chatRoomMessageFullEventMessageSchema = z
  .object({
    id: z.string().min(1),
    roomId: z.string().min(1),
    parentMessageId: z.string().nullable(),
    content: z.string(),
    createdAt: z.string(),
    deletedAt: z.string().nullable(),
    editedAt: z.string().nullable(),
    sender: z.unknown(),
    mentions: z.array(z.unknown()),
    reactions: z.array(z.unknown()),
    threadReplyCount: z.number().int().min(0),
    threadLastReplyAt: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    quote: z.unknown().nullable(),
    membership: z.unknown().nullable(),
    unfurls: z.array(chatRoomMessageUnfurlEventSchema).max(3).nullable(),
  })
  .passthrough();

const chatRoomMessageFullEventSchema = z.object({
  eventType: z.enum(["create", "update", "delete"]),
  message: chatRoomMessageFullEventMessageSchema,
});

/** Over-limit create/update/delete: identity only (ADR 0014). */
const chatRoomMessageIdEnvelopeSchema = z.object({
  eventType: z.enum(["create", "update", "delete"]),
  messageId: z.string().min(1),
  roomId: z.string().min(1),
  parentMessageId: z.string().nullable(),
});

const chatRoomMessageReactionEventSchema = z.object({
  eventType: z.literal("reaction"),
  messageId: z.string().min(1),
  roomId: z.string().min(1),
  parentMessageId: z.string().nullable(),
  patch: z.object({
    reactions: z.array(z.unknown()),
  }),
});

const chatRoomMessageUnfurlEventDataSchema = z.object({
  eventType: z.literal("unfurl"),
  messageId: z.string().min(1),
  roomId: z.string().min(1),
  parentMessageId: z.string().nullable(),
  patch: z.object({
    unfurls: z.array(chatRoomMessageUnfurlEventSchema).max(3).nullable(),
  }),
});

const chatRoomMessageMentionStatusEventSchema = z.object({
  eventType: z.literal("mention_status"),
  messageId: z.string().min(1),
  roomId: z.string().min(1),
  parentMessageId: z.string().nullable(),
  patch: z.object({
    mentions: z.array(z.unknown()),
  }),
});

/**
 * Ably `chat_room_message` body (SOK-736 + SOK-737 + ADR 0014).
 * Full DTO or id envelope for create/update/delete; field patch for
 * reaction/unfurl/mention_status.
 */
export const chatRoomMessageEventDataSchema = z.union([
  chatRoomMessageFullEventSchema,
  chatRoomMessageIdEnvelopeSchema,
  chatRoomMessageReactionEventSchema,
  chatRoomMessageUnfurlEventDataSchema,
  chatRoomMessageMentionStatusEventSchema,
]);

export type ChatRoomMessageEventData = z.infer<
  typeof chatRoomMessageEventDataSchema
>;

export type ChatRoomMessageFullEventData = z.infer<
  typeof chatRoomMessageFullEventSchema
>;

export type ChatRoomMessageIdEnvelopeData = z.infer<
  typeof chatRoomMessageIdEnvelopeSchema
>;

export type ChatRoomMessagePatchEventData = Extract<
  ChatRoomMessageEventData,
  { eventType: "reaction" | "unfurl" | "mention_status" }
>;

export function isChatRoomMessagePatchEvent(
  event: ChatRoomMessageEventData,
): event is ChatRoomMessagePatchEventData {
  return (
    event.eventType === "reaction" ||
    event.eventType === "unfurl" ||
    event.eventType === "mention_status"
  );
}

export const chatRoomPinnedMessageEventDataSchema = z.object({
  action: z.enum(CHAT_ROOM_PINNED_MESSAGE_ACTIONS),
  roomId: z.string().min(1),
  messageId: z.string().min(1),
  pinnedMessageCount: z.number().int().min(0),
});

export type ChatRoomPinnedMessageEventData = z.infer<
  typeof chatRoomPinnedMessageEventDataSchema
>;

export function isChatRoomMessageIdEnvelope(
  event: ChatRoomMessageEventData,
): event is ChatRoomMessageIdEnvelopeData {
  return (
    (event.eventType === "create" ||
      event.eventType === "update" ||
      event.eventType === "delete") &&
    !("message" in event)
  );
}
