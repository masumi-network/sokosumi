"use client";

import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { getRoomDisplayName } from "@/app/chat/components/room-helpers";
import { roomMentionNames } from "@/app/chat/utils/room-mention-names";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import { RowCountMark } from "@/components/chat/mention-count-pill";
import { ThreadIconCircle } from "@/components/chat/thread-icon-circle";
import type { ChatEarlierThread, ChatRoom } from "@/lib/clients/generated/core";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

/** What a row reads off one unread Thread, wherever it came from. */
export interface UnreadThreadLinkThread {
  parentMessageId: string;
  firstUnreadReplyId: string;
  parentContent: string;
  unreadReplyCount: number;
  unreadMentionCount?: number;
}

interface UnreadThreadLinkProps {
  thread: UnreadThreadLinkThread;
  room: ChatRoom;
  currentUserId: string;
}

/**
 * One unread Thread that names its room, for the surfaces that gather
 * Threads from every room (SOK-1159): the Threads popover and page. Under a room the room goes without saying, and
 * `ChatRoomThreadRows` draws those; here it is what replaces the nesting.
 *
 * The link is the one a chat notification uses, the Thread's first unread
 * reply, so opening it Looks the Thread through the room's existing path and
 * the row drains on the next read of the rooms.
 *
 * One number, as on every sidebar row: the `@` pill where a reply names the
 * reader, the muted count of unread replies otherwise. Both are announced.
 */
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

export function UnreadThreadLink({
  thread,
  room,
  currentUserId,
}: UnreadThreadLinkProps) {
  const t = useTranslations("App.Channels.ThreadRows");
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
      // The room Thread list's unread row (SOK-1158): the tint marks it unread.
      className="hover:bg-accent bg-card-background flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm"
    >
      <ThreadIconCircle
        tone="attention"
        glyph={mentions > 0 ? "mention" : "thread"}
        size="md"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-foreground line-clamp-2 min-w-0 font-semibold">
          {label}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {roomName}
        </span>
      </span>
      <span className="flex w-7 shrink-0 justify-center pt-px">
        <span aria-hidden>
          <RowCountMark
            mentionCount={mentions}
            count={thread.unreadReplyCount}
          />
        </span>
        <span className="sr-only">
          {mentions > 0 ? `${t("mentions", { count: mentions })}, ` : null}
          {t("unreadReplies", { count: thread.unreadReplyCount })}
        </span>
      </span>
    </Link>
  );
}

/**
 * A Thread the reader is part of with nothing unread, in the Threads view's
 * Earlier group: the room Thread list's read row (SOK-1158), the mark
 * without its circle and the name at normal weight, naming its room, its
 * replies and how long ago the last one came. Opens at its newest reply.
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
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { label, roomName } = useThreadRowNames(
    room,
    thread.parentContent,
    currentUserId,
  );

  return (
    <Link
      href={chatRoomMessageHref(room.id, thread.lastReplyId)}
      data-slot="earlier-thread-link"
      className="hover:bg-accent flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm"
    >
      <ThreadIconCircle tone="read" size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-muted-foreground line-clamp-2 min-w-0">
          {label}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {roomName}
          <span aria-hidden="true"> · </span>
          {tThread("replyCount", { count: thread.replyCount })}
          <span aria-hidden="true"> · </span>
          {format.relativeTime(new Date(thread.lastReplyAt), now)}
        </span>
      </span>
    </Link>
  );
}
