import { MessageCircle } from "lucide-react";

import {
  type ChatParticipantHoverProfile,
  getRoomParticipantPreviews,
} from "@/app/chat/components/room-helpers";
import {
  LiveMemberPresenceDot,
  LiveMemberPresenceText,
} from "@/components/chat/live-member-presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

interface DirectRoomAvatarStackProps {
  room: ChatRoom;
  currentUserId: string;
}

/** Direct avatars show peers, or the owner for Self Direct. */
function getDirectParticipants(
  room: ChatRoom,
  currentUserId: string,
): ChatParticipantHoverProfile[] {
  return getRoomParticipantPreviews(room)
    .filter(
      (participant) =>
        room.isSelfDirect ||
        participant.kind === "coworker" ||
        participant.id !== currentUserId,
    )
    .slice(0, 3);
}

/**
 * Avatar stack for sidebar DM rows. Purely presentational: the row link owns
 * navigation and the row is the direct itself, so no per-face hover card.
 *
 * A 1:1 row states availability as hidden text, because it is the only surface
 * that can: `shouldShowRoomRosterControl` gives a two-person direct no roster
 * panel, so nothing else in the product would announce it. One participant
 * means one state, and the row label is that person's name, so the text needs
 * no name of its own.
 *
 * A group row states nothing. Its label already lists these same people in this
 * same order, so a state per face would have to repeat the name to attach to
 * anything and the link would speak every name twice. There the mark stays a
 * visual cue and the room's roster panel reports per person.
 *
 * Collapsed to icons the face grows from 20px to 24px. Inter's M and W run
 * about 40% wider than A or E, and a circle's usable width at cap height is
 * well short of its diameter, so at 20px a "MA" or "WM" fallback touches the
 * rim while "AT" sits fine. 24px holds every pair at the same 9px type. A group
 * row shows its first face alone there: the 40px button cannot hold a stack of
 * 24px faces, and the button's tooltip already names everyone in the room.
 */
export function DirectRoomAvatarStack({
  room,
  currentUserId,
}: DirectRoomAvatarStackProps) {
  const participants = getDirectParticipants(room, currentUserId);

  if (participants.length === 0) {
    return (
      <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium md:size-5 group-data-[collapsible=icon]:size-6">
        <MessageCircle className="size-4 md:size-3" aria-hidden />
      </span>
    );
  }

  return (
    <span className="inline-flex h-7 min-w-7 shrink-0 items-center md:h-5 md:min-w-5 group-data-[collapsible=icon]:h-6 group-data-[collapsible=icon]:min-w-6">
      {participants.map((participant, index) => {
        // Soko bots are AI too, so they report always-online like coworkers
        // (ADR-0003). Miss the second arm and the row says "Offline" while the
        // roster panel says "Online" for the same member.
        const isAi =
          participant.kind === "coworker" || participant.kind === "sokoBot";

        return (
          <span
            key={`${participant.kind}-${participant.id}`}
            className={cn(
              "relative inline-flex",
              index > 0 &&
                "-ml-3 md:-ml-2 group-data-[collapsible=icon]:hidden",
            )}
            style={{ zIndex: participants.length - index }}
            data-testid={`dm-sidebar-avatar-${participant.id}`}
          >
            <Avatar className="border-sidebar size-7 border md:size-5 group-data-[collapsible=icon]:size-6">
              <AvatarImage alt="" src={participant.image ?? undefined} />
              <AvatarFallback className="text-[0.6875rem] font-medium md:text-[0.5625rem]">
                {getInitials(participant.name)}
              </AvatarFallback>
            </Avatar>
            {!room.isSelfDirect ? (
              <LiveMemberPresenceDot
                className="-right-0.5 -bottom-0.5 absolute size-2.5 border md:size-2"
                fallback={participant.presence}
                ground="sidebar"
                isCoworker={isAi}
                userId={participant.id}
              />
            ) : null}
            {participants.length === 1 && !room.isSelfDirect ? (
              <LiveMemberPresenceText
                className="sr-only"
                fallback={participant.presence}
                isCoworker={isAi}
                userId={participant.id}
              />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
