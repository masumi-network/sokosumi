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
 * The leading face of a sidebar Direct row. Purely presentational: the row
 * link owns navigation and the row is the direct itself, so no per-face
 * hover card.
 *
 * One 24px face, whoever else is in the room, because a **Sidebar row**'s
 * mark is one 24px slot (CONTEXT.md) and a stack is not: three 24px faces
 * overlapping run 56px, which spills out of the slot and over the name
 * beside it, and shrinking them to fit turns a group into three coloured
 * dots — the same reason Soko Bots stopped stacking. The room's label lists
 * everyone in this same order, and its tooltip repeats that on the rail, so
 * the stack was saying a second time what the row already said.
 *
 * 24px rather than the 20px it used to be expanded: Inter's M and W run about
 * 40% wider than A or E, and a circle's usable width at cap height is well
 * short of its diameter, so at 20px a "MA" or "WM" fallback touched the rim
 * while "AT" sat fine. 24px holds every pair at the same 9px type.
 *
 * A 1:1 row states availability as hidden text, because it is the only
 * surface that can: `shouldShowRoomRosterControl` gives a two-person direct
 * no roster panel, so nothing else in the product would announce it. One
 * participant means one state, and the row label is that person's name, so
 * the text needs no name of its own.
 *
 * A group row states nothing. Its label already lists these same people, so a
 * state per person would have to repeat the name to attach to anything and
 * the link would speak every name twice. There the face stays a visual cue
 * and the room's roster panel reports per person — which is also why the
 * shown face carries no presence dot in a group: one dot among several
 * people reads as the room's state rather than one person's.
 */
export function DirectRoomAvatarStack({
  room,
  currentUserId,
}: DirectRoomAvatarStackProps) {
  const participants = getDirectParticipants(room, currentUserId);
  const [participant] = participants;
  const isGroup = participants.length > 1;

  if (!participant) {
    return (
      <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium">
        <MessageCircle className="size-3.5" aria-hidden />
      </span>
    );
  }

  // Soko bots are AI too, so they report always-online like coworkers
  // (ADR-0003). Miss the second arm and the row says "Offline" while the
  // roster panel says "Online" for the same member.
  const isAi =
    participant.kind === "coworker" || participant.kind === "sokoBot";
  const showsPresence = !room.isSelfDirect && !isGroup;

  return (
    <span
      className="relative inline-flex"
      data-testid={`dm-sidebar-avatar-${participant.id}`}
    >
      <Avatar className="border-sidebar size-6 border">
        <AvatarImage alt="" src={participant.image ?? undefined} />
        <AvatarFallback className="text-[0.5625rem] font-medium">
          {getInitials(participant.name)}
        </AvatarFallback>
      </Avatar>
      {showsPresence ? (
        <>
          <LiveMemberPresenceDot
            className="-right-0.5 -bottom-0.5 absolute size-2 border"
            fallback={participant.presence}
            ground="sidebar"
            isCoworker={isAi}
            userId={participant.id}
          />
          <LiveMemberPresenceText
            className="sr-only"
            fallback={participant.presence}
            isCoworker={isAi}
            userId={participant.id}
          />
        </>
      ) : null}
    </span>
  );
}
