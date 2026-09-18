"use client";

import {
  Bell,
  BellOff,
  Ellipsis,
  Loader2,
  LogOut,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
} from "lucide-react";
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
import {
  CHAT_CHATS_LIST_PATH,
  CHAT_EDIT_CHANNEL_PARAM,
  chatRoomEditHref,
  chatRoomHref,
  pathWithSearch,
} from "@/app/chat/utils/chat-route-base";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  markOrganizationChatRoomUnreadAction,
  muteOrganizationChatRoomAction,
  type OrganizationChatListActionResult,
  pinOrganizationChatRoomAction,
  unmuteOrganizationChatRoomAction,
  unpinOrganizationChatRoomAction,
} from "@/components/chat/organization-chat-list.actions";
import { resolveRoomAttention } from "@/components/chat/room-attention";
import {
  ROOM_COUNT_CAP,
  roomCountLabel,
} from "@/components/chat/room-count-label";
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
  SidebarRailSelectionBar,
} from "@/components/ui/sidebar";
import type { ChatRoom } from "@/lib/clients/generated/core";
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
  "group-data-[collapsible=icon]:hidden absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center";

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
  /** Pinned section only: the row's `<li>` is a drop slot and moves in a drag. */
  itemProps?: ComponentProps<"li">;
  /**
   * Pinned section in its reorder mode: stands where the room menu does, and
   * the row stops being a link, so a press moves the room instead of opening it.
   */
  reorderHandle?: ReactNode;
}

/**
 * The reader's opt-in Room unread count.
 *
 * Text rather than a pill, because it is not the mention badge and a reader has
 * to tell the two apart at a glance. It caps like the badge so a very loud room
 * cannot reflow the row. Collapsed to icons the row is a 24px mark with space
 * for neither number, so count and badge both hide. That is decided, not an
 * oversight.
 *
 * A middot opens the count, so the digits stop running on from the room name
 * they follow. Dot and digits carry the name's unread weight and colour,
 * because they are part of the same statement: this room has something for you.
 * `resolveRoomAttention` only ever reports a count above zero together with
 * `bold`, so there is no unbolded state to render and no prop to thread.
 * `room-attention.test.ts` pins that.
 *
 * `whitespace-nowrap` holds the middot and the digits together. The label is
 * one string with a space in it, so without this the two can land on separate
 * lines wherever the count stops being an unshrinkable flex item.
 */
function RoomUnreadCount({ count }: { count: number }) {
  const t = useTranslations("App.Channels.RoomUnread");

  if (count <= 0) {
    return null;
  }

  const capped = count > ROOM_COUNT_CAP;

  // A bare `span` is role `generic`, which prohibits an accessible name, so an
  // `aria-label` here can be dropped and the row announces a bare number beside
  // the badge's bare number. Real text carries it instead.
  return (
    <span className="text-foreground group-data-[collapsible=icon]:hidden shrink-0 leading-4 font-semibold whitespace-nowrap tabular-nums">
      <span aria-hidden="true">{`· ${roomCountLabel(count)}`}</span>
      <span className="sr-only">
        {capped
          ? t("unreadMessagesCapped", { max: ROOM_COUNT_CAP })
          : t("unreadMessages", { count })}
      </span>
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
 * German or Spanish reader untranslated either way. The wrapper holds the
 * collapsed rule, so the announcement goes quiet with the count and the badge.
 */
function MentionAnnouncement({ count }: { count: number }) {
  const t = useTranslations("App.Channels.RoomMentions");

  if (count <= 0) {
    return null;
  }

  return (
    <span className="group-data-[collapsible=icon]:hidden sr-only">
      <span className="sr-only">
        {count > ROOM_COUNT_CAP
          ? t("mentionsCapped", { max: ROOM_COUNT_CAP })
          : t("mentions", { count })}
      </span>
    </span>
  );
}

/**
 * The mention count, drawn in the room menu's column.
 *
 * On a hover-capable row it crossfades with the menu: out of flow, fading as
 * the `…` arrives, exactly as the muted bell does. Sharing the menu's column
 * is what buys the name its width back, because the badge stops asking for a
 * gap and a width of its own on top of the hole. The cost is the number going
 * quiet under the cursor; the bold name and the reader's opt-in count stay, on
 * the one row they are pointing at.
 *
 * `right-1` rather than the bell's `right-0`: the bell is a glyph centred in a
 * 28px box and the badge has no box, so 4px lands a 20px badge on the `…`
 * glyph's centre instead of flush against the row's edge. At its widest
 * (`99+`, 27px) the badge then reaches 31px in from the row's edge, and the
 * hole ends the name at 36px, so the name clears it in every state.
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
  crossfadesWithMenu,
}: {
  count: number;
  crossfadesWithMenu: boolean;
}) {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      data-slot="room-mention-badge"
      aria-hidden
      className={cn(
        "bg-primary-solid text-primary-solid-foreground pointer-events-none inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[0.625rem] leading-4 font-semibold tabular-nums",
        crossfadesWithMenu && [
          "[@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:right-1 [@media(hover:hover)]:-translate-y-1/2",
          "motion-safe:transition-opacity motion-safe:duration-150",
          "[@media(hover:hover)]:group-hover/room-row:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-0 group-has-[[data-state=open]]/room-row:opacity-0",
        ],
      )}
    >
      {roomCountLabel(count)}
    </span>
  );
}

/**
 * The collapsed rail's one attention mark (Rail attention pill, CONTEXT.md).
 * Bold, count, and badge all hide there, so this is the only cue left. A 4px
 * bar on the rail's left edge, outside the mark: 8px primary for a mention,
 * 6px foreground for unread, none when read or muted. Off the mark rather
 * than on it, because a DM face already carries its presence dot and a
 * private tile its kind corner, and a second corner mark crowded both.
 * Derived from `resolveRoomAttention`, so it cannot disagree with the
 * expanded row. Rendered always and shown only collapsed, like the channel
 * tile. The bar is decorative; the state reaches assistive technology as
 * text inside the link, so the collapsed link announces it with the name.
 * `-left-2` lands it flush on the sidebar's edge, inside the group's `p-2`.
 */
export function RailAttentionPill({
  variant,
}: {
  variant: "unread" | "mention";
}) {
  return (
    <span
      data-slot="room-rail-attention"
      data-variant={variant}
      aria-hidden="true"
      className={cn(
        "absolute top-1/2 -left-2 z-10 hidden w-1 -translate-y-1/2 rounded-r-full group-data-[collapsible=icon]:block",
        variant === "mention" ? "bg-primary-solid h-2" : "bg-foreground h-1.5",
      )}
    />
  );
}

export function ChatRoomSidebarRow({
  room,
  href,
  label,
  subtitle,
  isActive,
  leading,
  onRoomUpdated,
  dismissSheetOnNavigate = true,
  itemProps,
  reorderHandle,
}: ChatRoomSidebarRowProps) {
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
  // Match rooms-client: guests and matched may always leave; host-org last
  // host keeps Leave hidden when they are the sole `member` access row.
  const canLeave =
    isChannel &&
    (room.myAccess === "guest" ||
      room.discoverability === "matched" ||
      room.userMembers.filter((member) => member.access === "member").length >
        1);
  const showUnreadCount = useShowRoomUnreadCount();
  const { bold, badgeCount, unreadTextCount } = resolveRoomAttention({
    unreadCount: room.unreadCount,
    unreadMentionCount: room.unreadMentionCount,
    markedUnread: room.markedUnread,
    isMuted,
    showUnreadCount,
  });
  const railVariant = badgeCount > 0 ? "mention" : bold ? "unread" : null;

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
  // not have and the room already loads. So the row asks the room to open it.
  const editChannelItem = (
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
      <Pencil className="size-4" aria-hidden />
      {tChannels("editChannel")}
    </DropdownMenuItem>
  );

  // Collapsed to icons the row is its leading mark, centred in the button.
  // The name goes `sr-only` rather than `hidden` so the link keeps its
  // accessible name (the tooltip adds none) while taking no flex space, and
  // the spacer hides so neither can push the mark off centre. The button's
  // `overflow-hidden` exists for name truncation, which the collapsed rail
  // has none of, and it clipped the tile's kind corner mark, which hangs 6px
  // below a 24px tile inside a 32px button. So the clip lifts there.
  const roomLink = (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-3 px-3 md:gap-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:overflow-visible group-data-[collapsible=icon]:px-0!",
        // The collapsed rail's hover ring and the fill it replaces live on
        // `sidebarMenuButtonVariants`, so this row's own `hover:bg-` above is
        // expanded-only. Its `hover:` outranks nothing there: the variant's
        // rule carries a `group-data-` condition and so wins on specificity.
        isMuted && !isActive && "opacity-60",
        // Reorder mode: a press moves the room, so the link stands down. The
        // collapsed rail has no handle and keeps opening rooms.
        reorderHandle &&
          "pointer-events-none group-data-[collapsible=icon]:pointer-events-auto",
      )}
      href={href}
      tabIndex={reorderHandle ? -1 : undefined}
    >
      <span
        data-slot="room-leading"
        className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center md:h-5 md:min-w-5 group-data-[collapsible=icon]:h-6 group-data-[collapsible=icon]:min-w-6"
      >
        {leading}
        {/* The pill's state, as text, where the link's accessible name can
            pick it up. `hidden` keeps it out of the expanded announcement;
            the collapsed variant flips it to `block` so `sr-only` applies. */}
        {railVariant ? (
          <span className="sr-only hidden group-data-[collapsible=icon]:block">
            {railVariant === "mention"
              ? tChannels("RoomMentions.railMention")
              : tChannels("RoomUnread.railUnread")}
          </span>
        ) : null}
      </span>
      <span className="group-data-[collapsible=icon]:sr-only min-w-0 flex-1">
        {/* The count rides the end of the name, not the row's right rail, so it
            reads as belonging to this room rather than to the row's controls.
            The name keeps `min-w-0` so it truncates first and the count stays.
            `flex-nowrap` states that one-line rule instead of leaning on the
            flex default, so the count cannot drop under the name (SOK-1062). */}
        <span className="flex min-w-0 flex-nowrap items-baseline gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate",
              bold && "font-semibold text-foreground",
              isMuted && !isActive && "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <RoomUnreadCount count={unreadTextCount} />
        </span>
        {subtitle ? (
          <span className="text-muted-foreground group-data-[collapsible=icon]:hidden block truncate text-xs leading-tight">
            {subtitle}
          </span>
        ) : null}
      </span>
      <MentionAnnouncement count={badgeCount} />
      <span
        data-slot="room-trailing-spacer"
        className={cn(
          "group-data-[collapsible=icon]:hidden shrink-0",
          "[@media(hover:none)]:size-8 [@media(hover:none)]:md:size-7",
          isMuted && "[@media(hover:none)]:w-16",
          // Touch keeps the badge in flow beside the menu, so the hole holds
          // both: 56px covers the widest badge (`99+`, 24px) and the 32px box.
          // Muted rows carry no badge, so the two widths never meet.
          badgeCount > 0 && "[@media(hover:none)]:w-14",
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
          badgeCount > 0 && reorderHandle
            ? "[@media(hover:hover)]:w-14"
            : isMuted || isActive || reorderHandle || badgeCount > 0
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

  return (
    <SidebarMenuItem
      {...itemProps}
      className={cn("group/room-row relative", itemProps?.className)}
    >
      {railVariant ? <RailAttentionPill variant={railVariant} /> : null}
      {isActive ? <SidebarRailSelectionBar /> : null}
      {/* Collapsed to icons the row is only its leading mark, so the name
          rides the button's tooltip, which the sidebar shows in that state
          alone. */}
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={label}
        // A thumb needs 44px; the desktop list keeps its 32px density.
        className="h-11 md:h-8"
      >
        {dismissSheetOnNavigate ? (
          <SheetClose asChild>{roomLink}</SheetClose>
        ) : (
          roomLink
        )}
      </SidebarMenuButton>
      <div data-slot="room-trailing" className={TRAILING_CLUSTER_CLASS}>
        <MentionBadge
          count={badgeCount}
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
                    "text-muted-foreground relative size-8 opacity-100 after:absolute after:-inset-1.5 md:size-7 md:after:hidden motion-safe:transition-opacity motion-safe:duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-100 [@media(hover:hover)]:group-hover/room-row:opacity-100 data-[state=open]:opacity-100",
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
                {isChannel ? (
                  <>
                    <DropdownMenuSeparator />
                    {dismissSheetOnNavigate ? (
                      <SheetClose asChild>{editChannelItem}</SheetClose>
                    ) : (
                      editChannelItem
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
              disabled={isLeaving}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmLeave();
              }}
            >
              {isLeaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {tActions("leaveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarMenuItem>
  );
}
