"use client";

import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatComposeSokoBot } from "@/app/chat/actions";
import { shouldShowRoomRosterControl } from "@/app/chat/utils/should-show-room-roster-control";
import { ChannelDiscoverabilityIcon } from "@/components/chat/channel-discoverability-icon";
import { LiveMemberPresenceDot } from "@/components/chat/live-member-presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type {
  ChatRoom,
  ChatRoomMessage,
  Coworker,
  Member,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import { EditChannelDialog } from "./edit-channel-dialog";
import { PinnedMessagesHeaderButton } from "./pinned-messages-panel";
import { getRoomParticipantPreviews } from "./room-helpers";
import { ROOM_ROSTER_PANEL_ID } from "./room-roster-panel";
import { RoomSearchPanel } from "./room-search-panel";
import { UnreadThreadsPanel } from "./unread-threads-panel";

function RoomParticipantStack({
  room,
  rosterOpen,
  onToggleRoster,
}: {
  room: ChatRoom;
  rosterOpen: boolean;
  onToggleRoster: () => void;
}) {
  const t = useTranslations("App.Channels");
  const participants = getRoomParticipantPreviews(room);
  const visibleParticipants = participants.slice(0, 4);
  const remainingCount = participants.length - visibleParticipants.length;

  if (participants.length === 0) {
    return null;
  }

  return (
    <button
      type="button"
      className="flex -space-x-2 cursor-pointer rounded-full outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("RoomRoster.open")}
      title={t("RoomRoster.open")}
      aria-expanded={rosterOpen}
      aria-controls={ROOM_ROSTER_PANEL_ID}
      data-testid="room-roster-trigger"
      onClick={onToggleRoster}
    >
      {visibleParticipants.map((participant, index) => (
        <span
          key={`${participant.kind}-${participant.id}`}
          className="relative inline-flex size-6 shrink-0 md:size-7"
          style={{ zIndex: visibleParticipants.length - index }}
        >
          <Avatar className="ring-border/60 size-full shadow-xs ring-1">
            <AvatarImage src={participant.image ?? undefined} alt="" />
            <AvatarFallback
              className={cn(
                "text-[0.625rem]",
                participant.kind === "coworker" ||
                  participant.kind === "sokoBot"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {getInitials(participant.name)}
            </AvatarFallback>
          </Avatar>
          {/* No availability text here on purpose. This button is one control
              named "open the roster", and its own aria-label already replaces
              every descendant word. Per-person availability belongs to the
              roster it opens, which states it per row. */}
          <LiveMemberPresenceDot
            className="absolute -right-0.5 -bottom-0.5"
            fallback={participant.presence}
            isCoworker={
              participant.kind === "coworker" || participant.kind === "sokoBot"
            }
            userId={participant.id}
          />
        </span>
      ))}
      {remainingCount > 0 ? (
        <span
          className="bg-muted text-muted-foreground ring-border/60 relative inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium shadow-xs ring-1 md:size-7"
          style={{ zIndex: 0 }}
          aria-hidden
        >
          +{remainingCount}
        </span>
      ) : null}
    </button>
  );
}

export interface RoomHeaderChromeProps {
  room: ChatRoom;
  displayName: string;
  isDirectRoom: boolean;
  onJumpToMessage: (hit: ChatRoomMessage) => void;
  threadListOpen: boolean;
  onToggleThreadList: () => void;
  pinnedOpen: boolean;
  onTogglePinned: () => void;
  rosterOpen: boolean;
  onToggleRoster: () => void;
  currentUserId: string;
  organizationMembers: Member[];
  coworkers: Coworker[];
  sokoBots: ChatComposeSokoBot[];
  canEditMembers: boolean;
  canManageSettings: boolean;
  canArchive: boolean;
  canLeave: boolean;
  canInviteGuests: boolean;
  membersLoadFailed: boolean;
  /** The dialog's open flag. The shell owns it: the title is one way in. */
  editOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  /** When false, skip avatar stack so title can paint without it. */
  showParticipants: boolean;
}

export function RoomHeaderChrome({
  room,
  displayName,
  isDirectRoom,
  onJumpToMessage,
  threadListOpen,
  onToggleThreadList,
  pinnedOpen,
  onTogglePinned,
  rosterOpen,
  onToggleRoster,
  currentUserId,
  organizationMembers,
  coworkers,
  sokoBots,
  canEditMembers,
  canManageSettings,
  canArchive,
  canLeave,
  canInviteGuests,
  membersLoadFailed,
  editOpen,
  onEditOpenChange,
  showParticipants,
}: RoomHeaderChromeProps) {
  const t = useTranslations("App.Channels");
  const trimmedTopic = room.topic?.trim() ?? "";
  const channelTopic = !isDirectRoom && trimmedTopic ? trimmedTopic : null;

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5 overflow-hidden md:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden md:gap-2">
        {isDirectRoom ? (
          <>
            <MessageCircle className="text-muted-foreground size-4 shrink-0" />
            <p
              className="text-foreground min-w-0 truncate text-sm"
              data-testid="room-open-title"
            >
              {displayName}
            </p>
          </>
        ) : (
          <>
            <EditChannelDialog
              channel={room}
              members={organizationMembers}
              coworkers={coworkers}
              sokoBots={sokoBots}
              currentUserId={currentUserId}
              canEditMembers={canEditMembers}
              canManageSettings={canManageSettings}
              canArchive={canArchive}
              canLeave={canLeave}
              canInviteGuests={canInviteGuests}
              membersLoadFailed={membersLoadFailed}
              open={editOpen}
              onOpenChange={onEditOpenChange}
            >
              <button
                type="button"
                className={cn(
                  "text-foreground [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:dark:hover:bg-accent/50 flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:gap-2",
                  channelTopic && "shrink-0",
                )}
                title={t("editChannel")}
                data-testid="room-open-title"
              >
                <ChannelDiscoverabilityIcon
                  className="text-muted-foreground"
                  discoverability={room.discoverability}
                />
                <span className="min-w-0 truncate">{displayName}</span>
              </button>
            </EditChannelDialog>
            {channelTopic ? (
              <p
                className="text-muted-foreground min-w-0 flex-1 truncate text-sm"
                title={channelTopic}
                data-testid="room-open-topic"
              >
                {channelTopic}
              </p>
            ) : null}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <div className="flex items-center">
          <RoomSearchPanel
            key={room.id}
            roomId={room.id}
            onJumpToMessage={onJumpToMessage}
            labels={{
              open: t("RoomSearch.open"),
              placeholder: t("RoomSearch.placeholder"),
              idle: t("RoomSearch.idle"),
              empty: t("RoomSearch.empty"),
              loading: t("RoomSearch.loading"),
              error: t("RoomSearch.error"),
              replyBadge: t("RoomSearch.replyBadge"),
            }}
          />
          {isDirectRoom ? null : (
            <PinnedMessagesHeaderButton
              isOpen={pinnedOpen}
              onToggle={onTogglePinned}
              openLabel={t("PinnedMessages.open")}
            />
          )}
          <UnreadThreadsPanel
            key={`unread-threads-${room.id}`}
            isOpen={threadListOpen}
            onToggle={onToggleThreadList}
            labels={{
              open: t("UnreadThreads.open"),
            }}
          />
        </div>
        {showParticipants && shouldShowRoomRosterControl(room) ? (
          <RoomParticipantStack
            room={room}
            rosterOpen={rosterOpen}
            onToggleRoster={onToggleRoster}
          />
        ) : null}
      </div>
    </div>
  );
}
