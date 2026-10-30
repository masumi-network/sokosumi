"use client";

import { AnnouncedFeature, type ChatRoom } from "@sokosumi/core-client";
import { CheckCheck, Loader2, Sunrise } from "lucide-react";
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
import { CHAT_CATCH_UP_PATH } from "@/app/chat/utils/chat-route-base";
import { useMarkFeatureSeen } from "@/app/components/sidebar/components/feature-badges";
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
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_ICON_ACTION_CLASS,
  SIDEBAR_ROW_LABEL_CLASS,
  SIDEBAR_ROW_LINK_CLASS,
} from "@/components/ui/sidebar-classes";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { cn } from "@/lib/utils";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

/**
 * The Unreads chip: a word, not an icon, so it says what it filters. Its
 * pseudo-element keeps the target at 44px on phones and 28px from md, as the
 * icon buttons beside it do.
 */
const UNREADS_CHIP_CLASS =
  "text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative flex h-7 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap transition-colors before:absolute before:-inset-2 before:content-[''] md:h-6 md:before:-inset-0.5";

interface ChatUnreadsFilterChipProps {
  /** The All unreads filter: the list below shows only rooms with unread. */
  unreadOnly: boolean;
  onUnreadOnlyChange: (unreadOnly: boolean) => void;
}

/**
 * The All unreads filter's switch (⌘⇧U): the Unreads chip. The sidebar's
 * Chats heading carries it; the phone's Chats page, which has no such
 * heading, keeps it at the end of the Catch up row.
 */
export function ChatUnreadsFilterChip({
  unreadOnly,
  onUnreadOnlyChange,
}: ChatUnreadsFilterChipProps) {
  const t = useTranslations("App.Channels.UnreadNav");
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

  // A mode, not a place: on, it takes the primary tint the app uses for what
  // is on. Before React reads the remembered filter, the boot script's mark
  // tints it the same way.
  return (
    <button
      type="button"
      aria-pressed={unreadOnly}
      aria-keyshortcuts={showsShortcut ? shortcutKeys : undefined}
      title={showsShortcut ? shortcutHint : t("allUnreads")}
      data-filter-on={unreadOnly ? "true" : undefined}
      onClick={toggleUnreadOnly}
      className={cn(
        UNREADS_CHIP_CLASS,
        unreadOnly
          ? "bg-primary-quaternary text-primary-variant hover:bg-primary-quaternary hover:text-primary-variant active:bg-primary-quaternary"
          : "chat-unreads-boot:bg-primary-quaternary chat-unreads-boot:text-primary-variant",
      )}
    >
      {t("allUnreads")}
    </button>
  );
}

/** The rooms Mark all as read reads: those with anything unread to clear. */
function markAllReadTargets(rooms: readonly ChatRoom[]) {
  return rooms
    .map((room) => ({ roomId: room.id, ...roomUnreadReads(room) }))
    .filter((target) => target.readRoom || target.lookThreads);
}

interface ChatMarkAllReadButtonProps {
  /** The sidebar's live rooms; it clears what these hold unread. */
  rooms: readonly ChatRoom[];
  /** Shown only while the All unreads filter is on. */
  unreadOnly: boolean;
}

/**
 * Mark all as read: it clears what the All unreads filter lists, so it shows
 * only while the filter is on and something is unread, just before the
 * Unreads chip, wherever the chip stands.
 */
export function ChatMarkAllReadButton({
  rooms,
  unreadOnly,
}: ChatMarkAllReadButtonProps) {
  const t = useTranslations("App.Channels.UnreadNav");
  const [isMarking, startMarking] = useTransition();
  const markAllTargets = markAllReadTargets(rooms);
  if (!unreadOnly || markAllTargets.length === 0) {
    return null;
  }

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
    <button
      type="button"
      aria-label={t("markAllRead")}
      title={t("markAllRead")}
      disabled={isMarking}
      aria-busy={isMarking}
      onClick={handleMarkAllRead}
      className={cn(SIDEBAR_ICON_ACTION_CLASS, "text-primary-variant")}
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
  );
}

interface ChatUnreadNavRowsProps {
  /** The sidebar's live rooms. The row reads these and nothing of its own. */
  rooms: readonly ChatRoom[];
  /** What Mark all as read clears: `rooms`, and Pinned rooms of elsewhere. */
  markAllRooms: readonly ChatRoom[];
  /** When false, render plain links (page-mounted list outside a Sheet). */
  dismissSheetOnNavigate?: boolean;
  /** The All unreads filter: the list below shows only rooms with unread. */
  unreadOnly: boolean;
  /**
   * Given, the Unreads chip stands at this row's end: the phone's Chats page.
   * Left out where the sidebar's Chats heading carries the chip.
   */
  onUnreadOnlyChange?: (unreadOnly: boolean) => void;
}

/**
 * One entry for everything the reader missed, first under the Chats heading:
 * Catch up opens the written overview and the unread Threads (tabs of one
 * page). Its count is what waits on the reader (the needs-you pill), else the
 * Threads mark: the `@` pill where a Thread names them, the muted count of
 * unread Threads otherwise. While the All unreads filter is on, Mark all as
 * read stands at its end in the count's place, beside the Unreads chip where
 * the row carries it. Where the Chats heading carries the chip, Mark all as
 * read goes with it, and the row keeps neither.
 */
export function ChatUnreadNavRows({
  rooms,
  markAllRooms,
  dismissSheetOnNavigate = true,
  unreadOnly,
  onUnreadOnlyChange,
}: ChatUnreadNavRowsProps) {
  const t = useTranslations("App.Channels.UnreadNav");
  const pathname = usePathname();
  const showsChip = onUnreadOnlyChange !== undefined;

  const { threadCount, mentionCount } = resolveUnreadThreadsAttention(rooms);
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
  const showMarkAll =
    showsChip && unreadOnly && markAllReadTargets(markAllRooms).length > 0;
  // While the filter is on, the list below is the count; the row makes room
  // for Mark all instead (where the row carries the chip; on the heading,
  // Mark all sits beside it there).
  const showCount = !unreadOnly && (needsYouTotal > 0 || threadCount > 0);

  return (
    <SidebarMenu className="gap-0" aria-label={t("label")}>
      <SidebarMenuItem className="relative">
        <SidebarMenuButton asChild isActive={catchUpActive}>
          {wrapLink(
            <Link
              href={CHAT_CATCH_UP_PATH}
              aria-current={catchUpActive ? "page" : undefined}
              className={SIDEBAR_ROW_LINK_CLASS}
              data-testid="chat-catch-up-row"
            >
              <SidebarRowSlot>
                <Sunrise aria-hidden />
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
                  className="flex size-7 shrink-0 items-center justify-center"
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
              {/* Holds the label clear of the buttons drawn over the end: the
                  same boxes, unseen, so the hole is as wide as the chip's
                  word is in the reader's language. */}
              {showMarkAll || showsChip ? (
                <span
                  aria-hidden
                  data-slot="catch-up-end-spacer"
                  className="invisible flex shrink-0 items-center"
                >
                  {showMarkAll ? (
                    <span
                      data-slot="catch-up-end-spacer-action"
                      className="size-7"
                    />
                  ) : null}
                  {showsChip ? (
                    <span className={UNREADS_CHIP_CLASS}>
                      {t("allUnreads")}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </Link>,
          )}
        </SidebarMenuButton>
        {onUnreadOnlyChange ? (
          <div className="absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center">
            <ChatMarkAllReadButton
              rooms={markAllRooms}
              unreadOnly={unreadOnly}
            />
            <ChatUnreadsFilterChip
              unreadOnly={unreadOnly}
              onUnreadOnlyChange={onUnreadOnlyChange}
            />
          </div>
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
