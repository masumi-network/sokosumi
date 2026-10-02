import type { ChatRoom } from "@sokosumi/core-client";
import type { ChatParticipantHoverProfile } from "@/app/chat/components/room-helpers";

type ChannelRoom = Pick<
  ChatRoom,
  | "kind"
  | "myAccess"
  | "discoverability"
  | "organizationId"
  | "userMembers"
  | "sokoBotMembers"
>;

/**
 * Who is in a Channel is changed by its host members: guests cannot, and a
 * matched channel's roster is managed by Sokosumi. Core enforces all of it;
 * the web hides only what Core would reject.
 */
export function canManageChannelMembers(room: ChannelRoom): boolean {
  return (
    room.kind === "channel" &&
    room.myAccess === "member" &&
    room.discoverability !== "matched" &&
    room.organizationId != null
  );
}

/** Name, topic, visibility and Archive: an organization owner or admin. */
export function canManageChannelSettings(
  room: ChannelRoom,
  isOrgOwnerOrAdmin: boolean,
): boolean {
  return isOrgOwnerOrAdmin && canManageChannelMembers(room);
}

/**
 * Any member can leave a Channel, except the last host member of a host-org
 * one: it would leave the channel with nobody to archive it. Matched channels
 * let the last member go (Core archives them), and guests may always leave.
 */
export function canLeaveChannel(room: ChannelRoom): boolean {
  return (
    room.kind === "channel" &&
    (room.myAccess === "guest" ||
      room.discoverability === "matched" ||
      room.userMembers.filter((member) => member.access === "member").length >
        1)
  );
}

/**
 * Remove from a Channel: guests and Coworkers by any host member, a host
 * member only by an organization owner or admin, and a Soko Bot only by its
 * owner. Never yourself; you leave instead.
 */
export function canRemoveChannelMember(
  room: ChannelRoom,
  participant: ChatParticipantHoverProfile,
  viewer: { currentUserId: string; isOrgOwnerOrAdmin: boolean },
): boolean {
  if (!canManageChannelMembers(room)) {
    return false;
  }
  if (participant.kind === "coworker") {
    return true;
  }
  if (participant.kind === "sokoBot") {
    return room.sokoBotMembers.some(
      (sokoBot) =>
        sokoBot.id === participant.id &&
        sokoBot.ownerUserId === viewer.currentUserId,
    );
  }
  if (participant.id === viewer.currentUserId) {
    return false;
  }
  const member = room.userMembers.find((user) => user.id === participant.id);
  return member?.access === "guest" || viewer.isOrgOwnerOrAdmin;
}
