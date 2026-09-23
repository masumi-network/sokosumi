"use client";

import { CheckCheck, Inbox, Loader2, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useTransition } from "react";
import { toast } from "sonner";

import { markAllChatUnreadReadAction } from "@/app/chat/actions";
import { CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME } from "@/app/chat/components/chat-compose-dialog";
import { CHAT_THREADS_PATH } from "@/app/chat/utils/chat-route-base";
import { RailAttentionPill } from "@/components/chat/chat-room-sidebar-row";
import { RowCountMark } from "@/components/chat/mention-count-pill";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  RAIL_FLYOUT_CLOSE_DELAY_MS,
  RAIL_FLYOUT_OPEN_DELAY_MS,
} from "@/components/chat/rail-flyout-delays";
import {
  resolveUnreadThreadsAttention,
  roomUnreadReads,
} from "@/components/chat/room-attention";
import { ROOM_COUNT_CAP } from "@/components/chat/room-count-label";
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
  /** The All unreads filter: the list below shows only rooms with unread. */
  unreadOnly: boolean;
  onUnreadOnlyChange: (unreadOnly: boolean) => void;
}

/**
 * The two entries above the channel list that gather every room's unread
 * (SOK-1159): Threads, the one place Thread unread drains to zero, and All
 * unreads, a filter on the list below that keeps only rooms with unread.
 * While the filter is on, Mark all as read stands on its row, in the slot a
 * section heading keeps its `+`.
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
  unreadOnly,
  onUnreadOnlyChange,
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
  const hasCount = threadCount > 0;
  const [isMarking, startMarking] = useTransition();
  const markAllTargets = rooms
    .map((room) => ({ roomId: room.id, ...roomUnreadReads(room) }))
    .filter((target) => target.readRoom || target.lookThreads);

  function handleMarkAllRead() {
    startMarking(async () => {
      const result = await markAllChatUnreadReadAction(markAllTargets);
      if (!result.ok) {
        toast.error(t("markAllReadError"));
      }
      // What Core holds now, part-read or not, is what the rooms show next.
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });
  }

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
              <RowCountMark mentionCount={mentionCount} count={threadCount} />
            </span>
          ) : null}
        </div>
      </SidebarMenuItem>
      <SidebarMenuItem className="relative">
        <SidebarMenuButton
          asChild
          isActive={unreadOnly}
          tooltip={t("allUnreads")}
        >
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => onUnreadOnlyChange(!unreadOnly)}
            className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <SidebarRowSlot>
              <Inbox className="size-4" aria-hidden />
            </SidebarRowSlot>
            <span className={cn(SIDEBAR_ROW_LABEL_CLASS, "truncate")}>
              {t("allUnreads")}
            </span>
            {unreadOnly ? (
              <span className="sr-only">{t("filterOn")}</span>
            ) : null}
          </button>
        </SidebarMenuButton>
        {unreadOnly && markAllTargets.length > 0 ? (
          <div className="group-data-[collapsible=icon]:hidden absolute top-1/2 right-1 z-10 -translate-y-1/2">
            <button
              type="button"
              aria-label={t("markAllRead")}
              title={t("markAllRead")}
              disabled={isMarking}
              aria-busy={isMarking}
              onClick={handleMarkAllRead}
              className={CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME}
            >
              {isMarking ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-none md:size-3.5"
                  aria-hidden
                />
              ) : (
                <CheckCheck className="size-4 md:size-3.5" aria-hidden />
              )}
            </button>
          </div>
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
