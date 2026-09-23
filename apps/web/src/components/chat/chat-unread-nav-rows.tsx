"use client";

import { CheckCheck, Inbox, Loader2, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";

import { markAllChatUnreadReadAction } from "@/app/chat/actions";
import { CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME } from "@/app/chat/components/chat-compose-dialog";
import { CHAT_THREADS_PATH } from "@/app/chat/utils/chat-route-base";
import { RailAttentionPill } from "@/components/chat/chat-room-sidebar-row";
import { RowCountMark } from "@/components/chat/mention-count-pill";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  resolveUnreadThreadsAttention,
  roomUnreadReads,
} from "@/components/chat/room-attention";
import { ROOM_COUNT_CAP } from "@/components/chat/room-count-label";
import { UnreadThreadsList } from "@/components/chat/unread-threads-list";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

const THREADS_ROW_CLASS =
  "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

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
 * the rail it wears the room rows' edge pill. On the desktop it opens the
 * unread Threads in a popover beside it, each naming its room; on the phone
 * it goes to the Threads page.
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
  const { isMobile } = useSidebar();
  const { threadCount, mentionCount, rail } =
    resolveUnreadThreadsAttention(rooms);
  const wrapLink = (link: ReactNode) =>
    dismissSheetOnNavigate ? <SheetClose asChild>{link}</SheetClose> : link;

  const threadsActive = pathname === CHAT_THREADS_PATH;
  const hasCount = threadCount > 0;
  const [isMarking, startMarking] = useTransition();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const markAllTargets = rooms
    .map((room) => ({ roomId: room.id, ...roomUnreadReads(room) }))
    .filter((target) => target.readRoom || target.lookThreads);
  const showMarkAll = unreadOnly && markAllTargets.length > 0;

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

  // What the row holds, whichever element carries it: a link on the phone,
  // the popover's trigger on the desktop sidebar and rail.
  const threadsRowContent = (
    <>
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
    </>
  );

  return (
    <SidebarMenu className="gap-0" aria-label={t("label")}>
      <SidebarMenuItem className="relative">
        <div className="relative">
          {rail ? <RailAttentionPill variant={rail} /> : null}
          {threadsActive || threadsOpen ? <SidebarRailSelectionBar /> : null}
          {isMobile ? (
            // The phone's list fills the screen, so there is no side for a
            // popover to open into: the entry goes to the Threads page.
            <SidebarMenuButton
              asChild
              isActive={threadsActive}
              tooltip={t("threads")}
            >
              {wrapLink(
                <Link
                  href={CHAT_THREADS_PATH}
                  aria-current={threadsActive ? "page" : undefined}
                  className={THREADS_ROW_CLASS}
                >
                  {threadsRowContent}
                </Link>,
              )}
            </SidebarMenuButton>
          ) : (
            // Desktop, expanded and rail alike: the list opens beside the
            // row, so the reader checks their Threads without leaving the
            // room they are in. A click popover, so the keyboard reaches it
            // too, which the room rows' hover flyout does not allow.
            <Popover open={threadsOpen} onOpenChange={setThreadsOpen}>
              <SidebarMenuButton
                asChild
                isActive={threadsActive || threadsOpen}
                tooltip={t("threads")}
              >
                <PopoverTrigger asChild>
                  <button type="button" className={THREADS_ROW_CLASS}>
                    {threadsRowContent}
                  </button>
                </PopoverTrigger>
              </SidebarMenuButton>
              <PopoverContent
                side="right"
                align="start"
                sideOffset={12}
                aria-label={t("threads")}
                className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 flex-col gap-2 overflow-y-auto p-2"
                // Following a row opens its Thread in its room; the list has
                // done its job there.
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) {
                    setThreadsOpen(false);
                  }
                }}
              >
                <p className="px-2 pt-1 text-sm font-semibold">
                  {t("threads")}
                </p>
                {threadsOpen ? (
                  <UnreadThreadsList
                    rooms={rooms}
                    roomsLive
                    currentUserId={currentUserId}
                  />
                ) : null}
              </PopoverContent>
            </Popover>
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
            {/* Mark all stands over the row's end, so the label stops short
                of it rather than running underneath. */}
            {showMarkAll ? (
              <span
                aria-hidden
                data-slot="mark-all-spacer"
                className="group-data-[collapsible=icon]:hidden size-7 shrink-0"
              />
            ) : null}
          </button>
        </SidebarMenuButton>
        {showMarkAll ? (
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
