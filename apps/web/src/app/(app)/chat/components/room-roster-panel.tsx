"use client";

import { Loader2, MessageCircle, X } from "lucide-react";
import { AuroraOrb } from "@/components/aurora-orb";
import { LiveMemberPresenceDot } from "@/components/chat/live-member-presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { copyTextWithToast } from "@/hooks/use-clipboard";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

import {
  canShowOpenDirect,
  participantDirectKey,
} from "./open-direct-with-participant";
import type { ChatParticipantHoverProfile } from "./room-helpers";

export const ROOM_ROSTER_PANEL_ID = "room-roster-panel";

export interface RoomRosterPanelLabels {
  title: string;
  close: string;
  empty: string;
  coworkerBadge: string;
  personalAssistantBadge?: string;
  message: (name: string) => string;
  copy: (value: string) => string;
  copySuccess: string;
  copyError: string;
}

function rosterMemberCaption(
  participant: ChatParticipantHoverProfile,
): string | null {
  if (participant.kind === "human") {
    return participant.email || null;
  }
  if (participant.kind === "sokoBot") {
    return participant.caption;
  }
  return participant.slug ? `@${participant.slug}` : null;
}

function RosterMemberAvatar({
  participant,
}: {
  participant: ChatParticipantHoverProfile;
}) {
  const isAi =
    participant.kind === "coworker" || participant.kind === "sokoBot";
  return (
    <span className="relative inline-flex size-8 shrink-0">
      {participant.kind === "sokoBot" &&
      participant.avatarSeed &&
      !participant.image ? (
        <AuroraOrb
          seed={participant.avatarSeed}
          size={64}
          alt=""
          className="ring-border/40 size-8 ring-1"
        />
      ) : (
        <Avatar className="size-8">
          <AvatarImage src={participant.image ?? undefined} alt="" />
          <AvatarFallback
            className={cn(
              "text-[0.625rem]",
              isAi
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {getInitials(participant.name)}
          </AvatarFallback>
        </Avatar>
      )}
      <LiveMemberPresenceDot
        className="absolute -right-0.5 -bottom-0.5"
        fallback={participant.presence}
        isCoworker={isAi}
        userId={participant.id}
      />
    </span>
  );
}

function RosterMemberRow({
  participant,
  canMessage,
  isOpening,
  isDirectActionBusy,
  onOpenDirect,
  labels,
}: {
  participant: ChatParticipantHoverProfile;
  canMessage: boolean;
  isOpening: boolean;
  isDirectActionBusy: boolean;
  onOpenDirect: (profile: ChatParticipantHoverProfile) => void;
  labels: RoomRosterPanelLabels;
}) {
  const messageLabel = labels.message(participant.name);
  const caption = rosterMemberCaption(participant);
  const copyLabel = caption ? labels.copy(caption) : null;

  const nameBlock = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-medium">{participant.name}</span>
      {participant.kind === "coworker" ? (
        <span className="text-muted-foreground shrink-0 text-xs">
          {labels.coworkerBadge}
        </span>
      ) : null}
      {participant.kind === "sokoBot" && labels.personalAssistantBadge ? (
        <span className="text-muted-foreground shrink-0 text-xs">
          {labels.personalAssistantBadge}
        </span>
      ) : null}
    </span>
  );

  const messageIcon = isOpening ? (
    <Loader2
      className="text-muted-foreground size-4 shrink-0 animate-spin"
      aria-hidden
    />
  ) : (
    <MessageCircle
      className="text-muted-foreground size-4 shrink-0 opacity-70 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
      data-testid="room-roster-message-icon"
      aria-hidden
    />
  );

  function handleOpenDirect() {
    onOpenDirect(participant);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        (canMessage || caption) && "hover:bg-accent",
      )}
      data-testid="room-roster-member"
    >
      {canMessage ? (
        <button
          type="button"
          className="shrink-0 cursor-pointer"
          tabIndex={-1}
          aria-hidden
          disabled={isOpening || isDirectActionBusy}
          onClick={handleOpenDirect}
        >
          <RosterMemberAvatar participant={participant} />
        </button>
      ) : (
        <RosterMemberAvatar participant={participant} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {canMessage ? (
          <button
            type="button"
            className="min-w-0 cursor-pointer truncate text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={messageLabel}
            title={messageLabel}
            disabled={isOpening || isDirectActionBusy}
            onClick={handleOpenDirect}
          >
            {nameBlock}
          </button>
        ) : (
          nameBlock
        )}
        {caption && copyLabel ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground max-w-full cursor-pointer self-start truncate text-left text-xs leading-tight outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={copyLabel}
            title={copyLabel}
            onClick={() => {
              void copyTextWithToast(caption, {
                copySuccessMessage: labels.copySuccess,
                copyErrorMessage: labels.copyError,
              });
            }}
          >
            {caption}
          </button>
        ) : null}
      </div>
      {canMessage ? (
        <button
          type="button"
          className="shrink-0 cursor-pointer"
          tabIndex={-1}
          aria-hidden
          disabled={isOpening || isDirectActionBusy}
          onClick={handleOpenDirect}
        >
          {messageIcon}
        </button>
      ) : null}
    </div>
  );
}

interface RoomRosterPanelProps {
  participants: ChatParticipantHoverProfile[];
  currentUserId: string;
  canOpenHumanDirect: boolean;
  onOpenDirect: (profile: ChatParticipantHoverProfile) => void;
  openingDirectKey: string | null;
  onClose: () => void;
  labels: RoomRosterPanelLabels;
}

export function RoomRosterPanel({
  participants,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirect,
  openingDirectKey,
  onClose,
  labels,
}: RoomRosterPanelProps) {
  return (
    <aside
      className="bg-background absolute inset-0 z-30 flex min-h-0 w-full shrink-0 flex-col lg:static lg:z-auto lg:w-80 lg:border-l"
      id={ROOM_ROSTER_PANEL_ID}
      data-testid="room-roster-panel"
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h2 className="truncate text-sm font-semibold">{labels.title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          aria-label={labels.close}
          title={labels.close}
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {participants.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.empty}
          </p>
        ) : (
          participants.map((participant) => (
            <RosterMemberRow
              key={`${participant.kind}-${participant.id}`}
              participant={participant}
              canMessage={canShowOpenDirect({
                profile: participant,
                currentUserId,
                canOpenHumanDirect,
                onOpenDirect,
              })}
              isOpening={openingDirectKey === participantDirectKey(participant)}
              isDirectActionBusy={openingDirectKey != null}
              onOpenDirect={onOpenDirect}
              labels={labels}
            />
          ))
        )}
      </div>
    </aside>
  );
}
