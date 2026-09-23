"use client";

import { Inbox, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  CHAT_THREADS_PATH,
  CHAT_UNREADS_PATH,
} from "@/app/chat/utils/chat-route-base";
import {
  RAIL_FLYOUT_CLOSE_DELAY_MS,
  RAIL_FLYOUT_OPEN_DELAY_MS,
  RailAttentionPill,
} from "@/components/chat/chat-room-sidebar-row";
import { MentionCountPill } from "@/components/chat/mention-count-pill";
import { resolveUnreadThreadsAttention } from "@/components/chat/room-attention";
import {
  ROOM_COUNT_CAP,
  roomCountLabel,
} from "@/components/chat/room-count-label";
import { UnreadThreadLink } from "@/components/chat/unread-thread-link";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRailSelectionBar,
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

/**
 * How many Threads the rail flyout lists before it points at the view. The
 * card is a glance, not the list; past this it says how many more wait there.
 */
const RAIL_FLYOUT_THREAD_CAP = 5;

interface ChatUnreadNavRowsProps {
  /** The sidebar's live rooms. The rows read these and nothing of their own. */
  rooms: readonly ChatRoom[];
  currentUserId: string;
  /** When false, render plain links (page-mounted list outside a Sheet). */
  dismissSheetOnNavigate?: boolean;
}

/**
 * The two entries above the channel list that gather every room's unread
 * (SOK-1159): Threads, the one place Thread unread drains to zero, and All
 * unreads beside it.
 *
 * Neither is a room, so neither has a room menu, and both stay on the
 * collapsed rail as permanent items. Threads carries the same one number a
 * room row does, in the same column: the `@` pill where a Thread names the
 * reader, the muted count of unread Threads otherwise, nothing at zero. On
 * the rail it wears the room rows' edge pill, and its flyout lists the
 * Threads with the room each is in, since the rail has no nesting to say so.
 *
 * On the phone the list this sits in is the Chats tab, so both land there,
 * above the rooms, with no tab of their own.
 */
export function ChatUnreadNavRows({
  rooms,
  currentUserId,
  dismissSheetOnNavigate = true,
}: ChatUnreadNavRowsProps) {
  const t = useTranslations("App.Channels.UnreadNav");
  const tChannels = useTranslations("App.Channels");
  const pathname = usePathname();
  const { state: sidebarState, isMobile } = useSidebar();
  const { threadCount, mentionCount, rail } =
    resolveUnreadThreadsAttention(rooms);
  const wrapLink = (link: ReactNode) =>
    dismissSheetOnNavigate ? <SheetClose asChild>{link}</SheetClose> : link;

  const threadsActive = pathname === CHAT_THREADS_PATH;
  const unreadsActive = pathname === CHAT_UNREADS_PATH;
  const hasCount = threadCount > 0;

  const threadsLink = (
    <Link
      href={CHAT_THREADS_PATH}
      aria-current={threadsActive ? "page" : undefined}
      className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <SidebarRowSlot>
        <MessagesSquare className="size-4" aria-hidden />
        {rail ? (
          <span className="sr-only hidden group-data-[collapsible=icon]:block">
            {rail === "mention"
              ? tChannels("RoomMentions.railMention")
              : tChannels("RoomUnread.railUnread")}
          </span>
        ) : null}
      </SidebarRowSlot>
      <span
        className={cn(
          SIDEBAR_ROW_LABEL_CLASS,
          "truncate",
          hasCount && "text-foreground font-semibold",
        )}
      >
        {t("threads")}
      </span>
      {hasCount ? (
        <span className="group-data-[collapsible=icon]:hidden sr-only">
          {mentionCount > 0
            ? `${t("mentions", { count: mentionCount })}, `
            : null}
          {threadCount > ROOM_COUNT_CAP
            ? t("unreadThreadsCapped", { max: ROOM_COUNT_CAP })
            : t("unreadThreads", { count: threadCount })}
        </span>
      ) : null}
      {/* Holds the name clear of the count, drawn in the room pill's column. */}
      {hasCount ? (
        <span
          aria-hidden
          className="group-data-[collapsible=icon]:hidden size-4 shrink-0 [@media(hover:none)]:size-8 [@media(hover:none)]:md:size-7"
        />
      ) : null}
    </Link>
  );

  const threadsButton = (
    <SidebarMenuButton
      asChild
      isActive={threadsActive}
      tooltip={
        sidebarState === "collapsed" && !isMobile && hasCount
          ? undefined
          : t("threads")
      }
    >
      {wrapLink(threadsLink)}
    </SidebarMenuButton>
  );

  // The rail loses the rows inset under each room, so this card lists them
  // across rooms, each naming its room. A pointer surface only, as the room
  // rows' flyout is: the keyboard and touch reach the same Threads through
  // the view the entry opens.
  const flyoutThreads = rooms
    .filter((room) => room.mutedAt == null)
    .flatMap((room) =>
      (room.unreadThreads ?? []).map((thread) => ({ room, thread })),
    )
    .slice(0, RAIL_FLYOUT_THREAD_CAP);
  const flyoutRemainder = threadCount - flyoutThreads.length;

  return (
    <SidebarMenu className="gap-0" aria-label={t("label")}>
      <SidebarMenuItem className="relative">
        <div className="relative">
          {rail ? <RailAttentionPill variant={rail} /> : null}
          {threadsActive ? <SidebarRailSelectionBar /> : null}
          {sidebarState === "collapsed" && !isMobile && hasCount ? (
            <HoverCard
              openDelay={RAIL_FLYOUT_OPEN_DELAY_MS}
              closeDelay={RAIL_FLYOUT_CLOSE_DELAY_MS}
            >
              <HoverCardTrigger asChild>{threadsButton}</HoverCardTrigger>
              <HoverCardContent
                side="right"
                align="start"
                sideOffset={12}
                className="w-72 p-2"
              >
                <p className="truncate px-2 pb-1 text-xs font-semibold">
                  {t("threads")}
                </p>
                <ul className="flex flex-col gap-px">
                  {flyoutThreads.map(({ room, thread }) => (
                    <li key={thread.parentMessageId}>
                      <UnreadThreadLink
                        thread={thread}
                        room={room}
                        currentUserId={currentUserId}
                        size="sm"
                      />
                    </li>
                  ))}
                </ul>
                {flyoutRemainder > 0 ? (
                  <Link
                    href={CHAT_THREADS_PATH}
                    className="text-muted-foreground hover:bg-accent block rounded-md px-2 py-1.5 text-xs"
                  >
                    {t("moreThreads", { count: flyoutRemainder })}
                  </Link>
                ) : null}
              </HoverCardContent>
            </HoverCard>
          ) : (
            threadsButton
          )}
          {hasCount ? (
            <span
              aria-hidden
              data-slot="unread-threads-count"
              className="group-data-[collapsible=icon]:hidden pointer-events-none absolute top-1/2 right-1 z-10 flex size-8 -translate-y-1/2 items-center justify-center md:size-7"
            >
              {mentionCount > 0 ? (
                <MentionCountPill count={mentionCount} />
              ) : (
                <span className="text-muted-foreground text-[0.625rem] leading-4 font-semibold tabular-nums">
                  {roomCountLabel(threadCount)}
                </span>
              )}
            </span>
          ) : null}
        </div>
      </SidebarMenuItem>
      <SidebarMenuItem className="relative">
        {unreadsActive ? <SidebarRailSelectionBar /> : null}
        <SidebarMenuButton
          asChild
          isActive={unreadsActive}
          tooltip={t("allUnreads")}
        >
          {wrapLink(
            <Link
              href={CHAT_UNREADS_PATH}
              aria-current={unreadsActive ? "page" : undefined}
              className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <SidebarRowSlot>
                <Inbox className="size-4" aria-hidden />
              </SidebarRowSlot>
              <span className={cn(SIDEBAR_ROW_LABEL_CLASS, "truncate")}>
                {t("allUnreads")}
              </span>
            </Link>,
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
