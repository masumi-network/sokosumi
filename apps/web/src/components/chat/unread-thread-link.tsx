"use client";

import type {
  ChatEarlierThread,
  ChatUnreadThread,
} from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ThreadListRowContent,
  threadListRowClassName,
} from "@/components/chat/thread-list-row";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

/**
 * One unread Thread that names its room, for the surfaces that gather
 * Threads from every room (SOK-1159): the Threads flyout and page. It is the
 * room Thread list's unread row, with the room where that row names who
 * started it, since here the room is what replaces the nesting.
 *
 * The link is the one a chat notification uses, the Thread's first unread
 * reply, so opening it Looks the Thread through the room's existing path and
 * the row drains on the next read of the rooms.
 */
export function UnreadThreadLink({
  thread,
  label,
  roomName,
}: {
  thread: Pick<
    ChatUnreadThread,
    | "roomId"
    | "firstUnreadReplyId"
    | "unreadReplyCount"
    | "unreadMentionCount"
    | "lastUnreadAt"
  >;
  label: string;
  roomName: string;
}) {
  const tThreads = useTranslations("App.Channels.UnreadThreads");
  const tRows = useTranslations("App.Channels.ThreadRows");
  const { formatTimeAgo } = useLocalizedDateTime();
  const mentions = thread.unreadMentionCount ?? 0;

  return (
    <Link
      href={chatRoomMessageHref(thread.roomId, thread.firstUnreadReplyId)}
      data-slot="unread-thread-link"
      data-mention={mentions > 0 ? "true" : undefined}
      className={threadListRowClassName(true)}
    >
      <ThreadListRowContent
        unread
        label={label}
        time={formatTimeAgo(new Date(thread.lastUnreadAt))}
        newReplies={tThreads("newReplies", { count: thread.unreadReplyCount })}
        meta={roomName}
        mentionCount={mentions}
        mentionLabel={tRows("mentions", { count: mentions })}
      />
    </Link>
  );
}

/**
 * A Thread the reader is part of with nothing unread, in the Threads view's
 * Earlier group: the Thread list's read row, naming its room and its
 * replies. Opens at its newest reply.
 */
export function EarlierThreadLink({
  thread,
  label,
  roomName,
}: {
  thread: Pick<
    ChatEarlierThread,
    "roomId" | "replyCount" | "lastReplyAt" | "lastReplyId"
  >;
  label: string;
  roomName: string;
}) {
  const tThread = useTranslations("App.Channels.Thread");
  const { formatTimeAgo } = useLocalizedDateTime();

  return (
    <Link
      href={chatRoomMessageHref(thread.roomId, thread.lastReplyId)}
      data-slot="earlier-thread-link"
      className={threadListRowClassName(false)}
    >
      <ThreadListRowContent
        unread={false}
        label={label}
        time={formatTimeAgo(new Date(thread.lastReplyAt))}
        meta={
          <>
            {roomName}
            <span aria-hidden="true"> · </span>
            {tThread("replyCount", { count: thread.replyCount })}
          </>
        }
      />
    </Link>
  );
}
