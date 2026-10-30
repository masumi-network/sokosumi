"use client";

import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRoomWorkspaceName } from "@/app/chat/components/use-room-display-name";
import type { RoomReadReceipts } from "@/app/chat/hooks/use-room-read-receipts";
import { shouldShowRoomRosterControl } from "@/app/chat/utils/should-show-room-roster-control";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import {
  CHAT_TITLE_MARK_CLASS,
  ChannelDiscoverabilityIcon,
} from "@/components/chat/channel-discoverability-icon";
import { DirectRoomAvatarStack } from "@/components/chat/direct-room-avatar-stack";
import { LiveMemberPresenceDot } from "@/components/chat/live-member-presence-dot";
import { RoomDecisionsPopover } from "@/components/chat/signals/room-decisions-popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ButtonLoadingBar } from "@/components/ui/button-loading-bar";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import { EditChannelDialog } from "./edit-channel-dialog";
import { NameGroupDialog } from "./name-group-dialog";
import { orderRosterByReadRecency } from "./order-roster-by-read-recency";
import { PinnedMessagesHeaderButton } from "./pinned-messages-panel";
import { getRoomParticipantPreviews } from "./room-helpers";
import { ROOM_ROSTER_PANEL_ID } from "./room-roster-panel";
import { RoomSearchPanel } from "./room-search-panel";
import { UnreadThreadsPanel } from "./unread-threads-panel";

/**
 * A 1:1 or self Direct's title is not a button, but keeps the button's box,
 * so every room's title text starts at one x.
 */
const ROOM_TITLE_STATIC_CLASS =
  "text-foreground flex min-w-0 max-w-full items-center gap-1.5 px-1.5 py-0.5 text-sm md:gap-2";

/**
 * The room title as the way into its settings: a Channel's (its members panel
 * for anyone who cannot change them), or a group Direct's name.
 */
const ROOM_TITLE_BUTTON_CLASS = cn(
  ROOM_TITLE_STATIC_CLASS,
  "press [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:dark:hover:bg-card-background cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
);

const DIRECT_ICON = (
  <span className={cn("text-muted-foreground", CHAT_TITLE_MARK_CLASS)}>
    <MessageCircle />
  </span>
);

function RoomParticipantStack({
  room,
  rosterOpen,
  onToggleRoster,
  readReceipts,
}: {
  room: ChatRoom;
  rosterOpen: boolean;
  onToggleRoster: () => void;
  readReceipts: RoomReadReceipts;
}) {
  const t = useTranslations("App.Channels");
  // One stack, two facts. It is the roster — everyone, the viewer and the
  // machines included — but ordered most-recent-read first, so the faces that
  // fit are the freshest readers and the panel it opens names the rest with
  // their read times. Read state is deliberately not a second badge on the
  // face: presence already owns that corner, and two marks on a 24px circle
  // is mush.
  const participants = orderRosterByReadRecency(
    getRoomParticipantPreviews(room),
    readReceipts,
  );
  const visibleParticipants = participants.slice(0, 4);
  const remainingCount = participants.length - visibleParticipants.length;

  if (participants.length === 0) {
    return null;
  }

  return (
    <button
      type="button"
      className="flex -space-x-2 cursor-pointer rounded-full outline-none press hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
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
          className="relative inline-flex size-6 shrink-0"
          style={{ zIndex: visibleParticipants.length - index }}
        >
          <Avatar className="ring-border size-full shadow-xs ring-1">
            <AvatarImage src={participant.image ?? undefined} alt="" />
            <AvatarFallback
              className={cn(
                "text-2xs",
                participant.kind === "coworker" ||
                  participant.kind === "sokoBot"
                  ? "bg-primary-quinary text-primary"
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
          className="bg-muted text-muted-foreground ring-border relative inline-flex size-6 shrink-0 items-center justify-center rounded-full text-2xs font-medium shadow-xs ring-1"
          style={{ zIndex: 0 }}
          aria-hidden
        >
          +{remainingCount}
        </span>
      ) : null}
    </button>
  );
}

/**
 * A Room visit's workspace, on the line under the title (ADR-0061). Inline so
 * it truncates with that line. Choosing it switches there, and the room stays
 * open.
 */
function RoomVisitWorkspaceName({
  organizationId,
  organizationName,
}: Pick<ChatRoom, "organizationId" | "organizationName">) {
  const t = useTranslations("App.Channels");
  const workspaceName = useRoomWorkspaceName();
  const { handleSelectWorkspace, isPending } = useWorkspaceSwitcher();
  const name = workspaceName({ organizationId, organizationName });
  if (!name) return null;
  const label = t("headerVisitSwitch", { workspace: name });

  return (
    <>
      <button
        type="button"
        // Inset, because the line's own truncation clips an outer ring. A bar
        // needs a box to sweep inside, so only a running switch leaves `inline`.
        className={cn(
          "relative inline cursor-pointer rounded-sm outline-none focus-visible:text-foreground focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:underline",
          isPending &&
            "inline-block max-w-full cursor-progress truncate align-bottom",
        )}
        aria-label={label}
        title={label}
        aria-busy={isPending || undefined}
        aria-disabled={isPending || undefined}
        onClick={() => {
          if (isPending) return;
          // The switcher logs a failure; the reader stays on the visit.
          handleSelectWorkspace(organizationId).catch(() => undefined);
        }}
      >
        {name}
        {isPending ? <ButtonLoadingBar label={label} /> : null}
      </button>
      {" · "}
    </>
  );
}

export interface RoomHeaderChromeProps {
  room: ChatRoom;
  /** The room is not one of the active workspace's (ADR-0061). */
  isRoomVisit: boolean;
  displayName: string;
  isDirectRoom: boolean;
  onJumpToMessage: (hit: ChatRoomMessage) => void;
  threadListOpen: boolean;
  onToggleThreadList: () => void;
  /** Unread threads in this room, counted by the shell. */
  unreadThreadCount: number;
  pinnedOpen: boolean;
  onTogglePinned: () => void;
  rosterOpen: boolean;
  onToggleRoster: () => void;
  /** Show the members panel: a Channel title's click for a non-admin. */
  onOpenRoster: () => void;
  currentUserId: string;
  /**
   * Organization owner/admin: the Channel title opens its settings. Anyone
   * else's title opens the members panel.
   */
  canManageSettings: boolean;
  /** The dialog's open flag. The shell owns it: the title is one way in. */
  editOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  /** When false, skip avatar stack so title can paint without it. */
  showParticipants: boolean;
  /** Seen by — who on the roster has read this room. */
  readReceipts: RoomReadReceipts;
}

export function RoomHeaderChrome({
  room,
  isRoomVisit,
  displayName,
  isDirectRoom,
  onJumpToMessage,
  threadListOpen,
  onToggleThreadList,
  unreadThreadCount,
  pinnedOpen,
  onTogglePinned,
  rosterOpen,
  onToggleRoster,
  onOpenRoster,
  currentUserId,
  canManageSettings,
  editOpen,
  onEditOpenChange,
  showParticipants,
  readReceipts,
}: RoomHeaderChromeProps) {
  const t = useTranslations("App.Channels");
  const trimmedTopic = room.topic?.trim() ?? "";
  const channelTopic = !isDirectRoom && trimmedTopic ? trimmedTopic : null;
  // Every room has a second line, so the title sits at one height in all of
  // them: the Channel's topic, else a plain fact about the room.
  const subtitle =
    channelTopic ??
    (room.isSelfDirect
      ? t("headerSelfDirect")
      : isDirectRoom && !room.isGroupDirect
        ? t("headerDirect")
        : t("Browse.memberCount", {
            count: getRoomParticipantPreviews(room).length,
          }));
  const channelTitle = (
    <>
      <ChannelDiscoverabilityIcon
        className="text-muted-foreground"
        discoverability={room.discoverability}
      />
      <span className="min-w-0 truncate">{displayName}</span>
    </>
  );

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5 overflow-hidden py-1.5 md:gap-4">
      <div className="flex min-w-0 flex-1 flex-col items-start justify-center overflow-hidden">
        {isDirectRoom && room.isGroupDirect ? (
          <NameGroupDialog
            room={room}
            open={editOpen}
            onOpenChange={onEditOpenChange}
          >
            <button
              type="button"
              className={ROOM_TITLE_BUTTON_CLASS}
              title={t("GroupName.rename")}
              data-testid="room-open-title"
            >
              {DIRECT_ICON}
              <span className="min-w-0 truncate">{displayName}</span>
            </button>
          </NameGroupDialog>
        ) : isDirectRoom ? (
          <div className={ROOM_TITLE_STATIC_CLASS}>
            {room.isSelfDirect ? (
              <span className={CHAT_TITLE_MARK_CLASS}>
                <DirectRoomAvatarStack
                  room={room}
                  currentUserId={currentUserId}
                />
              </span>
            ) : (
              DIRECT_ICON
            )}
            <p className="min-w-0 truncate" data-testid="room-open-title">
              {displayName}
            </p>
          </div>
        ) : canManageSettings ? (
          <EditChannelDialog
            channel={room}
            open={editOpen}
            onOpenChange={onEditOpenChange}
          >
            <button
              type="button"
              className={ROOM_TITLE_BUTTON_CLASS}
              title={t("editChannel")}
              data-testid="room-open-title"
            >
              {channelTitle}
            </button>
          </EditChannelDialog>
        ) : (
          <button
            type="button"
            className={ROOM_TITLE_BUTTON_CLASS}
            title={t("RoomRoster.open")}
            aria-expanded={rosterOpen}
            aria-controls={ROOM_ROSTER_PANEL_ID}
            data-testid="room-open-title"
            onClick={onOpenRoster}
          >
            {channelTitle}
          </button>
        )}
        <p
          // Starts under the title text: the title's px-1.5, its mark's box
          // and the gap after it.
          className="text-muted-foreground max-w-full truncate ps-10 pe-1.5 text-xs md:ps-8.5"
          title={subtitle}
          data-testid="room-open-subtitle"
        >
          {isRoomVisit ? (
            <RoomVisitWorkspaceName
              organizationId={room.organizationId}
              organizationName={room.organizationName}
            />
          ) : null}
          {subtitle}
        </p>
      </div>
      {/* The row above clips at its padding edge. The threads badge hangs
          4px past the icon button (border, offset, and ring), and the last
          control's focus ring does the same. py-1.5 on that row and pe-1.5
          here keep both inside the clip. */}
      <div className="flex shrink-0 items-center gap-1 pe-1.5">
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
          {isDirectRoom ? null : (
            <RoomDecisionsPopover
              key={`decisions-${room.id}`}
              room={room}
              onJumpToMessage={onJumpToMessage}
            />
          )}
          <UnreadThreadsPanel
            key={`unread-threads-${room.id}`}
            isOpen={threadListOpen}
            onToggle={onToggleThreadList}
            unreadCount={unreadThreadCount}
            labels={{
              open: t("UnreadThreads.open"),
              unreadThreads: (count) =>
                t("UnreadThreads.unreadThreads", { count }),
              unreadThreadsCapped: (max) =>
                t("UnreadThreads.unreadThreadsCapped", { max }),
            }}
          />
        </div>
        {showParticipants && shouldShowRoomRosterControl(room) ? (
          <RoomParticipantStack
            room={room}
            rosterOpen={rosterOpen}
            onToggleRoster={onToggleRoster}
            readReceipts={readReceipts}
          />
        ) : null}
      </div>
    </div>
  );
}
