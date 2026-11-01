import * as Sentry from "@sentry/node";
import { NotificationKind, type Prisma } from "@sokosumi/database";
import { buildNamedChatMessagePreview } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";

import {
  hasCalendarWorkspaceAccess,
  lockCalendarWorkspaceMembership,
} from "@/helpers/calendar-membership-fence";
import { loadDirectRoomNamesByReader } from "@/helpers/chat-direct-room-names";
import { loadChatMentionNames } from "@/helpers/chat-mention-names";
import {
  countOntoUnreadRow,
  messageIdOn,
} from "@/helpers/chat-notification-count";
import { previewOf } from "@/helpers/chat-notification-preview";
import { CHAT_ROOM_BADGE_MESSAGE_KEYS } from "@/helpers/notification-delivery";
import { resendRoomMessageEmail } from "@/helpers/notification-email-dispatch";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import type { CreateNotificationInput } from "@/helpers/notifications";
import { createNotification, resolveDelivery } from "@/helpers/notifications";
import { isPrismaTransactionConflict } from "@/helpers/prisma";
import { publishChatRoomsChanged } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";

export interface FanOutChatNotificationsParams {
  throwOnError?: boolean;
  roomId: string;
  roomName: string;
  organizationId: string | null;
  messageId: string;
  /** The room message body, which the reader is shown a preview of. */
  content: string;
  /** Human author to skip. Null when the author is a coworker. */
  authorUserId: string | null;
  authorName: string;
  recipientUserIds: readonly string[];
  /** Direct-message channels already covered by these users' mentions. */
  mentionedUserIds?: readonly string[];
  /** Decides which preference row the reader reads this under. */
  messageKey: string;
  /** Sentry tag, so a failed emit names which chat notification it was. */
  notificationType: string;
  /**
   * Count this message onto the reader's unread row for the room, where they
   * have one, instead of writing a row of its own.
   */
  countPerRoom?: boolean;
  /**
   * The room is a group of people rather than a named channel, so its name is
   * the list of who is in it. The reader is told so, because a bare list of
   * names does not read as somewhere a message was written.
   */
  isGroup?: boolean;
  /**
   * The room holds the reader and whoever wrote, and nobody else. Its name is
   * the other person's, which a mention would say twice, so the reader is told
   * the kind of room instead of its name.
   */
  isDirectPair?: boolean;
  /**
   * Name the room per reader. A room named after who is in it has a name that
   * belongs to nobody: the stored one lists whoever the creator added, so each
   * reader is told the name their own screen uses instead.
   */
  nameRoomPerReader?: boolean;
  /**
   * The Thread this message replies in, so readers who muted that Thread are
   * left out. Omitted for a top-level message, and omitted by the mention
   * fan-out: being named breaks through a muted Thread, because muting
   * silences the chatter and being addressed by name is not chatter.
   */
  parentMessageId?: string | null;
}

/** Readers who muted the Thread this message replies in. */
async function loadThreadMutedUserIds(
  parentMessageId: string,
  userIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const muted = await prisma.chatRoomThreadReadState.findMany({
    where: {
      parentMessageId,
      userId: { in: [...userIds] },
      mutedAt: { not: null },
    },
    select: { userId: true },
  });

  return new Set(muted.map((state) => state.userId));
}

async function deliverToCurrentRoomMember(
  roomId: string,
  organizationId: string | null,
  input: CreateNotificationInput,
  countPerRoom: boolean,
): Promise<void> {
  const delivery = input.suppressMentionDelivery
    ? await resolveDelivery(input)
    : undefined;
  // A fully covered Direct needs no second row or later reminder.
  if (delivery && !delivery.inApp && !delivery.osBanner && !delivery.email)
    return;
  const countedRowId = await prisma.$transaction(async (tx) => {
    if (organizationId && input.workspaceId) {
      await lockCalendarWorkspaceMembership(tx, input.workspaceId);
      if (
        !(await hasCalendarWorkspaceAccess(tx, input.workspaceId, input.userId))
      ) {
        return;
      }
    }

    const memberships = await tx.$queryRaw<
      Array<{ access: string; mutedAt: Date | null }>
    >`
      SELECT access, "mutedAt"
      FROM "chat_room_user_member"
      WHERE "roomId" = ${roomId}::UUID
        AND "userId" = ${input.userId}
      FOR UPDATE
    `;
    const membership = memberships[0];
    if (!membership || membership.mutedAt !== null) {
      return;
    }

    if (organizationId && membership.access === "member") {
      if (!input.workspaceId) {
        return;
      }
    }

    if (countPerRoom) {
      return countOntoUnreadRow(input, tx);
    } else {
      await createNotification(input, tx, delivery);
    }
  });
  if (countedRowId)
    waitUntil(resendRoomMessageEmail(countedRowId, { allowInitialSend: true }));
}

/**
 * The steps every chat notification shares: drop the author, drop the readers
 * who muted the room, and write one notification each.
 *
 * A mention, a direct message and a room message differ only in the message
 * key they carry and the preference row that key maps to. Keeping the fan-out
 * in one place means a fix to the mute rule or the workspace lookup reaches all
 * three, and a fourth chat notification is a message key rather than another
 * copy of this function.
 *
 * One recipient's failure never costs the others theirs, so each write is
 * caught and reported on its own.
 */
export async function fanOutChatNotifications(
  params: FanOutChatNotificationsParams,
): Promise<void> {
  const recipientUserIds = [
    ...new Set(
      params.recipientUserIds.filter(
        (userId) =>
          params.authorUserId === null || userId !== params.authorUserId,
      ),
    ),
  ];

  if (recipientUserIds.length === 0) {
    return;
  }

  const currentMemberships = await prisma.chatRoomUserMember.findMany({
    where: {
      roomId: params.roomId,
      userId: { in: recipientUserIds },
    },
    select: { access: true, mutedAt: true, userId: true },
  });
  const membershipsByUserId = new Map(
    currentMemberships.map((membership) => [membership.userId, membership]),
  );
  const threadMutedUserIds = params.parentMessageId
    ? await loadThreadMutedUserIds(params.parentMessageId, recipientUserIds)
    : new Set<string>();
  const notifyUserIds = recipientUserIds.filter(
    (userId) =>
      membershipsByUserId.get(userId)?.mutedAt === null &&
      !threadMutedUserIds.has(userId),
  );

  if (notifyUserIds.length === 0) {
    return;
  }

  let workspaceId: string | null = null;
  let hostOrganizationMemberIds = new Set<string>();
  if (params.organizationId) {
    const [workspace, hostOrganizationMembers] = await Promise.all([
      prisma.workspace.findUnique({
        where: { organizationId: params.organizationId },
        select: { id: true },
      }),
      prisma.member.findMany({
        where: {
          organizationId: params.organizationId,
          userId: { in: notifyUserIds },
        },
        select: { userId: true },
      }),
    ]);
    workspaceId = workspace?.id ?? null;
    hostOrganizationMemberIds = new Set(
      hostOrganizationMembers.map((member) => member.userId),
    );
  }

  // This runs after the response, so a reader can delete the message before
  // it lands. The delete takes the text off the rows that exist by then, and
  // writing the preview now would put it back with nothing left to take it
  // off again. Read by primary key, next to the reads above.
  const message = await prisma.chatRoomMessage.findUnique({
    where: { id: params.messageId },
    select: { deletedAt: true },
  });

  // Built once rather than per reader: every recipient of one message is shown
  // the same preview, and the rule reads the whole body to get there. The
  // mentioned members are read for the same reason a banner has a preview at
  // all: a mention has to say who, and the id in the token says it to nobody.
  const messagePreview =
    message === null || message.deletedAt !== null
      ? ""
      : await previewOf(params);

  // A direct room is named after who is in it, so its name differs by reader
  // and the stored one is right for nobody. Read once for the whole fan-out.
  //
  // A failed read costs the readers a correct name, not the notification. The
  // stored name is wrong for a group direct room, and wrong still says which
  // room and who wrote; nothing at all says neither.
  let roomNamesByReader: ReadonlyMap<string, string> | null = null;
  if (params.nameRoomPerReader) {
    try {
      roomNamesByReader = await loadDirectRoomNamesByReader({
        roomId: params.roomId,
        readerUserIds: notifyUserIds,
      });
    } catch (error) {
      if (params.throwOnError) throw error;
      Sentry.captureException(error, {
        extra: {
          roomId: params.roomId,
          messageId: params.messageId,
          notificationType: "chat-direct-room-name",
        },
      });
    }
  }

  for (const userId of notifyUserIds) {
    const input: CreateNotificationInput = {
      userId,
      kind: NotificationKind.CHAT,
      ...(params.mentionedUserIds?.includes(userId)
        ? { suppressMentionDelivery: true }
        : {}),
      referenceId: params.roomId,
      eventId: params.messageId,
      messageKey: params.messageKey,
      ...(workspaceId &&
      membershipsByUserId.get(userId)?.access === "member" &&
      hostOrganizationMemberIds.has(userId)
        ? { workspaceId }
        : {}),
      messageParams: {
        authorName: params.authorName,
        roomName: roomNamesByReader?.get(userId) ?? params.roomName,
        ...(params.isGroup ? { isGroup: true } : {}),
        ...(params.isDirectPair ? { isDirect: true } : {}),
        // Omitted rather than empty when the body cleans to nothing. A reader
        // is then shown the line that names the author and the room, which is
        // what a banner said before there was a preview at all.
        ...(messagePreview ? { messagePreview } : {}),
      },
      metadata: {
        messageId: params.messageId,
        workspaceId,
      },
    };

    try {
      // A mentioned message has its own companion row, so arrival counts can
      // subtract its overlap without losing other messages in a counted row.
      if (params.countPerRoom && !input.suppressMentionDelivery) {
        await deliverToCurrentRoomMember(
          params.roomId,
          params.organizationId,
          input,
          true,
        );
      } else {
        await deliverToCurrentRoomMember(
          params.roomId,
          params.organizationId,
          input,
          false,
        );
      }
    } catch (error) {
      if (params.throwOnError) throw error;
      Sentry.captureException(error, {
        extra: {
          roomId: params.roomId,
          messageId: params.messageId,
          userId,
          notificationType: params.notificationType,
        },
      });
    }
  }

  // The message's own rooms-changed went out beside this fan-out, so a list read
  // on it can land before these rows and miss the reader's mention mark.
  if (CHAT_ROOM_BADGE_MESSAGE_KEYS.includes(params.messageKey)) {
    await publishChatRoomsChanged({
      userIds: notifyUserIds,
      collections: ["active"],
      roomId: params.roomId,
    });
  }

  if (!messagePreview) {
    return;
  }

  // The read above is one moment and the loop is another. A delete or an edit
  // landing between them takes the text off the rows that exist by then and
  // leaves it on every row written after. This fan-out is the last writer of
  // those rows, so it is the one that has to look again.
  const current = await prisma.chatRoomMessage.findUnique({
    where: { id: params.messageId },
    select: { content: true, deletedAt: true },
  });
  const saysNow =
    current === null || current.deletedAt !== null ? "" : current.content;

  if (saysNow === params.content) {
    return;
  }

  await rewriteChatNotificationPreviews({
    roomId: params.roomId,
    messageId: params.messageId,
  });
}

/**
 * How many times one row is read again after losing its guarded write.
 *
 * A write loses to another writer landing on the same row between the read
 * and the write: another message counting onto it, or the other of an edit
 * and a delete of this same message. The next attempt reads what the winner
 * wrote and decides on that. Three is well past what one room can produce,
 * and matches the bound the counting path uses.
 */
const REWRITE_ATTEMPTS = 3;

/** A notification row, as much of it as a rewrite reads. */
interface RewritableRow {
  id: string;
  messageParams: string;
  metadata: string | null;
}

/**
 * Put this message's preview on one row, or take it off.
 *
 * The write names the params it read, so it lands only while the row still
 * carries what this rewrite decided about. Losing that race is not a failure:
 * the row moved, so read it again and decide on what it says now. Giving up
 * instead would leave a deleted message's text on the row whenever an edit of
 * the same message wrote between this rewrite's read and its write.
 */
async function rewriteRow(
  row: RewritableRow,
  messageId: string,
  preview: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  let current = row;

  for (let attempt = 0; attempt < REWRITE_ATTEMPTS; attempt += 1) {
    if (messageIdOn(current.metadata, current.id) !== messageId) {
      return;
    }

    // One unreadable row must not cost every other recipient their wipe, the
    // same way `countOn` and `messageIdOn` read a row above. A row carrying
    // no preview is left alone: this takes text back or brings it up to date,
    // and never puts text somewhere it was not.
    const stored = readNotificationRowJson(
      current.messageParams,
      current.id,
      "messageParams",
    );
    if (typeof stored?.messagePreview !== "string") {
      return;
    }

    const { messagePreview: _previous, ...rest } = stored;
    const written = await tx.notification.updateMany({
      where: { id: current.id, messageParams: current.messageParams },
      data: {
        messageParams: JSON.stringify(
          preview ? { ...rest, messagePreview: preview } : rest,
        ),
      },
    });

    if (written.count > 0) {
      return;
    }

    const reread = await tx.notification.findUnique({
      where: { id: current.id },
      select: { id: true, messageParams: true, metadata: true },
    });

    if (reread === null) {
      return;
    }

    current = reread;
  }
}

interface PreviewMessageSource {
  roomId: string;
  messageId: string;
}

const PREVIEW_TRANSACTION_ATTEMPTS = 3;

/**
 * The names one sweep has already read, kept by the body they were read for.
 *
 * Every row of a message carries the same preview, so the members it mentions
 * are the same members for each of them. Reading them per row would put three
 * more queries inside every recipient's transaction, and a room-wide sweep
 * would pay them once per reader for one message.
 *
 * Keyed by the body, because a row locks and rereads the message: an edit that
 * lands mid-sweep gives the rows after it a different body, and that body gets
 * its own read.
 */
type MentionNamesBySource = Map<string, ReadonlyMap<string, string>>;

async function mentionNamesFor(
  cache: MentionNamesBySource,
  source: PreviewMessageSource,
  content: string,
  tx: Prisma.TransactionClient,
): Promise<ReadonlyMap<string, string>> {
  const known = cache.get(content);
  if (known) {
    return known;
  }

  const names = await loadChatMentionNames({
    roomId: source.roomId,
    content,
    client: tx,
  });
  cache.set(content, names);

  return names;
}

/** Lock and reread the message for one recipient, including on each retry. */
async function rewriteRowFromMessage(
  row: RewritableRow,
  source: PreviewMessageSource,
  names: MentionNamesBySource,
): Promise<void> {
  for (let attempt = 0; attempt < PREVIEW_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        // Keep this lock until this recipient's copy is updated. Separate
        // transactions prevent a slow room-wide sweep from rolling back all rows.
        await tx.$queryRaw`
          SELECT "id" FROM "chat_room_message"
          WHERE "id" = ${source.messageId}::uuid
            AND "roomId" = ${source.roomId}::uuid
          FOR UPDATE
        `;
        const message = await tx.chatRoomMessage.findUnique({
          where: { id: source.messageId, roomId: source.roomId },
          select: { content: true, deletedAt: true },
        });
        const content =
          message === null || message.deletedAt !== null ? "" : message.content;
        // Remove ambiguous edited text. Once removed, this row stays without
        // a preview, following the same rule as every other rewrite.
        const preview = buildNamedChatMessagePreview(
          content,
          await mentionNamesFor(names, source, content, tx),
        );

        await rewriteRow(row, source.messageId, preview, tx);
      });
      return;
    } catch (error) {
      const transactionExpired =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2028";
      if (
        attempt + 1 === PREVIEW_TRANSACTION_ATTEMPTS ||
        (!transactionExpired && !isPrismaTransactionConflict(error))
      ) {
        throw error;
      }
    }
  }
}

/**
 * Refresh existing previews from the stored message, one recipient at a time.
 * A failed recipient is reported without undoing or skipping other recipients.
 * Rows without a preview stay without one.
 */
export async function rewriteChatNotificationPreviews(
  params: PreviewMessageSource,
): Promise<void> {
  try {
    // Counted rows reference their latest message in metadata, not eventId.
    // This snapshot only selects candidates; each guarded write checks the row.
    const rows = await prisma.notification.findMany({
      where: {
        kind: NotificationKind.CHAT,
        referenceId: params.roomId,
        metadata: { contains: `"messageId":"${params.messageId}"` },
      },
      select: { id: true, messageParams: true, metadata: true },
      orderBy: { id: "asc" },
    });
    const names: MentionNamesBySource = new Map();
    for (const row of rows) {
      try {
        await rewriteRowFromMessage(row, params, names);
      } catch (error) {
        Sentry.captureException(error, {
          extra: {
            ...params,
            notificationId: row.id,
            notificationType: "chat_notification_preview_rewrite",
          },
        });
      }
      // Provider cancellation must not hold the message edit or delete open.
      waitUntil(resendRoomMessageEmail(row.id));
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        ...params,
        notificationType: "chat_notification_preview_rewrite",
      },
    });
  }
}
