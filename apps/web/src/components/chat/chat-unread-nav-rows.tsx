"use client";

import { AnnouncedFeature, type ChatRoom } from "@sokosumi/core-client";
import { CheckCheck, Inbox, Loader2, Sunrise } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useTransition,
} from "react";
import { toast } from "sonner";
import { markAllChatUnreadReadAction } from "@/app/chat/actions";
import { CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME } from "@/app/chat/components/chat-compose-dialog";
import { CHAT_CATCH_UP_PATH } from "@/app/chat/utils/chat-route-base";
import { useMarkFeatureSeen } from "@/app/components/sidebar/components/feature-badges";
import { RailAttentionPill } from "@/components/chat/chat-room-sidebar-row";
import {
  NeedsYouPill,
  RowCountMark,
} from "@/components/chat/mention-count-pill";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  resolveUnreadThreadsAttention,
  roomUnreadReads,
} from "@/components/chat/room-attention";
import { ROOM_COUNT_CAP } from "@/components/chat/room-count-label";
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
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

/** A row at rest, as the room rows draw theirs. */
const THREADS_ROW_CLASS =
  "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

interface ChatUnreadNavRowsProps {
  /** The sidebar's live rooms. The row reads these and nothing of its own. */
  rooms: readonly ChatRoom[];
  /** When false, render plain links (page-mounted list outside a Sheet). */
  dismissSheetOnNavigate?: boolean;
  /** The All unreads filter: the list below shows only rooms with unread. */
  unreadOnly: boolean;
  onUnreadOnlyChange: (unreadOnly: boolean) => void;
}

/**
 * One entry above the channel list for everything the reader missed: Catch
 * up opens the written overview and the unread Threads (tabs of one page).
 * Its count is what waits on the reader (the needs-you pill), else the
 * Threads mark: the `@` pill where a Thread names them, the muted count of
 * unread Threads otherwise. The inbox button at its end is the All unreads
 * filter on the list below (⌘⇧U); while it is on, Mark all as read stands
 * beside it.
 */
export function ChatUnreadNavRows({
  rooms,
  dismissSheetOnNavigate = true,
  unreadOnly,
  onUnreadOnlyChange,
}: ChatUnreadNavRowsProps) {
  const t = useTranslations("App.Channels.UnreadNav");
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  // The filter's keyboard path (SOK-1201), split by platform as every web
  // hotkey here is: ⌘⇧U on Apple, Ctrl+Shift+U elsewhere. Below the mobile
  // breakpoint there is no physical keyboard to press it.
  const isApplePlatform = useIsApplePlatform();
  const showsShortcut = !isMobile;
  const shortcutLabel = isApplePlatform ? "⌘⇧U" : "Ctrl+Shift+U";
  const shortcutKeys = isApplePlatform ? "Meta+Shift+U" : "Control+Shift+U";
  const shortcutHint = t("allUnreadsShortcut", { shortcut: shortcutLabel });
  const markFeatureSeen = useMarkFeatureSeen();
  function toggleUnreadOnly() {
    markFeatureSeen(AnnouncedFeature.UNREADS);
    onUnreadOnlyChange(!unreadOnly);
  }
  const toggleFromKeyboard = useEffectEvent(toggleUnreadOnly);

  // The same toggle the button runs, from the keyboard: ⌘⇧U / Ctrl+Shift+U is
  // no browser default (checked against Chrome, Safari, Firefox and Edge).
  // Editable targets keep their "u" for text and, on Linux, their Ctrl+Shift+U
  // Unicode input, so the shortcut stands down there.
  useEffect(() => {
    if (!showsShortcut) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key?.toLowerCase() !== "u" || event.repeat) {
        return;
      }
      const hostModifier = isApplePlatform ? event.metaKey : event.ctrlKey;
      if (!hostModifier || !event.shiftKey || event.altKey) {
        return;
      }
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      event.preventDefault();
      toggleFromKeyboard();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showsShortcut, isApplePlatform]);

  const { threadCount, mentionCount, rail } =
    resolveUnreadThreadsAttention(rooms);
  const wrapLink = (link: ReactNode) =>
    dismissSheetOnNavigate ? <SheetClose asChild>{link}</SheetClose> : link;

  const catchUpActive = pathname.startsWith(CHAT_CATCH_UP_PATH);
  const tSignals = useTranslations("App.Channels.Signals");
  // Everything waiting on the reader, across the rooms they have not muted.
  const needsYouTotal = rooms.reduce(
    (sum, room) =>
      room.mutedAt == null ? sum + (room.unreadNeedsYouCount ?? 0) : sum,
    0,
  );
  const railMark = needsYouTotal > 0 ? "mention" : rail;
  const [isMarking, startMarking] = useTransition();
  const markAllTargets = rooms
    .map((room) => ({ roomId: room.id, ...roomUnreadReads(room) }))
    .filter((target) => target.readRoom || target.lookThreads);
  const showMarkAll = unreadOnly && markAllTargets.length > 0;
  // While the filter is on, the list below is the count; the row makes room
  // for Mark all instead.
  const showCount = !unreadOnly && (needsYouTotal > 0 || threadCount > 0);

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

  return (
    <SidebarMenu className="gap-0" aria-label={t("label")}>
      <SidebarMenuItem className="relative">
        {railMark ? <RailAttentionPill variant={railMark} /> : null}
        {catchUpActive ? <SidebarRailSelectionBar /> : null}
        <SidebarMenuButton
          asChild
          isActive={catchUpActive}
          tooltip={tSignals("catchUp")}
        >
          {wrapLink(
            <Link
              href={CHAT_CATCH_UP_PATH}
              aria-current={catchUpActive ? "page" : undefined}
              className={THREADS_ROW_CLASS}
              data-testid="chat-catch-up-row"
            >
              <SidebarRowSlot>
                <Sunrise className="size-4" aria-hidden />
              </SidebarRowSlot>
              <span
                className={cn(
                  SIDEBAR_ROW_LABEL_CLASS,
                  (needsYouTotal > 0 || mentionCount > 0) &&
                    "text-foreground font-semibold",
                )}
              >
                {tSignals("catchUp")}
              </span>
              {needsYouTotal > 0 ? (
                <span className="sr-only">
                  {tSignals("needsYouCount", { count: needsYouTotal })}
                </span>
              ) : null}
              {threadCount > 0 ? (
                <span className="sr-only">
                  {mentionCount > 0
                    ? `${t("mentions", { count: mentionCount })}, `
                    : null}
                  {threadCount > ROOM_COUNT_CAP
                    ? t("unreadThreadsCapped", { max: ROOM_COUNT_CAP })
                    : t("unreadThreads", { count: threadCount })}
                </span>
              ) : null}
              {showCount ? (
                <span
                  aria-hidden
                  data-slot="catch-up-count"
                  className="group-data-[collapsible=icon]:hidden flex size-7 shrink-0 items-center justify-center"
                >
                  {needsYouTotal > 0 ? (
                    <NeedsYouPill count={needsYouTotal} />
                  ) : (
                    <RowCountMark
                      mentionCount={mentionCount}
                      count={threadCount}
                    />
                  )}
                </span>
              ) : null}
              {/* Holds the label clear of the buttons drawn over the end. */}
              <span
                aria-hidden
                className={cn(
                  "group-data-[collapsible=icon]:hidden shrink-0",
                  showMarkAll ? "w-14" : "w-7",
                )}
              />
            </Link>,
          )}
        </SidebarMenuButton>
        <div className="group-data-[collapsible=icon]:hidden absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center">
          {showMarkAll ? (
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
          ) : null}
          {/* A mode, not a place: on, it takes the primary tint the app uses
              for what is on. Before React reads the remembered filter, the
              boot script's mark tints it the same way. */}
          <button
            type="button"
            aria-label={t("allUnreads")}
            aria-pressed={unreadOnly}
            aria-keyshortcuts={showsShortcut ? shortcutKeys : undefined}
            title={showsShortcut ? shortcutHint : t("allUnreads")}
            data-filter-on={unreadOnly ? "true" : undefined}
            onClick={toggleUnreadOnly}
            className={cn(
              CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME,
              unreadOnly
                ? "bg-primary-quaternary text-primary-variant hover:bg-primary-quaternary hover:text-primary-variant active:bg-primary-quaternary"
                : "chat-unreads-boot:bg-primary-quaternary chat-unreads-boot:text-primary-variant",
            )}
          >
            <Inbox className="size-4 md:size-3.5" aria-hidden />
          </button>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
