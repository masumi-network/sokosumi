"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ChatParticipantHoverCard } from "@/app/chat/components/chat-participant-hover-card";
import {
  openDirectWithParticipant,
  participantDirectKey,
} from "@/app/chat/components/open-direct-with-participant";
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
  canOpenHumanDirect: boolean;
  selectedRoomId: string | null;
}

/** Other humans + all coworkers in a direct room (excludes current user). */
function getDirectHoverProfiles(
  room: ChatRoom,
  currentUserId: string,
): ChatParticipantHoverProfile[] {
  return getRoomParticipantPreviews(room)
    .filter(
      (participant) =>
        participant.kind === "coworker" || participant.id !== currentUserId,
    )
    .slice(0, 3);
}

/**
 * Avatar stack for sidebar DM rows. Each face opens the shared participant
 * hover card (profile + Message). Trigger stays non-button because the row
 * link already owns keyboard/click navigation.
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
 * pointer affordance and the room's roster panel reports per person.
 */
export function DirectRoomAvatarStack({
  room,
  currentUserId,
  canOpenHumanDirect,
  selectedRoomId,
}: DirectRoomAvatarStackProps) {
  const router = useRouter();
  const [openingDirectKey, setOpeningDirectKey] = useState<string | null>(null);
  const participants = getDirectHoverProfiles(room, currentUserId);

  async function handleOpenDirect(profile: ChatParticipantHoverProfile) {
    if (openingDirectKey) return;
    setOpeningDirectKey(participantDirectKey(profile));
    try {
      await openDirectWithParticipant({
        profile,
        selectedRoomId,
        router,
        onError: toast.error,
      });
    } finally {
      setOpeningDirectKey(null);
    }
  }

  if (participants.length === 0) {
    return (
      <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium">
        <MessageCircle className="size-3" aria-hidden />
      </span>
    );
  }

  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center">
      {participants.map((participant, index) => {
        // Soko bots are AI too, so they report always-online like coworkers
        // (ADR-0003). Miss the second arm and the row says "Offline" while the
        // hover card on the same avatar says "Online".
        const isAi =
          participant.kind === "coworker" || participant.kind === "sokoBot";

        return (
          <ChatParticipantHoverCard
            key={`${participant.kind}-${participant.id}`}
            profile={participant}
            side="right"
            align="start"
            className={cn("relative block", index > 0 && "-ml-2")}
            style={{ zIndex: participants.length - index }}
            currentUserId={currentUserId}
            canOpenHumanDirect={canOpenHumanDirect}
            onOpenDirect={handleOpenDirect}
            isOpeningDirect={
              openingDirectKey === participantDirectKey(participant)
            }
            isDirectActionBusy={openingDirectKey != null}
            interactive={false}
          >
            <span
              className="relative inline-flex"
              data-testid={`dm-sidebar-avatar-${participant.id}`}
            >
              <Avatar className="border-sidebar size-5 border">
                <AvatarImage alt="" src={participant.image ?? undefined} />
                <AvatarFallback className="text-[0.5625rem] font-medium">
                  {getInitials(participant.name)}
                </AvatarFallback>
              </Avatar>
              <LiveMemberPresenceDot
                className="-right-0.5 -bottom-0.5 absolute size-2.5 border-[1.5px]"
                fallback={participant.presence}
                ground="sidebar"
                isCoworker={isAi}
                userId={participant.id}
              />
              {participants.length === 1 ? (
                <LiveMemberPresenceText
                  className="sr-only"
                  fallback={participant.presence}
                  isCoworker={isAi}
                  userId={participant.id}
                />
              ) : null}
            </span>
          </ChatParticipantHoverCard>
        );
      })}
    </span>
  );
}
