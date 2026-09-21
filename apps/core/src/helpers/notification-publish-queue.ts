import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import { waitUntil } from "@vercel/functions";

import type { NotificationDelivery } from "@/helpers/notification-delivery";

export function notificationPublishFields(
  delivery: NotificationDelivery,
  created = true,
  now = new Date(),
) {
  if (!delivery.inApp && !delivery.osBanner) {
    return {};
  }
  return {
    publishId: randomUUID(),
    // A failed read is unknown consent, not an explicit opt-out.
    publishPush: delivery.fellBack ? null : delivery.osBanner,
    publishCreated: created,
    publishQueuedAt: now,
    publishNextAttemptAt: now,
  };
}

export function scheduleNotificationPublish(notificationId: string): void {
  waitUntil(
    import("./notification-publish")
      .then(({ dispatchNotificationPublish }) =>
        dispatchNotificationPublish(notificationId),
      )
      .catch((error) => {
        Sentry.captureException(error, {
          extra: { notificationId, errorType: "notification-publish-schedule" },
        });
      }),
  );
}
