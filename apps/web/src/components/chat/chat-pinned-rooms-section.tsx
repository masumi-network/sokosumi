"use client";
import type { ChatRoom } from "@sokosumi/core-client";
import { ArrowUpDown, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Collapsible } from "@/components/ui/collapsible";
import { SidebarMenu } from "@/components/ui/sidebar";
import { SIDEBAR_ICON_ACTION_CLASS } from "@/components/ui/sidebar-classes";
import { SidebarSectionContent } from "@/components/ui/sidebar-section";
import { cn } from "@/lib/utils";
import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
import {
  PinnedRoomsDndContext,
  SortablePinnedRoomRow,
} from "./pinned-rooms-dnd";
import { resolveSectionAttention } from "./room-attention";

export function PinnedRoomsSection({
  pinned,
  open,
  onOpenChange,
  canReorderPinned,
  isReorderingPinned,
  onToggleReorder,
  pinnedRoomIds,
  onReorder,
  movePinnedTo,
  roomRowProps,
}: {
  pinned: ChatRoom[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  canReorderPinned: boolean;
  isReorderingPinned: boolean;
  onToggleReorder: () => void;
  pinnedRoomIds: string[];
  onReorder: (ids: string[]) => void;
  movePinnedTo: (
    roomId: string,
    targetId: string | undefined,
  ) => (() => void) | undefined;
  roomRowProps: (room: ChatRoom) => ChatRoomSidebarRowProps;
}) {
  const t = useTranslations("App.Channels");
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <ChatSidebarSectionHeader
        isOpen={open}
        closedAttention={resolveSectionAttention(pinned)}
        createAction={
          canReorderPinned ? (
            <button
              type="button"
              aria-pressed={isReorderingPinned}
              aria-label={t(
                isReorderingPinned ? "reorderPinnedDone" : "reorderPinned",
              )}
              className={SIDEBAR_ICON_ACTION_CLASS}
              onClick={onToggleReorder}
            >
              {isReorderingPinned ? (
                <Check className="size-4 md:size-3.5" aria-hidden />
              ) : (
                <ArrowUpDown className="size-4 md:size-3.5" aria-hidden />
              )}
            </button>
          ) : undefined
        }
      >
        {t("pinned")}
      </ChatSidebarSectionHeader>
      {/* A row being dragged translates past the section's box, and the
                animation's `overflow-hidden` would cut it off. Dropping the
                clip cannot cost the section its animation, because
                `canReorderPinned` carries `pinnedOpen`: the render that
                closes Pinned is already the render where `isReorderingPinned`
                reads false, so the collapse clips as every other section
                does. */}
      <SidebarSectionContent
        className={cn(isReorderingPinned && "overflow-visible")}
      >
        {isReorderingPinned ? (
          <PinnedRoomsDndContext roomIds={pinnedRoomIds} onReorder={onReorder}>
            <SidebarMenu className="gap-0">
              {pinned.map((room, index) => (
                <SortablePinnedRoomRow
                  key={room.id}
                  index={index}
                  {...roomRowProps(room)}
                  onMoveUp={movePinnedTo(room.id, pinnedRoomIds[index - 1])}
                  onMoveDown={movePinnedTo(room.id, pinnedRoomIds[index + 1])}
                />
              ))}
            </SidebarMenu>
          </PinnedRoomsDndContext>
        ) : (
          <SidebarMenu className="gap-0">
            {pinned.map((room) => (
              <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
            ))}
          </SidebarMenu>
        )}
      </SidebarSectionContent>
    </Collapsible>
  );
}
