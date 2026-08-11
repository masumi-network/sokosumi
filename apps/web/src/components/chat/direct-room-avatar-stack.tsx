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
import { LiveMemberPresenceDot } from "@/components/chat/live-member-presence-dot";
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

  // Fixed size-5 box so group stacks cannot widen the leading column.
  // Extra faces overlap to the right (absolute) and may paint into the gap.
  // Position on an outer span — HoverCard trigger forces `relative` and would
  // fight `absolute` if both lived on the same node.
  return (
    <span className="relative size-5 shrink-0">
      {participants.map((participant, index) => (
        <span
          key={`${participant.kind}-${participant.id}`}
          className={cn(
            "absolute top-1/2 -translate-y-1/2",
            index === 0 && "left-0",
            index === 1 && "left-1.5",
            index === 2 && "left-3",
          )}
          style={{ zIndex: participants.length - index }}
        >
          <ChatParticipantHoverCard
            profile={participant}
            side="right"
            align="start"
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
              <Avatar className="border-sidebar-background size-5 border">
                <AvatarImage alt="" src={participant.image ?? undefined} />
                <AvatarFallback className="text-[0.5625rem] font-medium">
                  {getInitials(participant.name)}
                </AvatarFallback>
              </Avatar>
              <LiveMemberPresenceDot
                className="-right-0.5 -bottom-0.5 absolute size-2"
                fallback={participant.presence}
                isCoworker={participant.kind === "coworker"}
                userId={participant.id}
              />
            </span>
          </ChatParticipantHoverCard>
        </span>
      ))}
    </span>
  );
}
