"use client";

import { flushSync } from "react-dom";
import {
  SidebarMenuButton,
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import { ChannelRoomMark } from "./channel-room-mark";
import { RailAttentionPill } from "./chat-room-sidebar-row";

interface PendingInvitationRailButtonProps {
  roomName: string;
  /** "Invitation to {name} from {organization}", the expanded row's own name. */
  label: string;
  /** The expanded row's Accept button, which takes focus once it is on screen. */
  acceptButtonId: string;
}

/**
 * A pending External invitation on the collapsed rail. The expanded row is a
 * card with Accept and Decline, which a 32px square has no room for, so the
 * rail carries the Channel tile the room will have once joined, under the
 * mention-weight attention pill: an invitation is addressed to the reader.
 * Pressing it expands the sidebar, where the two answers live. Rendered
 * always and shown only collapsed, like the tile itself.
 *
 * Expanding hides this button, and a hidden button drops focus to the body,
 * so a keyboard reader would land nowhere. Focus moves to Accept instead. The
 * expand is flushed first because Accept is `display: none` until it commits.
 */
export function PendingInvitationRailButton({
  roomName,
  label,
  acceptButtonId,
}: PendingInvitationRailButtonProps) {
  const { setOpen } = useSidebar();

  return (
    <>
      <RailAttentionPill variant="mention" />
      <SidebarMenuButton
        type="button"
        tooltip={label}
        onClick={() => {
          flushSync(() => setOpen(true));
          document.getElementById(acceptButtonId)?.focus();
        }}
        className="hidden overflow-visible group-data-[collapsible=icon]:flex"
      >
        <SidebarRowSlot>
          <ChannelRoomMark
            room={{ name: roomName, discoverability: "external" }}
          />
        </SidebarRowSlot>
        <span className="sr-only">{label}</span>
      </SidebarMenuButton>
    </>
  );
}
