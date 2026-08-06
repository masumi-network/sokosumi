import { CHAT_ROOM_MESSAGE_EVENT_TYPES } from "@sokosumi/utils";
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

export const chatRoomMessageEventDataSchema = z.object({
  eventType: chatRoomMessageEventTypeSchema,
  message: z
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
    .passthrough(),
});

export type ChatRoomMessageEventData = z.infer<
  typeof chatRoomMessageEventDataSchema
>;
