import type { ChatRoom } from "@sokosumi/core-client";

/**
 * Mirrors Core's sidebar rule (ADR-0059): External channels, hosted or as a
 * Guest, matched channels and Personal Directs with only humans show in every
 * workspace, so a member opens them from any and they survive a switch.
 */
export function isShownInEveryWorkspace(
  room: Pick<
    ChatRoom,
    | "organizationId"
    | "kind"
    | "discoverability"
    | "myAccess"
    | "coworkerMembers"
    | "sokoBotMembers"
  >,
): boolean {
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
