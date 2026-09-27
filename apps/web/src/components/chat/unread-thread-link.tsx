"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { getRoomDisplayName } from "@/app/chat/components/room-helpers";
import { roomMentionNames } from "@/app/chat/utils/room-mention-names";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import {
  ThreadListRowContent,
  threadListRowClassName,
} from "@/components/chat/thread-list-row";
import type {
  ChatEarlierThread,
  ChatRoom,
  ChatUnreadThread,
} from "@/lib/clients/generated/core";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

/** A Thread row's two names: the Thread's, from its parent, and its room's. */
function useThreadRowNames(
  room: ChatRoom,
  parentContent: string,
  currentUserId: string,
): { label: string; roomName: string } {
  const t = useTranslations("App.Channels.ThreadRows");
  const tChannels = useTranslations("App.Channels");
  const roomName = getRoomDisplayName(
    room,
    currentUserId,
    tChannels("SelfDirect.you"),
  );
  return {
    label:
      formatUnreadThreadsPreview(
        parentContent,
        roomMentionNames(room, tChannels("MentionAll.label")),
      ) || t("untitled"),
    roomName: room.kind === "channel" ? `#${roomName}` : roomName,
  };
}

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
  room,
  currentUserId,
}: {
  thread: Pick<
    ChatUnreadThread,
    | "firstUnreadReplyId"
    | "parentContent"
    | "unreadReplyCount"
    | "unreadMentionCount"
    | "lastUnreadAt"
  >;
  room: ChatRoom;
  currentUserId: string;
}) {
  const tThreads = useTranslations("App.Channels.UnreadThreads");
  const tRows = useTranslations("App.Channels.ThreadRows");
  const { formatTimeAgo } = useLocalizedDateTime();
  const mentions = thread.unreadMentionCount ?? 0;
  const { label, roomName } = useThreadRowNames(
    room,
    thread.parentContent,
    currentUserId,
  );

  return (
    <Link
      href={chatRoomMessageHref(room.id, thread.firstUnreadReplyId)}
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
  room,
  currentUserId,
}: {
  thread: Pick<
    ChatEarlierThread,
    "parentContent" | "replyCount" | "lastReplyAt" | "lastReplyId"
  >;
  room: ChatRoom;
  currentUserId: string;
}) {
  const tThread = useTranslations("App.Channels.Thread");
  const { formatTimeAgo } = useLocalizedDateTime();
  const { label, roomName } = useThreadRowNames(
    room,
    thread.parentContent,
    currentUserId,
  );

  return (
    <Link
      href={chatRoomMessageHref(room.id, thread.lastReplyId)}
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
