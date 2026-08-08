import * as Sentry from "@sentry/node";
import type { Notification, Prisma } from "@sokosumi/database";

import { getEnv } from "@/config/env";
import defaultPrisma from "@/lib/db/prisma";

import { pushCopyFor } from "./copy";
import { deadTokens, type ExpoPushMessage, sendExpoPush } from "./expo";

/**
 * Sends one notification to every device the user has registered.
 *
 * Called alongside the Ably publish in `createNotification`, and like it,
 * deliberately incapable of failing the caller: a notification that exists in
 * the feed but did not reach a phone is a degraded delivery, whereas a
 * notification that was never written because a push provider was down is lost
 * work. Every failure here is swallowed and reported.
 *
 * Only on first creation. `createNotification` is idempotent by
 * (user, kind, reference, event, messageKey), and a duplicate emit must not
 * buzz the phone a second time for something already delivered.
 *
 * Takes the caller's client rather than reaching for the singleton, because
 * `createNotification` is often running inside a transaction: reading devices
 * on a different connection would miss uncommitted state, and reaping a dead
 * token outside the transaction would survive a rollback that undid the
 * notification it was sent for.
 */
export async function dispatchPushNotification(
  notification: Notification,
  prismaClient: Prisma.TransactionClient | typeof defaultPrisma = defaultPrisma,
): Promise<void> {
  try {
    const copy = pushCopyFor(
      notification.messageKey,
      JSON.parse(notification.messageParams) as Record<string, unknown>,
    );

    // An unrecognised key does not push. See the note in `copy.ts`: silence
    // beats showing someone a raw message key on a lock screen.
    if (!copy) return;

    const user = await prismaClient.user.findUnique({
      where: { id: notification.userId },
      select: { notificationsOptIn: true },
    });

    if (!user?.notificationsOptIn) return;

    const devices = await prismaClient.pushDevice.findMany({
      where: { userId: notification.userId },
      select: { token: true },
    });

    if (devices.length === 0) return;

    const messages: ExpoPushMessage[] = devices.map((device) => ({
      to: device.token,
      title: copy.title,
      body: copy.body,
      sound: "default",
      // Enough for the app to open the right screen, and enough for a client
      // that knows the user's language to render its own copy instead of the
      // English above.
      data: {
        notificationId: notification.id,
        kind: notification.kind,
        referenceId: notification.referenceId,
        messageKey: notification.messageKey,
        messageParams: JSON.parse(notification.messageParams),
      },
    }));

    const tickets = await sendExpoPush(messages, getEnv().EXPO_ACCESS_TOKEN);

    // Reap installs the provider says are gone. This is the only reliable
    // signal that a token is dead — the client cannot tell us, because by then
    // it no longer exists.
    const gone = deadTokens(messages, tickets);
    if (gone.length > 0) {
      await prismaClient.pushDevice.deleteMany({
        where: { token: { in: gone } },
      });
    }
  } catch (error) {
    console.error("Failed to dispatch push notification:", error);
    Sentry.captureException(error, {
      extra: {
        notificationId: notification.id,
        userId: notification.userId,
        kind: notification.kind,
        errorType: "push-dispatch",
      },
    });
  }
}
