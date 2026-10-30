import type { ChatRoom } from "@sokosumi/core-client";

/** What a room's place among the workspaces is worked out from. */
export type RoomWorkspaceScope = Pick<
  ChatRoom,
  | "organizationId"
  | "kind"
  | "discoverability"
  | "myAccess"
  | "coworkerMembers"
  | "sokoBotMembers"
>;

/**
 * Mirrors Core's sidebar rule (ADR-0059): External channels, hosted or as a
 * Guest, matched channels and Personal Directs with only humans show in every
 * workspace, so a member opens them from any and they survive a switch.
 */
export function isShownInEveryWorkspace(room: RoomWorkspaceScope): boolean {
  if (room.kind === "channel") {
    return (
      room.discoverability === "external" ||
      // Org-less matched channels open via roster membership, not host-org context.
      (room.organizationId === null &&
        room.discoverability === "matched" &&
        room.myAccess === "member")
    );
  }
  return (
    room.organizationId === null &&
    room.coworkerMembers.length === 0 &&
    room.sokoBotMembers.length === 0
  );
}

/**
 * Whether a room belongs to this workspace. Reading one that does not is a
 * Room visit (ADR-0061). It stays open across a switch to a workspace it
 * belongs to, and closes on a switch to any other.
 */
export function isRoomOfWorkspace(
  room: RoomWorkspaceScope,
  workspaceId: string | null,
): boolean {
  return isShownInEveryWorkspace(room) || room.organizationId === workspaceId;
}
