"use client";

import { CheckCheck, Inbox, Loader2, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useTransition } from "react";
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
import {
  UnreadThreadsList,
  useUnreadThreadsQuery,
} from "@/components/chat/unread-threads-list";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
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
import { useSidebarFlyout } from "@/hooks/use-sidebar-flyout";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

/** A row at rest, as the room rows draw theirs. */
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
  // Desktop only, and only while there is something to preview.
  const hasPanel = !isMobile && hasCount;
  const { open, setOpen, rowProps, contentProps } = useSidebarFlyout({
    enabled: hasPanel,
  });
  const panelHeadingId = useId();
  // Read ahead of the pointer, so the panel opens onto rows, not a spinner.
  useUnreadThreadsQuery({ rooms, enabled: hasPanel });
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

  // A link to the Threads page everywhere. On the phone that is all it is:
  // the Chats list fills the screen and leaves no side for a panel.
  const threadsRow = (
    <SidebarMenuButton
      asChild
      isActive={threadsActive}
      // On the rail the panel names the row, so a tooltip would race it to
      // the same spot. Without a panel the tooltip is all that names it.
      tooltip={hasPanel ? undefined : t("threads")}
    >
      {wrapLink(
        <Link
          {...rowProps}
          href={CHAT_THREADS_PATH}
          aria-current={threadsActive ? "page" : undefined}
          className={THREADS_ROW_CLASS}
        >
          {threadsRowContent}
        </Link>,
      )}
    </SidebarMenuButton>
  );

  return (
    <SidebarMenu className="gap-0" aria-label={t("label")}>
      <SidebarMenuItem className="relative">
        <div className="relative">
          {rail ? <RailAttentionPill variant={rail} /> : null}
          {threadsActive ? <SidebarRailSelectionBar /> : null}
          {hasPanel ? (
            // The Projects row's flyout (`useSidebarFlyout`): a click still
            // opens the page, the pointer or the arrow keys open the list
            // beside the row, so the reader checks their Threads without
            // leaving the room they are in.
            <Popover open={open} onOpenChange={setOpen} modal={false}>
              <PopoverAnchor asChild>{threadsRow}</PopoverAnchor>
              <PopoverContent
                side="right"
                align="start"
                sideOffset={8}
                aria-labelledby={panelHeadingId}
                className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 flex-col gap-2 overflow-y-auto p-2"
                {...contentProps}
                // Following a row opens its Thread in its room; the panel has
                // done its job there.
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) {
                    setOpen(false);
                  }
                }}
              >
                <p
                  id={panelHeadingId}
                  className="px-2 pt-1 text-sm font-semibold"
                >
                  {t("threads")}
                </p>
                <UnreadThreadsList
                  rooms={rooms}
                  roomsLive
                  currentUserId={currentUserId}
                />
                <div className="bg-border h-px" />
                <Link
                  href={CHAT_THREADS_PATH}
                  className="text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground block rounded-md px-2 py-1.5 text-sm outline-hidden focus-visible:ring-2"
                >
                  {t("allThreads")}
                </Link>
              </PopoverContent>
            </Popover>
          ) : (
            threadsRow
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
        {/* A mode, not a place: grey fill says "the page you are on", so
            the filter takes the primary tint the app uses for what is on
            and for the reader instead. */}
        <SidebarMenuButton asChild tooltip={t("allUnreads")}>
          <button
            type="button"
            aria-pressed={unreadOnly}
            data-filter-on={unreadOnly ? "true" : undefined}
            onClick={() => onUnreadOnlyChange(!unreadOnly)}
            className={
              unreadOnly
                ? "bg-primary-quaternary text-primary-variant hover:bg-primary-quaternary hover:text-primary-variant font-medium"
                : THREADS_ROW_CLASS
            }
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
              className={cn(
                CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME,
                "text-primary-variant",
              )}
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
