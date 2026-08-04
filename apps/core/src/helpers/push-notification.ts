import * as Sentry from "@sentry/node";
import type { Notification } from "@sokosumi/database";
import { getNotificationHref } from "@sokosumi/utils";
import webpush from "web-push";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

import { formatPushNotificationBody } from "./push-notification-body.js";

function getErrorStatusCode(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return undefined;
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Send Web Push for a newly created notification to all of the user's
 * stored subscriptions. Never throws — failures are logged and sent to Sentry.
 * Uses the default Prisma client (not a transaction client).
 */
export async function sendPushForNotification(
  notification: Notification,
): Promise<void> {
  try {
    const env = getEnv();
    webpush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: notification.userId },
    });

    if (subscriptions.length === 0) {
      return;
    }

    const messageParams = parseJsonRecord(notification.messageParams) ?? {};
    const metadata = parseJsonRecord(notification.metadata);
    const body = formatPushNotificationBody(
      notification.messageKey,
      messageParams,
    );
    const href = getNotificationHref({
      kind: notification.kind,
      referenceId: notification.referenceId,
      metadata,
      messageKey: notification.messageKey,
    });
    const payload = JSON.stringify({
      tag: notification.id,
      title: "Sokosumi",
      body,
      url: href ?? "/",
    });

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload,
          );
        } catch (error) {
          const statusCode = getErrorStatusCode(error);
          if (statusCode === 404 || statusCode === 410) {
            try {
              await prisma.pushSubscription.delete({
                where: { endpoint: subscription.endpoint },
              });
            } catch (deleteError) {
              console.error(
                "Failed to delete stale push subscription:",
                deleteError,
              );
              Sentry.captureException(deleteError, {
                extra: {
                  notificationId: notification.id,
                  userId: notification.userId,
                  endpoint: subscription.endpoint,
                  errorType: "push-subscription-delete",
                },
              });
            }
            return;
          }

          console.error("Failed to send web push notification:", error);
          Sentry.captureException(error, {
            extra: {
              notificationId: notification.id,
              userId: notification.userId,
              endpoint: subscription.endpoint,
              statusCode,
              errorType: "web-push-send",
            },
          });
        }
      }),
    );
  } catch (error) {
    console.error("Failed to process web push for notification:", error);
    Sentry.captureException(error, {
      extra: {
        notificationId: notification.id,
        userId: notification.userId,
        kind: notification.kind,
        errorType: "web-push-notification",
      },
    });
  }
}
