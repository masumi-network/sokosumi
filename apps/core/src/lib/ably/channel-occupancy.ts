import { makeUserNotificationsChannelName } from "@sokosumi/utils";

import { getSubscribeRestClient } from "./client";
import { getNotificationChannelEnvironment } from "./notification-channel-environment";

/**
 * Whether the reader has Sokosumi in front of them right now (SOK-1090).
 *
 * Asked of the reader's own notifications channel. Every signed-in tab and
 * app attaches to it for the notification stream, and enters its presence
 * while it is the tab in front or the app in the foreground, leaving when
 * it goes behind. So the channel has a presence member exactly when the
 * reader can see the app, whichever workspace it shows. Ably reports that as
 * channel occupancy, which the key here reads with the `channel-metadata`
 * capability.
 *
 * A background tab, or the app behind another, is attached but not present,
 * and does not count: the reader is not looking at it, and the email that a
 * delay would hold back is the one that reaches them.
 *
 * Throws when Ably cannot answer, including when the key lacks the
 * capability. The caller decides what an unknown costs. A channel Ably does
 * not have is not one of those: see below.
 */
export async function hasAppInFront(userId: string): Promise<boolean> {
  const channelName = makeUserNotificationsChannelName(
    userId,
    getNotificationChannelEnvironment(),
  );

  // Built before the `try`, not inside it. A key that is not `name:secret`,
  // which the env schema accepts and `.env.example` ships as a placeholder,
  // makes this constructor throw the same 404 Ably answers for a channel it
  // does not have, and the `catch` would read that as nobody being there.
  const client = getSubscribeRestClient();

  try {
    const details = await client.channels.get(channelName).status();

    return details.status.occupancy.metrics.presenceMembers > 0;
  } catch (error) {
    if (isChannelNotFound(error)) {
      return false;
    }

    throw error;
  }
}

/**
 * Whether Ably said it has no such channel.
 *
 * Nothing has to have attached to the channel for a notification to be
 * written for it, and that is this feature's ordinary case: a reader with
 * nothing open. A channel Ably does not have holds nobody, so a 404 is an
 * answer and not a failure, and reporting it as one would fill Sentry with
 * the case this feature is built for.
 */
function isChannelNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}
