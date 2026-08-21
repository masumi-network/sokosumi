import type { ChatRoom } from "@/lib/clients/generated/core";

/**
 * Room roster chrome (header stack + Members rail) is for channels and
 * group Directs. Human 1:1 and coworker 1:1 already name the other person
 * in the title.
 */
export function shouldShowRoomRosterControl(
  room: Pick<ChatRoom, "kind" | "userMembers" | "coworkerMembers">,
): boolean {
  if (room.kind !== "direct") {
    return true;
  }
  return room.userMembers.length + room.coworkerMembers.length > 2;
}
