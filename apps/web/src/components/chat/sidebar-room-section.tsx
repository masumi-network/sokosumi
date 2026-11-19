"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import type { ReactNode } from "react";
import { Collapsible } from "@/components/ui/collapsible";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_INSET_CLASS } from "@/components/ui/sidebar-classes";
import { SidebarSectionContent } from "@/components/ui/sidebar-section";
import { cn } from "@/lib/utils";
import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
import { limitSidebarSectionRooms } from "./limit-sidebar-section-rooms";
import { resolveSectionAttention } from "./room-attention";
import { SidebarSectionShowMoreRow } from "./sidebar-section-show-more-row";
import { useSidebarSectionShowAll } from "./use-sidebar-section-show-all";

interface SidebarRoomSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "channels" | "direct";
  title: string;
  emptyMessage?: string;
  rooms: ChatRoom[];
  createAction: ReactNode;
  secondaryAction?: ReactNode;
  roomRowProps: (room: ChatRoom) => ChatRoomSidebarRowProps;
  keepInSection: (room: ChatRoom) => boolean;
}

export function SidebarRoomSection({
  kind,
  open,
  onOpenChange,
  title,
  emptyMessage,
  rooms,
  createAction,
  secondaryAction,
  roomRowProps,
  keepInSection,
}: SidebarRoomSectionProps) {
  const [showAll, setShowAll] = useSidebarSectionShowAll(kind);
  const { visible, hiddenCount } = limitSidebarSectionRooms(rooms, {
    showAll,
    alwaysShow: keepInSection,
  });
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <ChatSidebarSectionHeader
        isOpen={open}
        closedAttention={resolveSectionAttention(rooms)}
        createAction={createAction}
        secondaryAction={secondaryAction}
      >
        {title}
      </ChatSidebarSectionHeader>
      <SidebarSectionContent>
        <SidebarMenu className="gap-0">
          {visible.map((room) => (
            <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
          ))}
          {hiddenCount > 0 ? (
            <SidebarSectionShowMoreRow
              hiddenCount={hiddenCount}
              showAll={showAll}
              onShowAllChange={setShowAll}
            />
          ) : null}
          {emptyMessage ? (
            <SidebarMenuItem>
              <div
                className={cn(
                  SIDEBAR_ROW_LABEL_INSET_CLASS,
                  "text-muted-foreground py-1.5 pr-2 text-xs",
                )}
              >
                {emptyMessage}
              </div>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarSectionContent>
    </Collapsible>
  );
}
