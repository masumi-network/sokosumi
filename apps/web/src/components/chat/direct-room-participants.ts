import type { ChatRoom } from "@sokosumi/core-client";
import {
  type ChatParticipantHoverProfile,
  getRoomParticipantPreviews,
} from "@/app/chat/components/room-helpers";

/**
 * Direct avatars show peers, or the owner for Self Direct. With every peer
 * gone they show the Former members instead, so the row still says who the
 * Direct was with rather than falling back to a generic mark.
 */
export function getDirectParticipants(
  room: ChatRoom,
  currentUserId: string,
): ChatParticipantHoverProfile[] {
  const participants = getRoomParticipantPreviews(room).filter(
    (participant) =>
      room.isSelfDirect ||
      participant.kind === "coworker" ||
      participant.id !== currentUserId,
  );
  if (participants.length > 0) {
    return participants.slice(0, 3);
  }
  return room.formerUserMembers.slice(0, 3).map((member) => ({
    kind: "human",
    id: member.id,
    name: member.name || member.email,
    email: member.email,
    image: member.image,
    presence: "offline",
  }));
}

/** A Direct of you and one Soko Bot, which its row can say the status of. */
export function isDirectWithSokoBot(
  room: ChatRoom,
  currentUserId: string,
  sokoBotId: string,
): boolean {
  if (room.isSelfDirect || room.isReadOnly) return false;
  const participants = getDirectParticipants(room, currentUserId);
  return (
    participants.length === 1 &&
    participants[0]?.kind === "sokoBot" &&
    participants[0].id === sokoBotId
  );
}
