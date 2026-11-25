"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CHAT_FEED_PATH } from "@/app/chat/utils/chat-route-base";
import { ChatUnreadNavRows } from "@/components/chat/chat-unread-nav-rows";
import { RowCountMark } from "@/components/chat/mention-count-pill";
import { ROOM_COUNT_CAP } from "@/components/chat/room-count-label";
import { useFeedUnreadCount } from "@/components/chat/use-feed-unread-count";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import { useNavPathname } from "@/components/navigation-progress.client";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ROW_LABEL_CLASS,
  SIDEBAR_ROW_LINK_CLASS,
} from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";

const NO_ROOMS: never[] = [];

interface FeedRoomsProps {
  currentUserId: string;
  organizationId: string | null;
  /** When false, render plain links (page-mounted list outside a Sheet). */
  dismissSheetOnNavigate?: boolean;
}

/**
 * The chat block of the sidebar in feed mode: the Feed row with its unread
 * count, then the Catch up row. It stands where the room list stands
 * otherwise and mounts no room list. The Catch up row counts from the app
 * frame's live rooms, which read the room collection on their own schedule.
 */
export function FeedRooms({
  currentUserId,
  organizationId,
  dismissSheetOnNavigate = true,
}: FeedRoomsProps) {
  const t = useTranslations("App.Channels.Feed");
  const pathname = useNavPathname();
  // The app frame's live rooms: the Catch up row counts from them.
  const rooms = useLiveChatRooms() ?? NO_ROOMS;
  const { unreadCount, showCount } = useFeedUnreadCount({
    currentUserId,
    organizationId,
  });
  const active = pathname.startsWith(CHAT_FEED_PATH);
  const wrapLink = (link: ReactNode) =>
    dismissSheetOnNavigate ? <SheetClose asChild>{link}</SheetClose> : link;

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent className="space-y-2">
        <SidebarMenu className="gap-0" aria-label={t("title")}>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={active}>
              {wrapLink(
                <Link
                  href={CHAT_FEED_PATH}
                  aria-current={active ? "page" : undefined}
                  className={SIDEBAR_ROW_LINK_CLASS}
                  data-testid="chat-feed-row"
                >
                  <SidebarRowSlot>
                    <Inbox aria-hidden />
                  </SidebarRowSlot>
                  <span
                    className={cn(
                      SIDEBAR_ROW_LABEL_CLASS,
                      unreadCount > 0 && "text-foreground font-semibold",
                    )}
                  >
                    {t("title")}
                  </span>
                  {/* Spoken only when the reader shows counts, like a room
                      row; bold still marks the label as unread. */}
                  {showCount && unreadCount > 0 ? (
                    <span className="sr-only">
                      {unreadCount > ROOM_COUNT_CAP
                        ? t("unreadCountCapped", { max: ROOM_COUNT_CAP })
                        : t("unreadCount", { count: unreadCount })}
                    </span>
                  ) : null}
                  {showCount && unreadCount > 0 ? (
                    <span
                      aria-hidden
                      data-slot="feed-count"
                      className="flex size-7 shrink-0 items-center justify-center"
                    >
                      <RowCountMark mentionCount={0} count={unreadCount} />
                    </span>
                  ) : null}
                </Link>,
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <ChatUnreadNavRows
          rooms={rooms}
          markAllRooms={rooms}
          dismissSheetOnNavigate={dismissSheetOnNavigate}
          unreadOnly={false}
        />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
