"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { chatRoomThreadListHref } from "@/app/chat/utils/chat-route-base";
import {
  type RoomMentionRoster,
  roomMentionNames,
} from "@/app/chat/utils/room-mention-names";
import { formatUnreadThreadsPreview } from "@/app/chat/utils/unread-threads-preview";
import {
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

interface ChatRoomThreadRowsProps {
  /** A room, or as much of one as the rows read. */
  room: Pick<ChatRoom, "id"> &
    Partial<Pick<ChatRoom, "unreadThreads" | "unreadThreadCount">> &
    RoomMentionRoster;
  /** The room's name as its row shows it, for the list's accessible name. */
  roomLabel: string;
  /** Wraps each link, so a mobile sheet can close when one is followed. */
  wrapLink?: (link: ReactNode) => ReactNode;
}

/**
 * The unread Threads of one room, inset under its sidebar row (ADR-0037).
 *
 * Present only while a Thread is unread, so the sidebar goes back to being a
 * list of rooms the moment the reader is caught up. That is why these carry
 * no persistent nav weight and need no empty state.
 *
 * Each row is a link to the Thread's first unread reply, the same URL a chat
 * notification uses, so opening one needs no second route shape. Core caps
 * the list; the overflow row states what the cap left out and opens the
 * room's thread list.
 *
 * Hidden on the collapsed rail by the sub-menu primitive.
 */
export function ChatRoomThreadRows({
  room,
  roomLabel,
  wrapLink = (link) => link,
}: ChatRoomThreadRowsProps) {
  const t = useTranslations("App.Channels.ThreadRows");
  const tChannels = useTranslations("App.Channels");
  const threads = room.unreadThreads ?? [];
  if (threads.length === 0) {
    return null;
  }

  const mentionNames = roomMentionNames(room, tChannels("MentionAll.label"));
  const remainder = Math.max(
    0,
    (room.unreadThreadCount ?? threads.length) - threads.length,
  );

  return (
    <SidebarMenuSub
      data-slot="room-thread-rows"
      aria-label={t("label", { name: roomLabel })}
    >
      {threads.map((thread) => (
        <SidebarMenuSubItem key={thread.parentMessageId}>
          {wrapLink(
            <SidebarMenuSubButton asChild size="sm">
              <Link
                href={chatRoomMessageHref(room.id, thread.firstUnreadReplyId)}
              >
                <MessageSquare aria-hidden />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {formatUnreadThreadsPreview(
                    thread.parentContent,
                    mentionNames,
                  ) || t("untitled")}
                </span>
                <span className="text-primary shrink-0 font-semibold tabular-nums">
                  <span aria-hidden>{thread.unreadReplyCount}</span>
                  <span className="sr-only">
                    {t("unreadReplies", { count: thread.unreadReplyCount })}
                  </span>
                </span>
              </Link>
            </SidebarMenuSubButton>,
          )}
        </SidebarMenuSubItem>
      ))}
      {remainder > 0 ? (
        <SidebarMenuSubItem>
          {wrapLink(
            <SidebarMenuSubButton asChild size="sm">
              <Link
                href={chatRoomThreadListHref(room.id)}
                className="text-muted-foreground"
              >
                <span>{t("moreThreads", { count: remainder })}</span>
              </Link>
            </SidebarMenuSubButton>,
          )}
        </SidebarMenuSubItem>
      ) : null}
    </SidebarMenuSub>
  );
}
