"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { getRoomDisplayName } from "@/app/chat/components/room-helpers";
import { roomMentionNames } from "@/app/chat/utils/room-mention-names";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import { MentionCountPill } from "@/components/chat/mention-count-pill";
import { roomCountLabel } from "@/components/chat/room-count-label";
import { ThreadIconCircle } from "@/components/chat/thread-icon-circle";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
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
  /**
   * `md` is the Threads view's row, in the room Thread list's style (SOK-1158).
   * `sm` is the collapsed rail's flyout, as tight as the inset rows it stands
   * in for.
   */
  size: "sm" | "md";
  /** Wraps the link, so a mobile sheet can close when it is followed. */
  wrapLink?: (link: ReactNode) => ReactNode;
}

/**
 * One unread Thread that names its room, for the surfaces that gather
 * Threads from every room (SOK-1159): the Threads view and the rail flyout
 * on the Threads entry. Under a room the room goes without saying, and
 * `ChatRoomThreadRows` draws those; here it is what replaces the nesting.
 *
 * The link is the one a chat notification uses, the Thread's first unread
 * reply, so opening it Looks the Thread through the room's existing path and
 * the row drains on the next read of the rooms.
 *
 * One number, as on every sidebar row: the `@` pill where a reply names the
 * reader, the muted count of unread replies otherwise. Both are announced.
 */
export function UnreadThreadLink({
  thread,
  room,
  currentUserId,
  size,
  wrapLink = (link) => link,
}: UnreadThreadLinkProps) {
  const t = useTranslations("App.Channels.ThreadRows");
  const tChannels = useTranslations("App.Channels");
  const mentions = thread.unreadMentionCount ?? 0;
  const roomName = getRoomDisplayName(
    room,
    currentUserId,
    tChannels("SelfDirect.you"),
  );
  const label =
    formatUnreadThreadsPreview(
      thread.parentContent,
      roomMentionNames(room, tChannels("MentionAll.label")),
    ) || t("untitled");

  return wrapLink(
    <Link
      href={chatRoomMessageHref(room.id, thread.firstUnreadReplyId)}
      data-slot="unread-thread-link"
      data-mention={mentions > 0 ? "true" : undefined}
      className={cn(
        "hover:bg-accent flex w-full min-w-0 items-start rounded-md text-left",
        size === "md"
          ? "bg-card-background gap-2.5 px-2 py-2 text-sm"
          : "gap-2 px-2 py-1.5 text-xs",
      )}
    >
      {/* The Thread list tints every unread row; the flyout keeps the inset
          rows' rule, where only a Thread that names the reader turns primary. */}
      <ThreadIconCircle
        tone={size === "md" || mentions > 0 ? "attention" : "quiet"}
        glyph={mentions > 0 ? "mention" : "thread"}
        size={size}
        className={size === "sm" ? "mt-px" : undefined}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "text-foreground min-w-0 font-semibold",
            size === "md" ? "line-clamp-2" : "truncate",
          )}
        >
          {label}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {room.kind === "channel" ? `#${roomName}` : roomName}
        </span>
      </span>
      <span className="flex w-7 shrink-0 justify-center pt-px">
        <span aria-hidden>
          {mentions > 0 ? (
            <MentionCountPill count={mentions} />
          ) : (
            <span className="text-muted-foreground text-[0.625rem] leading-4 font-semibold tabular-nums">
              {roomCountLabel(thread.unreadReplyCount)}
            </span>
          )}
        </span>
        <span className="sr-only">
          {mentions > 0 ? `${t("mentions", { count: mentions })}, ` : null}
          {t("unreadReplies", { count: thread.unreadReplyCount })}
        </span>
      </span>
    </Link>,
  );
}
