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
import { MentionCountPill } from "@/components/chat/mention-count-pill";
import {
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

interface ChatRoomThreadRowsProps {
  /** A room, or as much of one as the rows read. */
  room: Pick<ChatRoom, "id"> &
    Partial<Pick<ChatRoom, "unreadThreads" | "unreadThreadCount">> &
    RoomMentionRoster;
  /** The room's name as its row shows it, for the list's accessible name. */
  roomLabel: string;
  /**
   * The reader is in this room already. The room takes each ask straight back
   * off its URL, so from inside it a pushed entry would leave Back landing on
   * the view the reader is on. The row's Edit item replaces for the same
   * reason.
   */
  isActive?: boolean;
  /**
   * Where the rows sit. `inset` is under the room's row in the expanded
   * sidebar. `flyout` is the card beside the room's mark on the collapsed
   * rail, where there is no row to be inset under, so the rule and the indent
   * that tie the rows to one go.
   */
  variant?: "inset" | "flyout";
  /** Wraps each link, so a mobile sheet can close when one is followed. */
  wrapLink?: (link: ReactNode) => ReactNode;
}

type UnreadThread = NonNullable<ChatRoom["unreadThreads"]>[number];

/** Absent on a room snapshot taken before Core counted it. */
function mentionCount(thread: UnreadThread): number {
  return thread.unreadMentionCount ?? 0;
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
 * Inset, the sub-menu primitive hides them on the collapsed rail. There the
 * same rows ride a flyout instead, which is portalled out of the sidebar and
 * so out of reach of that rule.
 */
export function ChatRoomThreadRows({
  room,
  roomLabel,
  isActive = false,
  variant = "inset",
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
      data-variant={variant}
      aria-label={t("label", { name: roomLabel })}
      // Rows a pixel apart: they read as one group under their room, where
      // the primitive's wider gap reads as a second list of destinations.
      // Indented from the left only. The primitive insets both sides, which
      // cut the rows short of the room row's right edge and gave a Thread's
      // name less room than the room's own.
      //
      // On the room row's two axes (`SIDEBAR_ROW_CLASS`): the rule hangs from
      // the leading mark, whose slot is centred 20px in, and the Thread icons
      // start on the label column at 40px. The primitive's own 14px and 10px
      // put the rule and the icons beside those axes rather than on them.
      // 18px margin plus the primitive's 1px nudge lands the rule on 19-20px;
      // 13px of padding lands the icon, past its link's padding, on 40px.
      // The flyout has no room row above it, so it drops the rule and both.
      className={cn(
        "mr-0 ml-[1.125rem] gap-px pr-0 pl-[0.8125rem]",
        variant === "flyout" && "mx-0 border-l-0 px-0 py-0",
      )}
    >
      {threads.map((thread) => {
        const mentions = mentionCount(thread);
        return (
          <SidebarMenuSubItem key={thread.parentMessageId}>
            {wrapLink(
              <SidebarMenuSubButton asChild size="sm" className="pr-1">
                <Link
                  href={chatRoomMessageHref(room.id, thread.firstUnreadReplyId)}
                  replace={isActive}
                  data-mention={mentions > 0 ? "true" : undefined}
                >
                  {/* Unread is a tinted icon circle plus weight, the language
                    the notification rows and the thread list already use.
                    Never a dot. */}
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-[1.125rem] shrink-0 place-items-center rounded-full",
                      // A Thread that names the reader takes the mention's
                      // amber, so it stands out from the room's other unread
                      // Threads the way the room's badge does from its count.
                      mentions > 0
                        ? "bg-mention-quaternary text-mention-label"
                        : "bg-primary-quaternary text-primary",
                    )}
                  >
                    <MessageSquare className="size-[0.6875rem]" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {formatUnreadThreadsPreview(
                      thread.parentContent,
                      mentionNames,
                    ) || t("untitled")}
                  </span>
                  {mentions > 0 ? (
                    <span className="shrink-0">
                      <span aria-hidden>
                        <MentionCountPill count={mentions} tone="mention" />
                      </span>
                      <span className="sr-only">
                        {t("mentions", { count: mentions })}
                      </span>
                    </span>
                  ) : null}
                  {/* In the room badge's own column: a 28px box ending 4px
                      from the row's edge, its number centred, so a Thread's
                      count stacks under its room's badge, not outside it. */}
                  <span className="text-primary w-7 shrink-0 text-center text-[0.6875rem] font-semibold tabular-nums">
                    <span aria-hidden>{thread.unreadReplyCount}</span>
                    <span className="sr-only">
                      {t("unreadReplies", { count: thread.unreadReplyCount })}
                    </span>
                  </span>
                </Link>
              </SidebarMenuSubButton>,
            )}
          </SidebarMenuSubItem>
        );
      })}
      {remainder > 0 ? (
        <SidebarMenuSubItem>
          {wrapLink(
            <SidebarMenuSubButton asChild size="sm">
              <Link
                href={chatRoomThreadListHref(room.id)}
                replace={isActive}
                // Starts on the labels' column: past the row's padding, the
                // icon circle and the gap after it.
                className="text-muted-foreground pl-[2.125rem]"
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
