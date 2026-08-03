"use client";

import { BellOff, Ellipsis, Pin } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useTransition } from "react";
import { toast } from "sonner";
import {
  markOrganizationChatRoomUnreadAction,
  muteOrganizationChatRoomAction,
  pinOrganizationChatRoomAction,
  unmuteOrganizationChatRoomAction,
  unpinOrganizationChatRoomAction,
} from "@/components/chat/organization-chat-list.actions";
import { resolveRoomAttention } from "@/components/chat/room-attention";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SheetClose } from "@/components/ui/sheet";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

/** Same absolute slot for pin/mute (rest) and overflow menu (hover) so icons never jump. */
const TRAILING_CONTROL_CLASS =
  "absolute top-1/2 right-1 z-10 flex size-7 -translate-y-1/2 items-center justify-center";

interface ChatRoomSidebarRowProps {
  room: ChatRoom;
  href: string;
  label: string;
  isActive: boolean;
  leading: ReactNode;
  onRoomUpdated: (room: ChatRoom) => void;
}

function MentionBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  const label = count > 99 ? "99+" : String(count);

  return (
    <span
      aria-label={`${label} mentions`}
      className="bg-primary text-primary-foreground group-data-[collapsible=icon]:hidden inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums"
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
}: ChatRoomSidebarRowProps) {
  const tActions = useTranslations("App.Channels.Actions");
  const [isPending, startTransition] = useTransition();
  const isPinned = room.pinnedAt != null;
  const isMuted = room.mutedAt != null;
  const { bold, badgeCount } = resolveRoomAttention({
    unreadCount: room.unreadCount,
    unreadMentionCount: room.unreadMentionCount,
    markedUnread: room.markedUnread,
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

  return (
    <SidebarMenuItem className="group/room-row relative">
      <SidebarMenuButton asChild isActive={isActive}>
        <SheetClose asChild>
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
                isMuted && !isActive && !bold && "text-muted-foreground",
              )}
            >
              {label}
            </span>
            <MentionBadge count={badgeCount} />
            <span className="size-7 shrink-0" aria-hidden />
          </Link>
        </SheetClose>
      </SidebarMenuButton>
      {isMuted || isPinned ? (
        <span
          className={cn(
            TRAILING_CONTROL_CLASS,
            "text-muted-foreground pointer-events-none",
            "group-hover/room-row:opacity-0 group-focus-within/room-row:opacity-0 group-has-[[data-state=open]]/room-row:opacity-0",
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
              TRAILING_CONTROL_CLASS,
              "text-muted-foreground opacity-0 group-focus-within/room-row:opacity-100 group-hover/room-row:opacity-100 data-[state=open]:opacity-100",
            )}
            aria-label={tActions("roomMenu", { name: label })}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            disabled={isActive || isPending}
            onSelect={() => {
              runRoomAction(markOrganizationChatRoomUnreadAction, {
                ...room,
                markedUnread: true,
              });
            }}
          >
            {tActions("markUnread")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isPending}
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
            {isPinned ? tActions("unpin") : tActions("pin")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isPending}
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
            {isMuted ? tActions("unmute") : tActions("mute")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
