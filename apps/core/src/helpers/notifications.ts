import type { NotificationKind, PrismaClient } from "@sokosumi/database";

export interface CreateNotificationInput {
  userId: string;
  kind: NotificationKind;
  referenceId: string;
  action: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

/**
 * Internal helper to create or update a notification.
 * Uses upsert to avoid duplicates based on (userId, kind, referenceId, action).
 *
 * This is an internal-only helper for Core services to emit notifications.
 * Not exposed as a public API in v1.
 */
export async function createNotification(
  input: CreateNotificationInput,
  prisma: PrismaClient,
) {
  const notification = await prisma.notification.upsert({
    where: {
      userId_kind_referenceId_action: {
        userId: input.userId,
        kind: input.kind,
        referenceId: input.referenceId,
        action: input.action,
      },
    },
    create: {
      userId: input.userId,
      kind: input.kind,
      referenceId: input.referenceId,
      action: input.action,
      messageKey: input.messageKey,
      messageParams: JSON.stringify(input.messageParams),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
    update: {
      messageKey: input.messageKey,
      messageParams: JSON.stringify(input.messageParams),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      // Reset read status on update
      isRead: false,
      readAt: null,
    },
  });

  return notification;
}
