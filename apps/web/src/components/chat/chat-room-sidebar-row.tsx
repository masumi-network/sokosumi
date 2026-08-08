"use client";

import {
  Bell,
  BellOff,
  Ellipsis,
  Loader2,
  LogOut,
  MessageSquare,
  Pin,
  PinOff,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { leaveRoomAction } from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  markOrganizationChatRoomUnreadAction,
  muteOrganizationChatRoomAction,
  pinOrganizationChatRoomAction,
  unmuteOrganizationChatRoomAction,
  unpinOrganizationChatRoomAction,
} from "@/components/chat/organization-chat-list.actions";
import { resolveRoomAttention } from "@/components/chat/room-attention";
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

/**
 * Trailing controls. Touch: pin/mute then overflow side by side.
 * Hover-capable: one size-7 slot that swaps status ↔ overflow on hover.
 */
const TRAILING_CLUSTER_CLASS =
  "absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center";

interface ChatRoomSidebarRowProps {
  room: ChatRoom;
  href: string;
  label: string;
  isActive: boolean;
  leading: ReactNode;
  onRoomUpdated: (room: ChatRoom) => void;
  /** When false, render plain Link (page-mounted list outside Sheet). */
  dismissSheetOnNavigate?: boolean;
}

function MentionBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  const label = count > 99 ? "99+" : String(count);

  return (
    <span
      aria-label={`${label} mentions`}
      className="bg-primary text-primary-foreground group-data-[collapsible=icon]:hidden inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[0.625rem] leading-4 font-semibold tabular-nums"
    >
      {label}
    </span>
  );
}

export function ChatRoomSidebarRow({
  room,
  href,
  label,
  isActive,
  leading,
  onRoomUpdated,
  dismissSheetOnNavigate = true,
}: ChatRoomSidebarRowProps) {
  const tActions = useTranslations("App.Channels.Actions");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const isPinned = room.pinnedAt != null;
  const isMuted = room.mutedAt != null;
  const canLeave = room.kind === "channel" && room.userMembers.length > 1;
  const { bold, badgeCount } = resolveRoomAttention({
    unreadCount: room.unreadCount,
    unreadMentionCount: room.unreadMentionCount,
    markedUnread: room.markedUnread,
    isMuted,
    isActive,
  });

  function runRoomAction(
    action: (
      roomId: string,
    ) => Promise<{ ok: true; data: ChatRoom } | { ok: false }>,
    optimisticRoom?: ChatRoom,
  ) {
    if (optimisticRoom) {
      onRoomUpdated(optimisticRoom);
    }
    startTransition(async () => {
      const result = await action(room.id);
      if (!result.ok) {
        onRoomUpdated(room);
        toast.error(tActions("actionFailed"));
        return;
      }
      onRoomUpdated(result.data);
    });
  }

  async function handleConfirmLeave() {
    if (isLeaving) return;
    setIsLeaving(true);
    const result = await leaveRoomAction(room.id);
    setIsLeaving(false);

    if (!result.ok) {
      toast.error(result.message);
      setLeaveConfirmOpen(false);
      return;
    }

    toast.success(tActions("leaveSuccess", { name: label }));
    setLeaveConfirmOpen(false);
    // Explicit remove — bare refetch + upsertFirstPageRooms keeps left rooms
    // as stale "older" rows and they stick in the sidebar.
    notifyOrganizationChatRoomsChanged({ removedRoomId: room.id });
    if (isActive) {
      // Land on chat home — `/chat/chats` is mobile-only (`md:hidden`).
      router.replace("/chat");
      router.refresh();
    }
  }

  const roomLink = (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3",
        isMuted && !isActive && "opacity-60",
      )}
      href={href}
    >
      {leading}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          bold && "font-semibold text-foreground",
          isMuted && !isActive && "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <MentionBadge count={badgeCount} />
      <span
        className={cn(
          "h-7 w-7 shrink-0",
          (isMuted || isPinned) && "[@media(hover:none)]:w-14",
        )}
        aria-hidden
      />
    </Link>
  );

  return (
    <SidebarMenuItem className="group/room-row relative">
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className="h-auto py-4 md:h-8 md:py-2"
      >
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
              "text-muted-foreground pointer-events-none flex size-7 items-center justify-center",
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
                "text-muted-foreground size-7 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-100 [@media(hover:hover)]:group-hover/room-row:opacity-100 data-[state=open]:opacity-100",
              )}
              aria-label={tActions("roomMenu", { name: label })}
            >
              <Ellipsis className="size-4" aria-hidden />
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
                    pinnedAt: null,
                  });
                  return;
                }
                runRoomAction(pinOrganizationChatRoomAction, {
                  ...room,
                  pinnedAt: new Date(),
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
            {canLeave ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isPending || isLeaving}
                  onSelect={() => {
                    setLeaveConfirmOpen(true);
                  }}
                >
                  <LogOut className="size-4" aria-hidden />
                  {tActions("leave")}
                </DropdownMenuItem>
              </>
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
