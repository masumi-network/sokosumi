import type { Prisma } from "@sokosumi/database";
import {
  notificationPublishFields,
  scheduleNotificationPublish,
} from "@/helpers/notification-publish-queue";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import type { CreateNotificationInput } from "@/helpers/notifications";
import { createNotification, resolveDelivery } from "@/helpers/notifications";

/** How many messages a row is already standing for. */
function countOn(messageParams: string, rowId: string): number {
  // A row nobody can read the params of is still a row, and it still stands
  // for the messages that landed on it. One is the answer that undercounts.
  const stored = readNotificationRowJson(messageParams, rowId, "messageParams");
  const count = stored && "count" in stored ? stored.count : undefined;

  return typeof count === "number" && Number.isInteger(count) && count >= 1
    ? count
    : 1;
}

/** The message a row was written for, when it recorded one. */
export function messageIdOn(
  metadata: string | null,
  rowId: string,
): string | null {
  if (!metadata) {
    return null;
  }

  // A row that will not read is answered as one written for some other
  // message, which is what keeps this message's text off it.
  const stored = readNotificationRowJson(metadata, rowId, "metadata");
  const messageId =
    stored && "messageId" in stored ? stored.messageId : undefined;

  return typeof messageId === "string" ? messageId : null;
}

/**
 * How many times a message tries to join a row before it takes one of its own.
 *
 * An attempt loses only to another message counting onto the same row at the
 * same instant, and the next attempt then finds the row the winner just wrote.
 * Three is well past what one room can produce.
 */
const COUNT_ATTEMPTS = 3;

/**
 * Add this message to the reader's unread row for the room, or write the first.
 *
 * A room the reader is following can carry twenty messages in a minute, and
 * twenty rows would be the notification center and nothing else in it. One row
 * says how many, and it is the row the first message wrote, so the reader's
 * place in the list is the room rather than the message.
 *
 * Read is where a group ends. The next message after the reader has been to
 * the room starts a row of its own, which is what makes the count mean
 * "since you last looked".
 *
 * Deliberately not the append-only write `createNotification` documents. The
 * row's params, its metadata and its place in the feed all move, because the
 * row is about the room over time rather than about one message. What does not
 * move is whether the reader sees it: a row written while the category was
 * silenced stays silenced and is never counted onto, so turning the category
 * back on cannot hand them what they silenced.
 *
 * The count is read in one statement and written in another, so the write
 * names the count it read and fails rather than overwriting one another
 * message put there in between. A message that loses tries again, and one that
 * keeps losing takes a row of its own rather than being dropped.
 *
 * Two messages can still each find no row and write one each. The next message
 * counts onto the newer of them, so the reader sees one row too many rather
 * than a lost message.
 */
export async function countOntoUnreadRow(
  input: CreateNotificationInput,
  client: Prisma.TransactionClient,
) {
  const delivery = await resolveDelivery(input);
  const uniqueKey = {
    userId: input.userId,
    kind: input.kind,
    referenceId: input.referenceId,
    eventId: input.eventId,
    messageKey: input.messageKey,
  };
  // The caller holds the membership lock; receipts survive newer arrivals and reads.
  const delivered = await client.notification.findUnique({
    where: { userId_kind_referenceId_eventId_messageKey: uniqueKey },
    select: { id: true },
  });
  if (delivered) return;
  async function recordReceipt() {
    const receipt = await client.notification.createMany({
      data: {
        ...uniqueKey,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        inApp: false,
        isRead: true,
        readAt: new Date(),
        messageParams: "{}",
        metadata: JSON.stringify({
          ...input.metadata,
          osBannerEligible: false,
        }),
      },
      skipDuplicates: true,
    });
    if (receipt.count === 0)
      throw new Error("Chat notification receipt already exists");
  }

  // Do not add a banner-only message to a row that remains visible in the
  // notification center. A separate hidden row preserves the current choice.
  if (!delivery.inApp) {
    await createNotification(input, client);
    return;
  }

  for (let attempt = 0; attempt < COUNT_ATTEMPTS; attempt += 1) {
    const unread = await client.notification.findFirst({
      where: {
        userId: input.userId,
        kind: input.kind,
        referenceId: input.referenceId,
        messageKey: input.messageKey,
        isRead: false,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        // A silenced row is not one the reader is reading, so not one this
        // message may join.
        inApp: true,
      },
      // `createdAt` alone leaves the pick to chance when two rows share an
      // instant, which the double-write above can produce.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    if (!unread) {
      await createNotification(input, client);
      return;
    }

    // The same message arriving twice. The row already stands for it, and
    // counting it again would say two messages where there was one.
    if (messageIdOn(unread.metadata, unread.id) === input.metadata?.messageId) {
      await recordReceipt();
      return;
    }

    // Named rather than blind: the row must still hold the count this attempt
    // read, and must still be unread. Either having moved means another
    // message got here first.
    const written = await client.notification.updateMany({
      where: {
        id: unread.id,
        messageParams: unread.messageParams,
        publishId: unread.publishId,
        isRead: false,
      },
      data: {
        messageParams: JSON.stringify({
          ...input.messageParams,
          count: countOn(unread.messageParams, unread.id) + 1,
        }),
        metadata:
          input.metadata === undefined || input.metadata === null
            ? null
            : JSON.stringify(input.metadata),
        createdAt: new Date(),
        ...notificationPublishFields(delivery, unread.publishCreated === true),
      },
    });

    if (written.count === 0) {
      continue;
    }

    // The row now stands for one more message than the email waiting on it
    // said, so that email is sent again with the new tally. Scheduled rather
    // than awaited, like the first send: the reader has been answered, and a
    // resend that fails must not cost them the message (SOK-1142).
    // The caller resends only after this transaction commits.
    await recordReceipt();

    scheduleNotificationPublish(unread.id);

    return unread.id;
  }

  // Every attempt lost the write. A row of its own says more than silence.
  await createNotification(input, client);
}
