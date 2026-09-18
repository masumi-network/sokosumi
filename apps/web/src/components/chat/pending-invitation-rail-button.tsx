"use client";

import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { ChannelRoomMark } from "./channel-room-mark";
import { RailAttentionPill } from "./chat-room-sidebar-row";

interface PendingInvitationRailButtonProps {
  roomName: string;
  /** "Invitation to {name} from {organization}", the expanded row's own name. */
  label: string;
}

/**
 * A pending External invitation on the collapsed rail. The expanded row is a
 * card with Accept and Decline, which a 32px square has no room for, so the
 * rail carries the Channel tile the room will have once joined, under the
 * mention-weight attention pill: an invitation is addressed to the reader.
 * Pressing it expands the sidebar, where the two answers live. Rendered
 * always and shown only collapsed, like the tile itself.
 */
export function PendingInvitationRailButton({
  roomName,
  label,
}: PendingInvitationRailButtonProps) {
  const { setOpen } = useSidebar();

  return (
    <>
      <RailAttentionPill variant="mention" />
      <SidebarMenuButton
        type="button"
        tooltip={label}
        onClick={() => setOpen(true)}
        className="hidden overflow-visible group-data-[collapsible=icon]:flex"
      >
        <ChannelRoomMark
          room={{ name: roomName, discoverability: "external" }}
        />
        <span className="sr-only">{label}</span>
      </SidebarMenuButton>
    </>
  );
}
