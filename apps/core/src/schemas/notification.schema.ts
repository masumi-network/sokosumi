import { z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime";

export const notificationKindSchema = z
  .enum([
    NotificationKind.JOB,
    NotificationKind.TASK,
    NotificationKind.BILLING,
    NotificationKind.SYSTEM,
    NotificationKind.CHAT,
  ])
  .openapi("NotificationKind");

export const notificationItemSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique identifier for the notification",
      example: "cm123456789abcdefghij",
    }),
    userId: z.string().openapi({
      description: "User ID of the notification owner",
      example: "cm123456789abcdefghij",
    }),
    kind: notificationKindSchema.openapi({
      description: "Notification source domain",
      example: NotificationKind.JOB,
    }),
    referenceId: z.string().openapi({
      description: "ID of the related entity (job id, task id, etc.)",
      example: "cm123456789abcdefghij",
    }),
    eventId: z.string().openapi({
      description:
        "ID of the source event (jobEvent or taskEvent, depending on kind)",
      example: "cm123456789abcdefghij",
    }),
    messageKey: z.string().openapi({
      description:
        "i18n message key for translation (e.g. Notifications.Job.completed)",
      example: "Notifications.Job.completed",
    }),
    messageParams: z.record(z.string(), z.unknown()).openapi({
      description: "ICU interpolation parameters for the message",
      example: { agentName: "Research Agent", jobName: "Market Analysis" },
    }),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({
        description: "Optional metadata for deep-linking or context",
        example: { agentId: "agent_123", projectId: "proj_456" },
      }),
    isRead: z.boolean().openapi({
      description: "Whether the notification has been read",
      example: false,
    }),
    readAt: dateTimeSchema.nullable().openapi({
      description: "When the notification was marked as read",
      example: null,
    }),
    createdAt: dateTimeSchema.openapi({
      description: "When the notification was created",
      example: "2026-06-16T15:00:00.000Z",
    }),
  })
  .openapi("NotificationItem");

export const notificationListSchema = z
  .array(notificationItemSchema)
  .openapi("NotificationList");

export const unreadCountSchema = z
  .object({
    count: z.number().int().min(0).openapi({
      description: "Number of unread notifications",
      example: 5,
    }),
  })
  .openapi("UnreadCount");

export type NotificationItem = z.infer<typeof notificationItemSchema>;
