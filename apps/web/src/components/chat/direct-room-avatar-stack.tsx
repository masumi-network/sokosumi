import type { ChatRoom } from "@sokosumi/core-client";
import { MessageCircle } from "lucide-react";
import { getDirectParticipants } from "@/components/chat/direct-room-participants";
import {
  LiveMemberPresenceDot,
  LiveMemberPresenceText,
} from "@/components/chat/live-member-presence-dot";
import { useLiveSokoBotStatus } from "@/components/chat/personal-assistant-chrome-store";
import { SOKO_BOT_STATUS_TONE } from "@/components/soko-bot/soko-bot-badges";
import { SokoBotStatusLine } from "@/components/soko-bot/soko-bot-status-line";
import { STATUS_TONE_DOT_CLASS } from "@/components/soko-bot/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

interface DirectRoomAvatarStackProps {
  room: ChatRoom;
  currentUserId: string;
}

/**
 * Avatar stack for sidebar DM rows. Purely presentational: the row link owns
 * navigation and the row is the direct itself, so no per-face hover card.
 *
 * Up to three 20px faces, with a 2px gap between them. One face cannot say "several people
 * are in here" — it reads as a direct with whoever that is — so a group row
 * keeps its stack and lets it widen the row's `SidebarRowSlot` to the right.
 * That is the one mark allowed to: the slot's left edge does not move, so the
 * first face still sits on the sidebar's 28px leading axis and it is only
 * that row's name that starts later than the 48px column. The stack must grow
 * rightward off a fixed edge, never outward from a centre, or the first face
 * leaves the axis every other mark sits on.
 *
 * 20px per face, not the 24px the slot itself is. A face is a filled circle
 * and the Channel row beside it carries a 16px hairline glyph, so a face that
 * fills the slot edge to edge outweighs every other mark in the list; 20px
 * sits between the two and lets a mixed Pinned section read as one list.
 *
 * The initials fallback drops to 8px with it, and that is what keeping 24px
 * was for: Inter's M and W run about 40% wider than A or E, and a circle's
 * usable width at cap height is well short of its diameter, so at 20px a "MA"
 * or "WM" pair touched the rim while "AT" sat fine. At 9px. A pair is the
 * rare case here — most faces are photographs — so it gets the smaller type
 * rather than every face getting a larger circle.
 *
 * A stacked row pays 2px of leading padding the single face does not. The
 * slot centres a mark narrower than itself, which puts a lone 20px face 2px
 * in; a stack is wider than the slot and so starts flush at its edge. Without
 * the padding a group row's first face would sit 2px left of every 1:1 face
 * under it, and those faces are the same shape in the same column.
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
 */
export function DirectRoomAvatarStack({
  room,
  currentUserId,
}: DirectRoomAvatarStackProps) {
  const participants = getDirectParticipants(room, currentUserId);
  const liveSokoBot = useLiveSokoBotStatus();
  // Former members are not here to be online, and their faces sit back.
  const showsPresence =
    participants.length === 1 && !room.isSelfDirect && !room.isReadOnly;

  if (participants.length === 0) {
    return (
      <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-medium">
        <MessageCircle className="size-3" aria-hidden />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        participants.length > 1 && "pl-0.5",
      )}
    >
      {participants.map((participant, index) => {
        // Soko bots are AI too, so they report always-online like coworkers
        // (ADR-0003). Miss the second arm and the row says "Offline" while the
        // roster panel says "Online" for the same member.
        const isAi =
          participant.kind === "coworker" || participant.kind === "sokoBot";
        // Your own bot: the status its sidebar row shows, not "Online".
        const ownBot =
          participant.kind === "sokoBot" && participant.id === liveSokoBot?.id
            ? liveSokoBot
            : null;

        return (
          <span
            key={`${participant.kind}-${participant.id}`}
            className={cn("relative inline-flex", index > 0 && "ms-0.5")}
            // The first face on top, so its presence dot is not buried under
            // the one beside it.
            style={{ zIndex: participants.length - index }}
            data-testid={`dm-sidebar-avatar-${participant.id}`}
          >
            <Avatar
              className={cn(
                "border-sidebar size-5 border",
                room.isReadOnly && "opacity-50 grayscale",
              )}
            >
              <AvatarImage alt="" src={participant.image ?? undefined} />
              <AvatarFallback className="text-2xs font-medium">
                {getInitials(participant.name)}
              </AvatarFallback>
            </Avatar>
            {showsPresence && ownBot ? (
              <>
                {/* No title: the badge's one word ("Idle") would contradict
                    the row's own ("Active 2h ago"), which the row already
                    shows and the text below announces. */}
                <span
                  aria-hidden
                  data-testid="dm-sidebar-bot-status"
                  className={cn(
                    "border-sidebar absolute -right-0.5 -bottom-0.5 size-2 rounded-full border",
                    STATUS_TONE_DOT_CLASS[SOKO_BOT_STATUS_TONE[ownBot.status]],
                  )}
                />
                {participants.length === 1 ? (
                  <SokoBotStatusLine bot={ownBot} className="sr-only" />
                ) : null}
              </>
            ) : showsPresence ? (
              <LiveMemberPresenceDot
                className="-right-0.5 -bottom-0.5 absolute size-2 border"
                fallback={participant.presence}
                ground="sidebar"
                isCoworker={isAi}
                userId={participant.id}
              />
            ) : null}
            {participants.length === 1 && showsPresence && !ownBot ? (
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
