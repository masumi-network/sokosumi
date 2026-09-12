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
import { type ReactNode, useState, useTransition } from "react";
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
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { CHAT_MESSAGE_PARAM } from "@/lib/utils/notification-href";

/**
 * Trailing controls. Touch: pin/mute then overflow side by side.
 * Hover-capable: one size-8 slot that swaps status ↔ overflow on hover.
 */
const TRAILING_CLUSTER_CLASS =
  "absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center";

interface ChatRoomSidebarRowProps {
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
}

/**
 * The reader's opt-in Room unread count.
 *
 * Text rather than a pill, because it is not the mention badge and a reader has
 * to tell the two apart at a glance. It caps like the badge so a very loud room
 * cannot reflow the row. Collapsed to icons the row is a 20px glyph with space
 * for neither number, so count and badge both hide. That is decided, not an
 * oversight.
 *
 * A middot opens the count, so the digits stop running on from the room name
 * they follow. Dot and digits carry the name's unread weight and colour,
 * because they are part of the same statement: this room has something for you.
 * `resolveRoomAttention` only ever reports a count above zero together with
 * `bold`, so there is no unbolded state to render and no prop to thread.
 * `room-attention.test.ts` pins that.
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
    <span className="text-foreground group-data-[collapsible=icon]:hidden shrink-0 leading-4 font-semibold tabular-nums">
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
 * Unread @mentions and directs, never messages.
 *
 * The announced text is a translated string in its own `sr-only` span, for the
 * same reason the count carries one: `aria-label` on a role `generic` span may
 * be dropped, and an English literal would reach a German or Spanish reader
 * untranslated either way. It hides with the count when the sidebar collapses
 * to icons.
 */
function MentionBadge({ count }: { count: number }) {
  const t = useTranslations("App.Channels.RoomMentions");

  if (count <= 0) {
    return null;
  }

  return (
    <span className="bg-primary text-primary-foreground group-data-[collapsible=icon]:hidden inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[0.625rem] leading-4 font-semibold tabular-nums">
      <span aria-hidden="true">{roomCountLabel(count)}</span>
      <span className="sr-only">
        {count > ROOM_COUNT_CAP
          ? t("mentionsCapped", { max: ROOM_COUNT_CAP })
          : t("mentions", { count })}
      </span>
    </span>
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

  const roomLink = (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3",
        isMuted && !isActive && "opacity-60",
      )}
      href={href}
    >
      <span
        data-slot="room-leading"
        className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center"
      >
        {leading}
      </span>
      <span className="min-w-0 flex-1">
        {/* The count rides the end of the name, not the row's right rail, so it
            reads as belonging to this room rather than to the row's controls.
            The name keeps `min-w-0` so it truncates first and the count stays. */}
        <span className="flex min-w-0 items-baseline gap-1.5">
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
      <MentionBadge count={badgeCount} />
      <span
        className={cn(
          "size-8 shrink-0 md:size-7",
          (isMuted || isPinned) && "[@media(hover:none)]:w-16",
        )}
        aria-hidden
      />
    </Link>
  );

  return (
    <SidebarMenuItem className="group/room-row relative">
      <SidebarMenuButton asChild isActive={isActive}>
        {dismissSheetOnNavigate ? (
          <SheetClose asChild>{roomLink}</SheetClose>
        ) : (
          roomLink
        )}
      </SidebarMenuButton>
      <div className={TRAILING_CLUSTER_CLASS}>
        {isMuted || isPinned ? (
          <span
            className={cn(
              "text-muted-foreground pointer-events-none flex size-8 items-center justify-center md:size-7",
              "[@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:right-0 [@media(hover:hover)]:-translate-y-1/2",
              "[@media(hover:hover)]:group-hover/room-row:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-0 group-has-[[data-state=open]]/room-row:opacity-0",
            )}
            aria-hidden
          >
            {isMuted ? (
              <BellOff className="size-3.5" />
            ) : (
              <Pin className="size-3.5" />
            )}
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
                "text-muted-foreground size-8 opacity-100 md:size-7 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-100 [@media(hover:hover)]:group-hover/room-row:opacity-100 data-[state=open]:opacity-100",
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
