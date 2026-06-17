import type { NotificationKind } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

export interface CreateNotificationInput {
  userId: string;
  kind: NotificationKind;
  referenceId: string;
  eventId: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

/**
 * Internal helper to create or update a notification.
 * Uses upsert to avoid duplicates based on (userId, kind, referenceId, eventId).
 *
 * eventId references a jobEvent or taskEvent row depending on kind.
 *
 * This is an internal-only helper for Core services to emit notifications.
 * Not exposed as a public API in v1.
 */
export async function createNotification(
  input: CreateNotificationInput,
  prismaClient: typeof prisma = prisma,
) {
  const prisma = prismaClient;
  const notification = await prisma.notification.upsert({
    where: {
      userId_kind_referenceId_eventId: {
        userId: input.userId,
        kind: input.kind,
        referenceId: input.referenceId,
        eventId: input.eventId,
      },
    },
    create: {
      userId: input.userId,
      kind: input.kind,
      referenceId: input.referenceId,
      eventId: input.eventId,
      messageKey: input.messageKey,
      messageParams: JSON.stringify(input.messageParams),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
    update: {
      messageKey: input.messageKey,
      messageParams: JSON.stringify(input.messageParams),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      isRead: false,
      readAt: null,
      createdAt: new Date(),
    },
  });

  return notification;
}
