"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import {
  Bell,
  BellOff,
  Ellipsis,
  LogOut,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Users,
} from "lucide-react";
import { type MotionProps, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ComponentProps,
  type ReactNode,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { leaveRoomAction } from "@/app/chat/actions";
import { useRoomSelection } from "@/app/chat/components/room-cache-provider";
import { canLeaveChannel } from "@/app/chat/utils/channel-member-permissions";
import {
  CHAT_CHATS_LIST_PATH,
  CHAT_EDIT_CHANNEL_PARAM,
  chatRoomEditHref,
  chatRoomHref,
  pathWithSearch,
} from "@/app/chat/utils/chat-route-base";
import { getActiveRoomIdFromSelection } from "@/components/chat/active-room-id";
import { ChatRoomThreadRows } from "@/components/chat/chat-room-thread-rows";
import { RowCountMark } from "@/components/chat/mention-count-pill";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  markOrganizationChatRoomUnreadAction,
  muteOrganizationChatRoomAction,
  type OrganizationChatListActionResult,
  pinOrganizationChatRoomAction,
  unmuteOrganizationChatRoomAction,
  unpinOrganizationChatRoomAction,
} from "@/components/chat/organization-chat-list.actions";
import {
  resolveRoomAttention,
  roomBadgeCountsMentions,
} from "@/components/chat/room-attention";
import { ROOM_COUNT_CAP } from "@/components/chat/room-count-label";
import {
  applyRoomReadOverlays,
  beginRoomAttentionChange,
  settleRoomAttentionChange,
} from "@/components/chat/room-read-overlay";
import { useShowRoomUnreadCount } from "@/components/chat/use-show-room-unread-count";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";
import { CHAT_MESSAGE_PARAM } from "@/lib/utils/notification-href";

/**
 * Trailing controls. Touch: pin/mute then overflow side by side.
 *
 * Hover-capable: one 16px hole, opened whenever something is in it. Sized to
 * the glyph rather than the button's 28px box, because what has to clear the
 * name is the glyph inside it: the `…` reaches 28px in from the row edge, and
 * 16px ends the name at 36px. The smaller pin/mute glyph clears the same hole.
 *
 * A plain row keeps its full name width at rest, because the menu button is
 * `opacity-0` there and an invisible button needs no hole. The hole opens on
 * hover, focus and menu-open, which is the only time a plain row's name moves.
 *
 * The open room holds the hole open at rest too. It is the row being read and
 * the one most likely to be hovered, so it is the one row whose name must not
 * move under the cursor: rest, hover and menu-open are all one width there.
 *
 * A mention badge takes the same hole rather than one of its own: it stands in
 * the menu's column and fades out as the menu fades in, so a badged row holds
 * the 16px open in every state and the name is shortened once, by the hole
 * both share. It used to be shortened by the badge, a gap and the hole in
 * turn, which is the 16px the name gets back.
 */
const TRAILING_CLUSTER_CLASS =
  "absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center";

const MotionSidebarMenuItem = motion.create(SidebarMenuItem);

export interface ChatRoomSidebarRowProps {
  room: ChatRoom;
  href: string;
  label: string;
  /** Optional secondary line (e.g. host org name on External guest rows). */
  subtitle?: string;
  isActive: boolean;
  leading: ReactNode;
  onRoomUpdated: (room: ChatRoom) => void;
  /** When false, render plain Link (page-mounted list outside Sheet). */
  dismissSheetOnNavigate?: boolean;
  /**
   * Props for the row's `<li>`: a drop slot that moves in a drag in Pinned,
   * a dimmed read room in the All unreads filter. Without the handlers motion
   * owns, so the same props fit the animated `<li>` of `itemMotion`.
   */
  itemProps?: Omit<
    ComponentProps<"li">,
    "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
  >;
  /**
   * Presence animation for the `<li>`, for a row inside `AnimatePresence`:
   * one arriving in or leaving the All unreads filter.
   */
  itemMotion?: MotionProps;
  /**
   * Pinned section in its reorder mode: stands where the room menu does, and
   * the row stops being a link, so a press moves the room instead of opening it.
   */
  reorderHandle?: ReactNode;
  /**
   * Organization owner/admin of this Channel: its menu opens the settings.
   * Anyone else's opens the members panel.
   */
  canManageSettings?: boolean;
}

/**
 * The reader's opt-in Room unread count, as the link announces it.
 *
 * The number itself is drawn by `MentionBadge`, in the trailing cluster,
 * outside the link and `aria-hidden`. This span is what carries it into the
 * link's accessible name beside the room name, the way `MentionAnnouncement`
 * carries the badge.
 *
 * A bare `span` is role `generic`, which prohibits an accessible name, so an
 * `aria-label` here can be dropped. Real text carries it instead.
 */
function RoomUnreadCount({ count }: { count: number }) {
  const t = useTranslations("App.Channels.RoomUnread");

  if (count <= 0) {
    return null;
  }

  return (
    <span className="sr-only">
      {count > ROOM_COUNT_CAP
        ? t("unreadMessagesCapped", { max: ROOM_COUNT_CAP })
        : t("unreadMessages", { count })}
    </span>
  );
}

/**
 * Unread @mentions and directs, never messages: the part the reader hears.
 *
 * `MentionBadge` draws the number in the trailing cluster, outside the link
 * and `aria-hidden`, so this span is what carries the mention into the link's
 * accessible name beside the room name. A translated string in its own
 * `sr-only` span, for the same reason the count carries one: `aria-label` on a
 * role `generic` span may be dropped, and an English literal would reach a
 * German or Spanish reader untranslated either way.
 */
function MentionAnnouncement({ count }: { count: number }) {
  const t = useTranslations("App.Channels.RoomMentions");

  if (count <= 0) {
    return null;
  }

  return (
    <span className="sr-only">
      {count > ROOM_COUNT_CAP
        ? t("mentionsCapped", { max: ROOM_COUNT_CAP })
        : t("mentions", { count })}
    </span>
  );
}

/** The needs-you pill in words, for the same reason the mention has some. */
function NeedsYouAnnouncement({ count }: { count: number }) {
  const t = useTranslations("App.Channels.Signals");

  if (count <= 0) {
    return null;
  }

  return <span className="sr-only">{t("needsYouCount", { count })}</span>;
}

/**
 * The row's one number, drawn in the room menu's column: the mention pill,
 * or the reader's opt-in count where there is no mention.
 *
 * On a hover-capable row it crossfades with the menu: out of flow, fading as
 * the `…` arrives, exactly as the muted bell does. Sharing the menu's column
 * is what buys the name its width back, because the number stops asking for
 * a gap and a width of its own on top of the hole. The cost is the number
 * going quiet under the cursor, pill and count alike; the bold name stays, on
 * the one row they are pointing at.
 *
 * The pill rides the bell's own box rather than being positioned by its own
 * edge, because its width is the reader's unread count and a `right-` offset
 * that centres `2` leaves `99+` off-centre and all but touching the name. A
 * 28px box pinned at `right-0` spans 4–32px in from the row's edge whatever is
 * in it, so the pill sits on the `…` glyph's centre at every width and the
 * hole ends the name at 36px, 4px clear of the widest one.
 *
 * Touch has no hover, so the badge stays in flow beside the menu there, as
 * pin/mute does, and the trailing spacer holds a hole wide enough for both.
 * Reorder mode is the same: its handle is visible at rest, so there is nothing
 * to crossfade with.
 *
 * `pointer-events-none` keeps the badge off the menu button it covers at rest.
 */
function MentionBadge({
  count,
  needsYouCount,
  unreadTextCount,
  crossfadesWithMenu,
}: {
  /** Messages waiting on the reader; drawn in place of the `@` pill. */
  needsYouCount: number;
  /** Mentions to draw as the `@` pill. Zero in a Direct of two. */
  count: number;
  /**
   * The reader's opt-in Room unread count. A row shows one number, so
   * `resolveRoomAttention` only reports this when there is no badge, and it
   * takes the badge's slot: same column, same crossfade with the menu. Muted
   * text and no pill, because it is the one number on the sidebar that is
   * not about the reader, at the pill's own 10px and weight, so the two read
   * as one family rather than the count looming over the mention. It caps
   * like the badge, so a loud room cannot reflow the row.
   */
  unreadTextCount: number;
  crossfadesWithMenu: boolean;
}) {
  if (count <= 0 && needsYouCount <= 0 && unreadTextCount <= 0) {
    return null;
  }

  return (
    <span
      data-slot={
        needsYouCount > 0
          ? "room-needs-you-badge"
          : count > 0
            ? "room-mention-badge"
            : "room-unread-count"
      }
      aria-hidden
      className={cn(
        "pointer-events-none inline-flex size-8 shrink-0 items-center justify-center md:size-7",
        crossfadesWithMenu && [
          "[@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:right-0 [@media(hover:hover)]:-translate-y-1/2",
          "motion-safe:transition-opacity motion-safe:duration-150",
          "[@media(hover:hover)]:group-hover/room-row:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-0 group-has-[[data-state=open]]/room-row:opacity-0",
        ],
      )}
    >
      <RowCountMark
        mentionCount={count}
        needsYouCount={needsYouCount}
        count={unreadTextCount}
      />
    </span>
  );
}

export function ChatRoomSidebarRow({
  room,
  href,
  label,
  subtitle,
  isActive: routeIsActive,
  leading,
  onRoomUpdated,
  dismissSheetOnNavigate = true,
  itemProps,
  itemMotion,
  reorderHandle,
  canManageSettings = false,
}: ChatRoomSidebarRowProps) {
  const selectedPath = useRoomSelection();
  const isActive = selectedPath
    ? getActiveRoomIdFromSelection(selectedPath) === room.id
    : routeIsActive;

  const tActions = useTranslations("App.Channels.Actions");
  const tChannels = useTranslations("App.Channels");
  const router = useRouter();
  // The room's own query, not `window.location`, which the App Router writes
  // in an effect after the commit and so can still name a message the room
  // has already spent. Re-adding that would send the reader back to it.
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const isPinned = room.starredAt != null;
  const isMuted = room.mutedAt != null;
  const isChannel = room.kind === "channel";
  const canLeave = canLeaveChannel(room);
  const badgeCountsMentions = roomBadgeCountsMentions(room);
  const showUnreadCount = useShowRoomUnreadCount();
  const { bold, mentionCount, needsYouCount, unreadTextCount } =
    resolveRoomAttention({
      unreadCount: room.unreadCount,
      channelUnreadCount: room.channelUnreadCount,
      unreadMentionCount: room.unreadMentionCount,
      unreadNeedsYouCount: room.unreadNeedsYouCount,
      markedUnread: room.markedUnread,
      isMuted,
      showUnreadCount,
      badgeCountsMentions,
    });
  // The row's one number, whichever it is, stands in the badge's slot, so
  // the hole that keeps the name clear of it has to be held open for either.
  const hasRowCount =
    mentionCount > 0 || needsYouCount > 0 || unreadTextCount > 0;

  function runRoomAction(
    action: (
      roomId: string,
    ) => Promise<OrganizationChatListActionResult<ChatRoom>>,
    optimisticRoom?: ChatRoom,
  ) {
    const attentionToken =
      action === markOrganizationChatRoomUnreadAction && optimisticRoom
        ? beginRoomAttentionChange(optimisticRoom, room)
        : null;
    if (optimisticRoom) {
      onRoomUpdated(optimisticRoom);
    }

    function applyResult(updatedRoom: ChatRoom | null): boolean {
      if (
        attentionToken !== null &&
        !settleRoomAttentionChange(room.id, attentionToken, updatedRoom)
      ) {
        return false;
      }
      onRoomUpdated(
        updatedRoom ??
          (attentionToken === null ? room : applyRoomReadOverlays([room])[0]),
      );
      return true;
    }

    startTransition(async () => {
      try {
        const result = await action(room.id);
        if (!result.ok) {
          if (applyResult(null)) toast.error(tActions("actionFailed"));
          return;
        }
        applyResult(result.value);
      } catch {
        if (applyResult(null)) toast.error(tActions("actionFailed"));
      }
    });
  }

  async function handleConfirmLeave() {
    if (isLeaving) return;
    setIsLeaving(true);
    const result = await leaveRoomAction(room.id);
    setIsLeaving(false);

    if (!result.ok) {
      toast.error(result.error.message || tActions("actionFailed"));
      setLeaveConfirmOpen(false);
      return;
    }

    toast.success(tActions("leaveSuccess", { name: label }));
    setLeaveConfirmOpen(false);
    notifyOrganizationChatRoomsChanged({ removedRoomId: room.id });
    if (isActive) {
      // Land on chat home / list (`/chat` — mobile list; desktop redirects).
      router.replace(CHAT_CHATS_LIST_PATH);
      router.refresh();
    }
  }

  // The dialog needs the org roster and the reader's role, which this row does
  // not have and the room already loads. So the row asks the room to open it:
  // a Channel's settings (its members panel for anyone who cannot change
  // them), or a group Direct's name, which is all it has.
  const canEditRoom = isChannel || room.isGroupDirect;
  const editRoomItem = (
    <DropdownMenuItem
      disabled={isPending}
      onSelect={() => {
        // Asking the room on screen for its own dialog is not a journey. The
        // room takes the parameter straight back off the URL, so a pushed
        // entry would leave Back doing nothing the reader can see. The rest of
        // that room's query rides along rather than being written over.
        //
        // Except the message a notification named, which the room reads once
        // the same way. The router's query still carries one the room has
        // spent until that strip commits, and writing it back would leave the
        // room waiting on a message nobody will spend again, with this ask
        // stuck behind it. The reader asked for the dialog just now, so a
        // jump the room has not made yet gives way to it.
        if (isActive) {
          const params = new URLSearchParams(searchParams.toString());
          params.delete(CHAT_MESSAGE_PARAM);
          params.set(CHAT_EDIT_CHANNEL_PARAM, "1");
          router.replace(pathWithSearch(chatRoomHref(room.id), params), {
            scroll: false,
          });
          return;
        }
        router.push(chatRoomEditHref(room.id));
      }}
    >
      {isChannel && !canManageSettings ? (
        <Users className="size-4" aria-hidden />
      ) : (
        <Pencil className="size-4" aria-hidden />
      )}
      {!isChannel
        ? tChannels("GroupName.rename")
        : canManageSettings
          ? tChannels("editChannel")
          : tChannels("RoomRoster.title")}
    </DropdownMenuItem>
  );

  const roomLink = (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        isMuted && !isActive && "opacity-60",
        // Reorder mode: a press moves the room, so the link stands down.
        reorderHandle && "pointer-events-none",
      )}
      href={href}
      tabIndex={reorderHandle ? -1 : undefined}
    >
      <SidebarRowSlot>{leading}</SidebarRowSlot>
      <span className={SIDEBAR_ROW_LABEL_CLASS}>
        {/* The count used to ride the end of the name in a flex with a gap.
            It is drawn in the trailing cluster now, so only its announcement
            is left here, and a counted row must not keep a hole after the
            name for text nobody sees. */}
        <span
          className={cn(
            "block min-w-0 truncate",
            bold && "font-semibold text-foreground",
            isMuted && !isActive && "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <RoomUnreadCount count={unreadTextCount} />
        {subtitle ? (
          <span className="text-muted-foreground block truncate text-xs leading-tight">
            {subtitle}
          </span>
        ) : null}
      </span>
      <MentionAnnouncement count={mentionCount} />
      <NeedsYouAnnouncement count={needsYouCount} />
      <span
        data-slot="room-trailing-spacer"
        className={cn(
          "shrink-0",
          "[@media(hover:none)]:size-8 [@media(hover:none)]:md:size-7",
          // Touch keeps the bell or the badge in flow beside the menu, so the
          // hole holds two boxes. They are the same 32px box, and a muted room
          // carries no badge, so one width serves both.
          (isMuted || hasRowCount) && "[@media(hover:none)]:w-16",
          // A muted row shows its glyph at rest, a badged row shows its badge,
          // and the open room is the row being read, so all three hold the
          // 16px hole in every state. The name is `flex-1 min-w-0`, so a hole
          // that opened later would take that width off the name and
          // re-truncate it under the cursor — and on a badged row the name
          // would run under the badge until it did.
          //
          // A plain, unopened row has nothing in the hole at rest — the menu
          // button is `opacity-0` until hover, focus or open — so it keeps the
          // full name width and opens the hole with the button. That is the
          // one row whose name moves, and it moves as the button arrives.
          //
          // The badge asks for no width beyond the hole, because it stands in
          // the menu's column and crossfades with it. Reorder mode is the
          // exception: its handle never fades, so the badge stays in flow
          // beside it and the hole holds both.
          hasRowCount && reorderHandle
            ? "[@media(hover:hover)]:w-16"
            : isMuted || isActive || reorderHandle || hasRowCount
              ? "[@media(hover:hover)]:size-4"
              : [
                  "[@media(hover:hover)]:size-0",
                  "[@media(hover:hover)]:group-hover/room-row:size-4",
                  "[@media(hover:hover)]:group-focus-within/room-row:size-4",
                  "[@media(hover:hover)]:group-has-[[data-state=open]]/room-row:size-4",
                ],
        )}
        aria-hidden
      />
    </Link>
  );

  const roomButton = (
    <SidebarMenuButton
      asChild
      isActive={isActive}
      // A guest row is one of the items allowed a second line (GLOSSARY.md,
      // "Sidebar row"): its host organisation line is one a 32px row has no
      // room for, so this row alone grows to hold it. Its mark still sits in
      // the shared slot.
      className={cn(subtitle && "h-auto min-h-11 py-1 md:h-auto md:min-h-8")}
    >
      {dismissSheetOnNavigate ? (
        <SheetClose asChild>{roomLink}</SheetClose>
      ) : (
        roomLink
      )}
    </SidebarMenuButton>
  );

  const itemClassName = cn("relative", itemProps?.className);
  const content = (
    <>
      {/* The row proper. Its marks and trailing cluster are centred on this
          box, and its hover reveals its own menu, so neither can drift onto
          the inset thread rows that follow it inside the same item. */}
      <div data-slot="room-row-main" className="group/room-row relative">
        {roomButton}
        <div data-slot="room-trailing" className={TRAILING_CLUSTER_CLASS}>
          <MentionBadge
            count={mentionCount}
            needsYouCount={needsYouCount}
            unreadTextCount={unreadTextCount}
            crossfadesWithMenu={reorderHandle == null}
          />
          {reorderHandle ?? (
            <>
              {isMuted ? (
                <span
                  className={cn(
                    "text-muted-foreground pointer-events-none flex size-8 items-center justify-center md:size-7",
                    "[@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:right-0 [@media(hover:hover)]:-translate-y-1/2",
                    "motion-safe:transition-opacity motion-safe:duration-150",
                    "[@media(hover:hover)]:group-hover/room-row:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-0 group-has-[[data-state=open]]/room-row:opacity-0",
                  )}
                  aria-hidden
                >
                  <BellOff className="size-4 md:size-3.5" />
                </span>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isPending}
                    className={cn(
                      // The box stays 32px so the `…` keeps its column under the section's
                      // `+`; the pseudo-element carries the touch target out to 44px.
                      "text-muted-foreground relative size-8 opacity-100 after:absolute after:-inset-1.5 md:size-7 md:after:-inset-0.5 motion-safe:transition-opacity motion-safe:duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-100 [@media(hover:hover)]:group-hover/room-row:opacity-100 data-[state=open]:opacity-100",
                    )}
                    aria-label={tActions("roomMenu", { name: label })}
                  >
                    <Ellipsis className="size-5 md:size-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    disabled={isActive || isPending || isMuted}
                    onSelect={() => {
                      runRoomAction(markOrganizationChatRoomUnreadAction, {
                        ...room,
                        markedUnread: true,
                      });
                    }}
                  >
                    <MessageSquare className="size-4" aria-hidden />
                    {tActions("markUnread")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isPending || isMuted}
                    onSelect={() => {
                      if (isPinned) {
                        runRoomAction(unpinOrganizationChatRoomAction, {
                          ...room,
                          starredAt: null,
                        });
                        return;
                      }
                      runRoomAction(pinOrganizationChatRoomAction, {
                        ...room,
                        starredAt: new Date(),
                      });
                    }}
                  >
                    {isPinned ? (
                      <PinOff className="size-4" aria-hidden />
                    ) : (
                      <Pin className="size-4" aria-hidden />
                    )}
                    {isPinned ? tActions("unpin") : tActions("pin")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isPending || isPinned}
                    onSelect={() => {
                      if (isMuted) {
                        runRoomAction(unmuteOrganizationChatRoomAction, {
                          ...room,
                          mutedAt: null,
                        });
                        return;
                      }
                      runRoomAction(muteOrganizationChatRoomAction, {
                        ...room,
                        mutedAt: new Date(),
                      });
                    }}
                  >
                    {isMuted ? (
                      <Bell className="size-4" aria-hidden />
                    ) : (
                      <BellOff className="size-4" aria-hidden />
                    )}
                    {isMuted ? tActions("unmute") : tActions("mute")}
                  </DropdownMenuItem>
                  {canEditRoom ? (
                    <>
                      <DropdownMenuSeparator />
                      {dismissSheetOnNavigate ? (
                        <SheetClose asChild>{editRoomItem}</SheetClose>
                      ) : (
                        editRoomItem
                      )}
                    </>
                  ) : null}
                  {canLeave ? (
                    <DropdownMenuItem
                      disabled={isPending || isLeaving}
                      onSelect={() => {
                        setLeaveConfirmOpen(true);
                      }}
                    >
                      <LogOut className="size-4" aria-hidden />
                      {tActions("leave")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Room mute outranks everything a room can hold, so a muted room lists
          nothing. Reorder mode moves rows, and rows of differing height under
          the pointer would make that harder to aim. */}
      {isMuted || reorderHandle ? null : (
        <ChatRoomThreadRows
          room={room}
          roomLabel={label}
          isActive={isActive}
          wrapLink={
            dismissSheetOnNavigate
              ? (link) => <SheetClose asChild>{link}</SheetClose>
              : undefined
          }
        />
      )}

      <AlertDialog
        open={leaveConfirmOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isLeaving) setLeaveConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tActions("leaveConfirmTitle", { name: label })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tActions("leaveConfirmDescription", { name: label })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeaving}>
              {tActions("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={isLeaving}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmLeave();
              }}
            >
              {tActions("leaveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return itemMotion ? (
    <MotionSidebarMenuItem
      {...itemProps}
      {...itemMotion}
      className={itemClassName}
    >
      {content}
    </MotionSidebarMenuItem>
  ) : (
    <SidebarMenuItem {...itemProps} className={itemClassName}>
      {content}
    </SidebarMenuItem>
  );
}
