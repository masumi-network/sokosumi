"use client";

import { Hash, Loader2, MessageCircle } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  deleteRoomMessageAction,
  editRoomMessageAction,
  listRoomMessagesAction,
  listThreadMessagesAction,
  markThreadReadAction,
  sendRoomMessageAction,
  toggleMessageReactionAction,
} from "@/app/chat/actions";
import { CHAT_MESSAGE_LIST_SCROLLER_CLASS } from "@/app/chat/chat-message-list-scroller";
import { chatMobileHeightShellClass } from "@/app/chat/components/chat-mobile-tab-registry";
import DaySeparator from "@/app/chat/components/day-separator";
import { RoomSearchPanel } from "@/app/chat/components/room-search-panel";
import { UnreadThreadsPanel } from "@/app/chat/components/unread-threads-panel";
import { useClientLocalCalendarReady } from "@/app/chat/hooks/use-client-local-calendar-ready";
import {
  readStoredStreamParentMessageId,
  useCoworkerDirectRoomStream,
} from "@/app/chat/hooks/use-coworker-direct-room-stream";
import { useStickToBottom } from "@/app/chat/hooks/use-stick-to-bottom";
import {
  filterTopLevelChatRoomMessages,
  isReplyUnderThreadParent,
  isTopLevelChatRoomMessage,
  routeRealtimeChatRoomMessage,
} from "@/app/chat/utils/chat-room-message-scope";
import { composeDraftKey } from "@/app/chat/utils/compose-draft-storage";
import { formatDaySeparator } from "@/app/chat/utils/date-utils";
import {
  mergeMessagesWithStreamOverlay,
  mergeRoomMessages,
} from "@/app/chat/utils/merge-room-messages";
import { applyReplySoftDeleteToParentIfUnchanged } from "@/app/chat/utils/parent-thread-preview";
import { peekPendingRoomMessage } from "@/app/chat/utils/pending-room-message";
import { roomReadAttentionMarker } from "@/app/chat/utils/room-read-attention-marker";
import { shouldSignalUnreadThreadsAttention } from "@/app/chat/utils/should-signal-unread-threads-attention";
import { useHeaderRoomSlotHost } from "@/app/components/header/use-header-room-slot-host";
import { applyChatMembershipRevokedUi } from "@/components/chat/apply-chat-membership-revoked-ui";
import { ChannelDiscoverabilityIcon } from "@/components/chat/channel-discoverability-icon";
import { LiveMemberPresenceDot } from "@/components/chat/live-member-presence-dot";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { markOrganizationChatRoomReadAction } from "@/components/chat/organization-chat-list.actions";
import { applyRoomReadResultToOverlay } from "@/components/chat/room-read-overlay";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { useIsMobileMedia } from "@/hooks/use-mobile";
import {
  type ChatRoomMessageEventData,
  isChatRoomMessagePatchEvent,
} from "@/lib/ably";
import { applyChatRoomMessagePatch } from "@/lib/ably/apply-chat-room-message-patch";
import { hydrateChatRoomMessageFromRealtime } from "@/lib/ably/hydrate-chat-room-message";
import { useChatRoomRealtime } from "@/lib/ably/use-chat-room-realtime";
import type {
  ChatRoom,
  ChatRoomMessage,
  Coworker,
  Member,
  Organization,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { slugifyMentionValue } from "@/lib/utils/mention-parser";
import { getInitials } from "@/lib/utils/text";
import { ChatParticipantHoverCard } from "./chat-participant-hover-card";
import { RoomMessageListSkeleton } from "./chat-room-open-skeleton";
import { CreateChannelDialog } from "./create-channel-dialog";
import { DraftDirectMessage } from "./draft-direct-message";
import { EditChannelDialog } from "./edit-channel-dialog";
import { MembershipStatusRow } from "./membership-status-row";
import {
  openDirectWithParticipant,
  participantDirectKey,
} from "./open-direct-with-participant";
import { type RoomComposerHandle } from "./room-composer";
import { RoomFileDropZone } from "./room-file-drop-zone";
import {
  appendMessage,
  buildRoomAllMentionRecord,
  type ChatParticipantHoverProfile,
  getRoomDisplayName,
  getRoomParticipantPreviews,
  hasPendingCoworkerMention,
  isMessageContinuation,
  messageDayKey,
  type PendingRoomQuote,
  pendingQuoteFromMessage,
  ROOM_MENTION_ALL_ID,
  type RoomMentionParticipant,
  shouldIncludeRoomAllMention,
  shouldShowChatRoomThreadButton,
  shouldShowRoomMentionShortcut,
  shouldUseCoworkerRoomStream,
} from "./room-helpers";
import { ChatMessageRow } from "./room-message-row";
import {
  RoomSessionComposer,
  type RoomSessionSendRequest,
  type RoomSessionSendResult,
} from "./room-session-composer";
import { ThreadPanel } from "./thread-panel";

interface RoomsClientProps {
  /** Null in personal workspace when mounting Start New DM only. */
  activeOrganization: Organization | null;
  rooms: ChatRoom[];
  organizationMembers: Member[];
  currentUserId: string;
  coworkers: Coworker[];
  selectedRoomId: string | null;
  isCreateChannelRequested: boolean;
  isNewDirectMessage: boolean;
  messageLoadFailed: boolean;
  /** Org roster soft-fail; false for personal workspace (no org roster). */
  membersLoadFailed: boolean;
  messages: ChatRoomMessage[];
  /** Cursor for the next older page; null when the initial page is complete. */
  messagesNextCursor: string | null;
  /**
   * Progressive open: shell (header + composer) is ready, history still loading.
   * Shows message-list skeleton — never fake or half-rendered message bodies.
   */
  messagesPending?: boolean;
}

const COWORKER_RESPONSE_POLL_MS = 2500;
/** ~2.5 minutes of polling before we stop waiting for a coworker reply. */
const COWORKER_RESPONSE_POLL_MAX_ATTEMPTS = 60;
/**
 * Focused-room backstop for human peer traffic. Ably is still primary;
 * without a timer, dropped/lagged events only recover on focus/visibility and
 * then jump into the timeline by createdAt between already-shown own sends.
 */
const ROOM_LIVE_POLL_MS = 3000;

function RoomMessageRealtimeBridge({
  roomIds,
  currentUserId,
  selectedRoomId,
  onMessage,
}: {
  roomIds: readonly string[];
  currentUserId: string;
  selectedRoomId: string | null;
  onMessage: (event: ChatRoomMessageEventData) => void;
}) {
  const router = useRouter();
  const selectedRoomIdRef = useRef(selectedRoomId);
  selectedRoomIdRef.current = selectedRoomId;

  const handleMembershipRevoked = useCallback(
    (event: { roomId: string }) => {
      applyChatMembershipRevokedUi({
        roomId: event.roomId,
        activeRoomId: selectedRoomIdRef.current,
        replace: (href) => {
          router.replace(href);
        },
        refresh: () => {
          router.refresh();
        },
        notifyRemoved: (roomId) => {
          notifyOrganizationChatRoomsChanged({ removedRoomId: roomId });
        },
      });
    },
    [router],
  );

  useChatRoomRealtime({
    roomIds,
    currentUserId,
    onMessage,
    onMembershipRevoked: handleMembershipRevoked,
    onError: (error) => {
      console.error("Ably chat room message error:", error);
    },
  });
  return null;
}

function RoomParticipantStack({
  room,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirect,
  openingDirectKey,
}: {
  room: ChatRoom;
  currentUserId: string;
  canOpenHumanDirect: boolean;
  onOpenDirect: (profile: ChatParticipantHoverProfile) => void;
  openingDirectKey: string | null;
}) {
  const t = useTranslations("App.Channels");
  const participants = getRoomParticipantPreviews(room);
  const visibleParticipants = participants.slice(0, 4);
  const remainingCount = participants.length - visibleParticipants.length;

  if (participants.length === 0) {
    return null;
  }

  return (
    <div
      className="flex -space-x-2"
      aria-label={participants
        .map((participant) => participant.name)
        .join(", ")}
    >
      {visibleParticipants.map((participant, index) => (
        <ChatParticipantHoverCard
          key={`${participant.kind}-${participant.id}`}
          profile={participant}
          side="bottom"
          align="center"
          className="relative size-6 shrink-0 md:size-7"
          style={{ zIndex: visibleParticipants.length - index }}
          currentUserId={currentUserId}
          canOpenHumanDirect={canOpenHumanDirect}
          onOpenDirect={onOpenDirect}
          isOpeningDirect={
            openingDirectKey === participantDirectKey(participant)
          }
          isDirectActionBusy={openingDirectKey != null}
        >
          <span className="relative inline-flex size-full">
            <Avatar className="border-background ring-border/60 size-full border-2 shadow-xs ring-1">
              <AvatarImage src={participant.image ?? undefined} alt="" />
              <AvatarFallback
                className={cn(
                  "text-[0.625rem]",
                  participant.kind === "coworker"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {getInitials(participant.name)}
              </AvatarFallback>
            </Avatar>
            <LiveMemberPresenceDot
              className="absolute -right-0.5 -bottom-0.5"
              fallback={participant.presence}
              isCoworker={participant.kind === "coworker"}
              userId={participant.id}
            />
          </span>
        </ChatParticipantHoverCard>
      ))}
      {remainingCount > 0 ? (
        <span
          className="border-background bg-muted text-muted-foreground ring-border/60 relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[0.625rem] font-medium shadow-xs ring-1 md:size-7"
          style={{ zIndex: 0 }}
          aria-label={t("participantOverflowCount", { count: remainingCount })}
        >
          +{remainingCount}
        </span>
      ) : null}
    </div>
  );
}

interface RoomHeaderChromeProps {
  room: ChatRoom;
  displayName: string;
  isDirectRoom: boolean;
  currentUserId: string;
  canOpenHumanDirect: boolean;
  onOpenDirect: (profile: ChatParticipantHoverProfile) => void;
  openingDirectKey: string | null;
  topLevelRoomMessages: ChatRoomMessage[];
  onOpenThread: (message: ChatRoomMessage) => boolean | Promise<boolean>;
  attentionRefreshToken: number;
  onAllThreadsLooked: () => void;
  organizationMembers: Member[];
  coworkers: Coworker[];
  canEditMembers: boolean;
  canManageSettings: boolean;
  canArchive: boolean;
  canLeave: boolean;
  canInviteGuests: boolean;
  membersLoadFailed: boolean;
}

function RoomHeaderChrome({
  room,
  displayName,
  isDirectRoom,
  currentUserId,
  canOpenHumanDirect,
  onOpenDirect,
  openingDirectKey,
  topLevelRoomMessages,
  onOpenThread,
  attentionRefreshToken,
  onAllThreadsLooked,
  organizationMembers,
  coworkers,
  canEditMembers,
  canManageSettings,
  canArchive,
  canLeave,
  canInviteGuests,
  membersLoadFailed,
}: RoomHeaderChromeProps) {
  const t = useTranslations("App.Channels");

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5 overflow-hidden md:gap-4">
      <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
        {isDirectRoom ? (
          <MessageCircle className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChannelDiscoverabilityIcon
            className="text-muted-foreground"
            discoverability={room.discoverability}
          />
        )}
        <p className="text-muted-foreground truncate text-sm">{displayName}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        <RoomSearchPanel
          key={room.id}
          roomId={room.id}
          loadedMessages={topLevelRoomMessages}
          onOpenThread={onOpenThread}
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
        <UnreadThreadsPanel
          key={`unread-threads-${room.id}`}
          roomId={room.id}
          attentionRefreshToken={attentionRefreshToken}
          onOpenThread={onOpenThread}
          onAllThreadsLooked={onAllThreadsLooked}
          labels={{
            open: t("UnreadThreads.open"),
            title: t("UnreadThreads.title"),
            markAllRead: t("UnreadThreads.markAllRead"),
            empty: t("UnreadThreads.empty"),
            loading: t("UnreadThreads.loading"),
            error: t("UnreadThreads.error"),
            markAllReadError: t("UnreadThreads.markAllReadError"),
            startedBy: (name) => t("UnreadThreads.startedBy", { name }),
            unreadReplies: (count) =>
              t("UnreadThreads.unreadReplies", { count }),
          }}
        />
        <RoomParticipantStack
          room={room}
          currentUserId={currentUserId}
          canOpenHumanDirect={canOpenHumanDirect}
          onOpenDirect={onOpenDirect}
          openingDirectKey={openingDirectKey}
        />
        {isDirectRoom ? null : (
          <EditChannelDialog
            channel={room}
            members={organizationMembers}
            coworkers={coworkers}
            canEditMembers={canEditMembers}
            canManageSettings={canManageSettings}
            canArchive={canArchive}
            canLeave={canLeave}
            canInviteGuests={canInviteGuests}
            membersLoadFailed={membersLoadFailed}
          />
        )}
      </div>
    </div>
  );
}

export function RoomsClient({
  activeOrganization,
  rooms,
  organizationMembers,
  currentUserId,
  coworkers,
  selectedRoomId,
  isCreateChannelRequested,
  isNewDirectMessage,
  messageLoadFailed,
  membersLoadFailed,
  messages,
  messagesNextCursor,
  messagesPending = false,
}: RoomsClientProps) {
  const t = useTranslations("App.Channels");
  const tBreadcrumb = useTranslations("Components.Breadcrumb");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isApple = useIsApplePlatform();
  const isMobile = useIsMobileMedia();
  const headerRoomSlotHost = useHeaderRoomSlotHost();
  // Defer local day separators / continuation until after hydrate (SOKOSUMI-A).
  const localCalendarReady = useClientLocalCalendarReady();
  const [openingDirectKey, setOpeningDirectKey] = useState<string | null>(null);
  const [pendingQuote, setPendingQuote] = useState<PendingRoomQuote | null>(
    null,
  );
  const [messagesState, setMessagesState] =
    useState<ChatRoomMessage[]>(messages);
  const [olderNextCursor, setOlderNextCursor] = useState<string | null>(
    messagesNextCursor,
  );
  const [threadParentMessage, setThreadParentMessage] =
    useState<ChatRoomMessage | null>(null);
  const threadParentMessageRef = useRef<ChatRoomMessage | null>(null);
  threadParentMessageRef.current = threadParentMessage;
  const [threadMessages, setThreadMessages] = useState<ChatRoomMessage[]>([]);
  const [threadOlderNextCursor, setThreadOlderNextCursor] = useState<
    string | null
  >(null);
  const [pendingThreadQuote, setPendingThreadQuote] =
    useState<PendingRoomQuote | null>(null);
  const [editSession, setEditSession] = useState<{
    messageId: string;
    draft: string;
  } | null>(null);
  const [isSavingEdit, startSavingEditTransition] = useTransition();
  const composeSurfaceEpoch = `${selectedRoomId}:${isNewDirectMessage}:${isCreateChannelRequested}`;
  const [syncedComposeSurfaceEpoch, setSyncedComposeSurfaceEpoch] =
    useState(composeSurfaceEpoch);
  if (composeSurfaceEpoch !== syncedComposeSurfaceEpoch) {
    setSyncedComposeSurfaceEpoch(composeSurfaceEpoch);
    setPendingQuote(null);
    setThreadParentMessage(null);
    setThreadMessages([]);
    setPendingThreadQuote(null);
    setEditSession(null);
  }

  const roomComposerRef = useRef<RoomComposerHandle | null>(null);
  const {
    scrollerRef,
    contentRef,
    contentMinHeight,
    pinToBottomAfterOwnSend,
    scrollToBottomIfPinned,
  } = useStickToBottom({
    resetKey: selectedRoomId,
  });
  const readMarkerRef = useRef<string | null>(null);
  const syncedRoomIdRef = useRef<string | null>(null);
  // RoomsClient stays mounted across /chat/rooms/[id] navigations. Async
  // handlers must not merge into messagesState after the selection moved.
  const selectedRoomIdRef = useRef(selectedRoomId);
  selectedRoomIdRef.current = selectedRoomId;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const syncRoomAttentionAfterThreadLookRef = useRef<
    (roomId: string) => Promise<void>
  >(async () => {});
  const [attentionRefreshToken, setAttentionRefreshToken] = useState(0);
  const [syncedAttentionRoomId, setSyncedAttentionRoomId] =
    useState(selectedRoomId);
  if (selectedRoomId !== syncedAttentionRoomId) {
    setSyncedAttentionRoomId(selectedRoomId);
    setAttentionRefreshToken(0);
  }
  const [isSending, startSendingTransition] = useTransition();
  const [isThreadLoading, startThreadLoadingTransition] = useTransition();
  const [isSendingThreadReply, startSendingThreadReplyTransition] =
    useTransition();
  const [_isReacting, startReactionTransition] = useTransition();
  const [_isDeleting, startDeleteTransition] = useTransition();
  const [isLoadingOlder, startLoadingOlderTransition] = useTransition();
  const [isLoadingOlderThread, startLoadingOlderThreadTransition] =
    useTransition();
  const pendingReactionsRef = useRef<Set<string>>(new Set());
  // Classic POST send: one in-flight clientMessageId per composer. Blocks
  // double-submit before the server action settles; Core also dedups by id.
  const classicSendInFlightRef = useRef<string | null>(null);
  const classicThreadSendInFlightRef = useRef<string | null>(null);
  const selectedRoom = isNewDirectMessage
    ? null
    : (rooms.find((room) => room.id === selectedRoomId) ?? null);

  async function handleOpenDirectMessage(
    profile: ChatParticipantHoverProfile,
  ): Promise<void> {
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

  function isStillSelectedRoom(roomId: string): boolean {
    return selectedRoomIdRef.current === roomId;
  }
  const selectedRoomDisplayName = selectedRoom
    ? getRoomDisplayName(selectedRoom, currentUserId)
    : "";

  const isDirectRoom = selectedRoom?.kind === "direct";
  const isGuestInSelectedRoom = selectedRoom?.myAccess === "guest";
  // Guest rooms: no DM affordances from the host roster (channel-only guest).
  const canOpenHumanDirect =
    Boolean(activeOrganization) && !isGuestInSelectedRoom;
  const currentMemberRole = organizationMembers.find(
    (member) => member.user.id === currentUserId,
  )?.role;
  const isOrgOwnerOrAdmin =
    currentMemberRole === "owner" || currentMemberRole === "admin";
  // Host-org channel members rewrite roster; guests cannot.
  const canEditSelectedRoomMembers = Boolean(
    selectedRoom && !isDirectRoom && !isGuestInSelectedRoom,
  );
  // Name/topic/discoverability and archive: organization owner/admin only.
  // Guests never manage host channel settings.
  const canManageSelectedRoomSettings = Boolean(
    selectedRoom &&
      !isDirectRoom &&
      !isGuestInSelectedRoom &&
      isOrgOwnerOrAdmin,
  );
  const canArchiveSelectedRoom = canManageSelectedRoomSettings;
  // Host members on external channels invite guests; guests never invite.
  const canInviteGuestsToSelectedRoom = Boolean(
    selectedRoom &&
      !isDirectRoom &&
      !isGuestInSelectedRoom &&
      selectedRoom.myAccess === "member" &&
      selectedRoom.discoverability === "external",
  );
  // Any participant can leave, but not the last host-org member — an empty
  // host roster could not be archived (archive requires org owner/admin). Guests
  // do not count toward that floor; guests may always leave.
  const canLeaveSelectedRoom = Boolean(
    selectedRoom &&
      !isDirectRoom &&
      (isGuestInSelectedRoom ||
        selectedRoom.userMembers.filter((member) => member.access === "member")
          .length > 1),
  );
  const isCoworkerStreamRoom = selectedRoom
    ? shouldUseCoworkerRoomStream(selectedRoom)
    : false;

  const refreshRoomMessagesAfterStream = useCallback(
    async (roomId: string): Promise<boolean> => {
      // Prefer open panel; fall back to sessionStorage so settle still refreshes
      // the thread when the panel was closed mid-stream / after remount.
      const threadParentId =
        threadParentMessageRef.current?.id ??
        readStoredStreamParentMessageId(roomId);
      const [roomResult, threadResult] = await Promise.all([
        listRoomMessagesAction(roomId),
        threadParentId
          ? listThreadMessagesAction(roomId, threadParentId)
          : Promise.resolve(null),
      ]);
      if (!roomResult.ok) {
        toast.error(roomResult.error.message);
        return false;
      }
      if (!isStillSelectedRoom(roomId)) {
        return false;
      }
      setMessagesState((current) =>
        mergeRoomMessages(current, roomResult.value.messages),
      );
      if (threadResult?.ok && threadParentId) {
        setThreadMessages((current) =>
          mergeRoomMessages(current, threadResult.value.messages),
        );
        setThreadParentMessage((current) => {
          const fromRoom =
            roomResult.value.messages.find(
              (message) => message.id === threadParentId,
            ) ?? null;
          if (current) {
            return (
              roomResult.value.messages.find(
                (message) => message.id === current.id,
              ) ?? current
            );
          }
          return fromRoom;
        });
      }
      return true;
    },
    [],
  );

  const {
    streamOverlayMessages,
    isStreaming: isCoworkerStreaming,
    activeStreamParentMessageId,
    sendStreamMessage,
    consumePendingStreamMessage,
  } = useCoworkerDirectRoomStream({
    room: selectedRoom,
    enabled: isCoworkerStreamRoom,
    currentUserId,
    organizationSlug: activeOrganization?.slug ?? null,
    onStreamSettled: refreshRoomMessagesAfterStream,
  });

  const isCoworkerStreamingRef = useRef(isCoworkerStreaming);
  isCoworkerStreamingRef.current = isCoworkerStreaming;
  const skipRealtimeWhileStreamingRef = useRef(isCoworkerStreamRoom);
  skipRealtimeWhileStreamingRef.current = isCoworkerStreamRoom;
  const threadParentMessageIdRef = useRef<string | null>(null);
  threadParentMessageIdRef.current = threadParentMessage?.id ?? null;

  const handleChatRoomRealtimeMessage = useCallback(
    (event: ChatRoomMessageEventData) => {
      if (
        skipRealtimeWhileStreamingRef.current &&
        isCoworkerStreamingRef.current
      ) {
        return;
      }

      // SOK-737: high-chatter types arrive as field patches — merge by id.
      // Missing local id → no-op (do not invent a row). Patches are not new
      // messages, so skip unread-threads attention (full create path still does).
      if (isChatRoomMessagePatchEvent(event)) {
        if (event.roomId !== selectedRoomIdRef.current) {
          return;
        }

        const route = routeRealtimeChatRoomMessage(
          {
            id: event.messageId,
            parentMessageId: event.parentMessageId,
          },
          threadParentMessageIdRef.current,
          event.eventType,
        );

        if (route.mergeIntoRoomTimeline) {
          setMessagesState((current) => {
            const existing = current.find(
              (message) => message.id === event.messageId,
            );
            if (!existing) {
              return current;
            }
            const merged = applyChatRoomMessagePatch(existing, event);
            return filterTopLevelChatRoomMessages(
              mergeRoomMessages(current, [merged]),
            );
          });
        }

        setThreadParentMessage((current) => {
          if (current?.id !== event.messageId) {
            return current;
          }
          return applyChatRoomMessagePatch(current, event);
        });

        if (route.mergeIntoOpenThread) {
          setThreadMessages((current) => {
            const existing = current.find(
              (message) => message.id === event.messageId,
            );
            if (!existing) {
              return current;
            }
            return mergeRoomMessages(current, [
              applyChatRoomMessagePatch(existing, event),
            ]);
          });
        }
        return;
      }

      const message = hydrateChatRoomMessageFromRealtime(event.message);
      if (message.roomId !== selectedRoomIdRef.current) {
        return;
      }

      // Thread replies must not enter the main room list — otherwise a send
      // from the thread panel shows in both the room transcript and the panel.
      const route = routeRealtimeChatRoomMessage(
        message,
        threadParentMessageIdRef.current,
        event.eventType,
      );
      if (route.mergeIntoRoomTimeline) {
        setMessagesState((current) =>
          filterTopLevelChatRoomMessages(mergeRoomMessages(current, [message])),
        );
      }
      setThreadParentMessage((current) =>
        current?.id === message.id ? message : current,
      );

      if (
        shouldSignalUnreadThreadsAttention(message, currentUserIdRef.current)
      ) {
        setAttentionRefreshToken((token) => token + 1);
      }

      if (route.mergeIntoOpenThread) {
        setThreadMessages((current) => mergeRoomMessages(current, [message]));
        // Look first, then room re-sync — mark-read effect can race if it
        // runs before look lands; open path uses the same order.
        // Use the ref (not openThreadParentId) so this []-deps handler stays
        // current, and narrow null before calling markThreadReadAction.
        const openParentId = threadParentMessageIdRef.current;
        const roomId = message.roomId;
        if (openParentId != null && message.parentMessageId === openParentId) {
          void markThreadReadAction(roomId, openParentId).then(
            async (result) => {
              if (!result.ok) {
                return;
              }
              setAttentionRefreshToken((token) => token + 1);
              await syncRoomAttentionAfterThreadLookRef.current(roomId);
            },
          );
        }
      }
    },
    [],
  );

  const topLevelStreamOverlayMessages = useMemo(
    () => streamOverlayMessages.filter(isTopLevelChatRoomMessage),
    [streamOverlayMessages],
  );

  // Defense in depth: never render thread replies in the main room timeline,
  // even if stale state still holds a leaked reply from before this fix.
  const topLevelRoomMessages = useMemo(
    () => filterTopLevelChatRoomMessages(messagesState),
    [messagesState],
  );

  // Purge leaked thread replies from room state so consumers of messagesState
  // (pending-mention poll, search props) never see them after a prior leak.
  useEffect(() => {
    if (topLevelRoomMessages.length === messagesState.length) {
      return;
    }
    setMessagesState(topLevelRoomMessages);
  }, [messagesState, topLevelRoomMessages]);

  const displayMessages = useMemo(() => {
    return mergeMessagesWithStreamOverlay(
      topLevelRoomMessages,
      topLevelStreamOverlayMessages,
    );
  }, [topLevelRoomMessages, topLevelStreamOverlayMessages]);

  const threadStreamOverlayMessages = useMemo(() => {
    if (!threadParentMessage) {
      return [];
    }
    const parentId = threadParentMessage.id;
    return streamOverlayMessages.filter((message) =>
      isReplyUnderThreadParent(message, parentId),
    );
  }, [streamOverlayMessages, threadParentMessage]);

  const displayThreadMessages = useMemo(() => {
    // Defense: parent is rendered above the divider — never as a reply row.
    const parentId = threadParentMessage?.id;
    const replies =
      parentId == null
        ? threadMessages
        : threadMessages.filter((message) => message.id !== parentId);
    return mergeMessagesWithStreamOverlay(replies, threadStreamOverlayMessages);
  }, [threadMessages, threadStreamOverlayMessages, threadParentMessage?.id]);

  // Draft coworker DM stashes text then navigates — auto-stream once room opens.
  // Keep sessionStorage until stream actually starts so Strict Mode remount
  // cannot lose the draft before send begins.
  useEffect(() => {
    if (!isCoworkerStreamRoom || !selectedRoomId) {
      return;
    }
    const pending = peekPendingRoomMessage(selectedRoomId);
    if (!pending) {
      return;
    }
    consumePendingStreamMessage(pending);
  }, [isCoworkerStreamRoom, selectedRoomId, consumePendingStreamMessage]);

  // Re-open thread panel when a thread stream is active/resumed so overlays
  // stay visible after remount or if the panel was closed mid-stream.
  useEffect(() => {
    if (
      !isCoworkerStreamRoom ||
      !selectedRoom ||
      !activeStreamParentMessageId
    ) {
      return;
    }
    if (threadParentMessage?.id === activeStreamParentMessageId) {
      return;
    }
    const parent =
      topLevelRoomMessages.find(
        (message) => message.id === activeStreamParentMessageId,
      ) ?? null;
    if (!parent) {
      return;
    }
    loadThreadMessages(parent);
  }, [
    isCoworkerStreamRoom,
    selectedRoom,
    activeStreamParentMessageId,
    threadParentMessage?.id,
    topLevelRoomMessages,
  ]);

  // Pending draft stays in sessionStorage until stream settles successfully
  // (cleared in useCoworkerDirectRoomStream.onFinish). Clearing on stream
  // start lost the draft when the request failed after submit.

  const breadcrumbOverride = useMemo(
    () => ({
      pathname: selectedRoom ? `/chat/rooms/${selectedRoom.id}` : "/chat",
      segments: [
        {
          label: tBreadcrumb("chat"),
          href: "/chat",
        },
        ...(selectedRoom
          ? [
              {
                label: selectedRoomDisplayName,
                href: `/chat/rooms/${selectedRoom.id}`,
              },
            ]
          : isCreateChannelRequested
            ? [
                {
                  label: t("CreateWizard.title"),
                  href: "/chat?create=channel",
                },
              ]
            : isNewDirectMessage
              ? [
                  {
                    label: t("Draft.breadcrumb"),
                    href: "/chat?dm=new",
                  },
                ]
              : []),
      ],
    }),
    [
      selectedRoom,
      selectedRoomDisplayName,
      isCreateChannelRequested,
      isNewDirectMessage,
      t,
      tBreadcrumb,
    ],
  );
  useRegisterBreadcrumbOverride(breadcrumbOverride);
  const coworkersById = useMemo(() => {
    return new Map(
      (selectedRoom?.coworkerMembers ?? []).map((coworker) => [
        coworker.id,
        coworker,
      ]),
    );
  }, [selectedRoom]);
  const coworkersBySlug = useMemo(() => {
    return new Map(
      (selectedRoom?.coworkerMembers ?? []).map((coworker) => [
        coworker.slug,
        coworker,
      ]),
    );
  }, [selectedRoom]);
  const usersById = useMemo(() => {
    return new Map(
      (selectedRoom?.userMembers ?? []).map((user) => [user.id, user]),
    );
  }, [selectedRoom]);
  const usersBySlug = useMemo(() => {
    return new Map(
      (selectedRoom?.userMembers ?? []).map((user) => [
        slugifyMentionValue(user.name),
        user,
      ]),
    );
  }, [selectedRoom]);
  const mentionRecords = useMemo<
    Record<string, MentionRecordEntry<RoomMentionParticipant>>
  >(() => {
    const humanEntries = (selectedRoom?.userMembers ?? [])
      .filter((user) => user.id !== currentUserId)
      .map((user) => {
        const participant: RoomMentionParticipant = {
          kind: "human",
          id: user.id,
          name: user.name,
          slug: slugifyMentionValue(user.name),
          image: user.image,
        };
        return [
          user.id,
          {
            value: user.name,
            slug: participant.slug,
            data: participant,
          },
        ] as const;
      });
    const coworkerEntries = (selectedRoom?.coworkerMembers ?? []).map(
      (coworker) => {
        const participant: RoomMentionParticipant = {
          kind: "coworker",
          id: coworker.id,
          name: coworker.name,
          slug: coworker.slug,
          image: coworker.image,
        };
        return [
          coworker.id,
          {
            value: coworker.name,
            slug: coworker.slug,
            data: participant,
          },
        ] as const;
      },
    );
    const entries = [...humanEntries, ...coworkerEntries];
    if (
      selectedRoom &&
      shouldIncludeRoomAllMention(selectedRoom, currentUserId)
    ) {
      // Pin @all first so the picker surfaces it above long member lists.
      entries.unshift([
        ROOM_MENTION_ALL_ID,
        buildRoomAllMentionRecord(t("MentionAll.label")),
      ] as const);
    }
    return Object.fromEntries(entries);
  }, [currentUserId, selectedRoom, t]);

  function partitionMentionIds(selectedKeys: string[]): {
    mentionedCoworkerIds: string[];
    mentionedUserIds: string[];
  } {
    const mentionedCoworkerIds: string[] = [];
    const mentionedUserIds: string[] = [];
    for (const id of selectedKeys) {
      if (coworkersById.has(id)) {
        mentionedCoworkerIds.push(id);
      } else if (usersById.has(id) && id !== currentUserId) {
        mentionedUserIds.push(id);
      }
    }
    return { mentionedCoworkerIds, mentionedUserIds };
  }

  useEffect(() => {
    const isChannelSwitch = syncedRoomIdRef.current !== selectedRoomId;
    syncedRoomIdRef.current = selectedRoomId;

    // Room switch: replace. Same room RSC refresh (e.g. revalidatePath):
    // merge so client-loaded older pages are not wiped by the latest page.
    if (isChannelSwitch) {
      setMessagesState(messages);
      setOlderNextCursor(messagesNextCursor);
    } else {
      setMessagesState((current) => mergeRoomMessages(current, messages));
    }
    setThreadParentMessage((current) =>
      current
        ? (messages.find((message) => message.id === current.id) ?? current)
        : current,
    );
  }, [messages, messagesNextCursor, selectedRoomId]);

  const latestTopLevelMessageId = displayMessages.at(-1)?.id ?? null;
  const latestOpenThreadMessageId = displayThreadMessages.at(-1)?.id ?? null;
  const openThreadParentId = threadParentMessage?.id ?? null;
  const selectedRoomReadId = selectedRoom?.id ?? null;

  useEffect(() => {
    if (!selectedRoomReadId) {
      return;
    }

    // Include open-thread activity: thread replies count toward room unread
    // via look baseline, but top-level-only markers never re-fired mark-read.
    const marker = roomReadAttentionMarker({
      roomId: selectedRoomReadId,
      latestTopLevelMessageId,
      openThreadParentId,
      latestOpenThreadMessageId,
    });
    if (readMarkerRef.current === marker) {
      return;
    }
    readMarkerRef.current = marker;

    let cancelled = false;
    markOrganizationChatRoomReadAction(selectedRoomReadId).then((result) => {
      if (!result.ok) {
        return;
      }
      applyRoomReadResultToOverlay(result.value);
      if (cancelled) {
        return;
      }
      window.dispatchEvent(
        new CustomEvent("organization-chat-room-read", {
          detail: { room: result.value, roomId: selectedRoomReadId },
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    latestOpenThreadMessageId,
    latestTopLevelMessageId,
    openThreadParentId,
    selectedRoomReadId,
  ]);

  const hasPendingRoomCoworkerMention = useMemo(
    () => hasPendingCoworkerMention(topLevelRoomMessages),
    [topLevelRoomMessages],
  );
  const hasPendingThreadCoworkerMention = useMemo(
    () => hasPendingCoworkerMention(threadMessages),
    [threadMessages],
  );

  useEffect(() => {
    if (!selectedRoom || !hasPendingRoomCoworkerMention) {
      return;
    }

    const roomId = selectedRoom.id;
    let cancelled = false;
    let timeoutId: number | undefined;

    let attempts = 0;

    const pollMessages = async () => {
      // A mention that never reaches a terminal state used to poll forever, in
      // background tabs too. Skip ticks while hidden and give up after a bound;
      // `visibilitychange` restarts the loop when the user comes back.
      if (document.visibilityState !== "visible") {
        timeoutId = window.setTimeout(pollMessages, COWORKER_RESPONSE_POLL_MS);
        return;
      }
      if (attempts >= COWORKER_RESPONSE_POLL_MAX_ATTEMPTS) {
        return;
      }
      attempts += 1;
      const result = await listRoomMessagesAction(roomId);
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setMessagesState((current) =>
          mergeRoomMessages(current, result.value.messages),
        );
        setThreadParentMessage((current) =>
          current
            ? (result.value.messages.find(
                (message) => message.id === current.id,
              ) ?? current)
            : current,
        );
      }
      timeoutId = window.setTimeout(pollMessages, COWORKER_RESPONSE_POLL_MS);
    };

    const restartWhenVisible = () => {
      if (document.visibilityState === "visible") {
        attempts = 0;
      }
    };
    document.addEventListener("visibilitychange", restartWhenVisible);

    timeoutId = window.setTimeout(pollMessages, COWORKER_RESPONSE_POLL_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", restartWhenVisible);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [selectedRoom?.id, hasPendingRoomCoworkerMention]);

  // Ably Pub/Sub is primary (RoomMessageRealtimeBridge). Keep a short poll +
  // focus/visibility refresh so human peer rows still land when Ably drops or
  // lags while the room stays open.
  useEffect(() => {
    if (!selectedRoom) {
      return;
    }

    const roomId = selectedRoom.id;
    const skipWhileStreaming = shouldUseCoworkerRoomStream(selectedRoom);
    let cancelled = false;

    const refreshLatest = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (skipWhileStreaming && isCoworkerStreaming) {
        return;
      }
      const threadParentId = threadParentMessageRef.current?.id;
      const [result, threadResult] = await Promise.all([
        listRoomMessagesAction(roomId),
        threadParentId
          ? listThreadMessagesAction(roomId, threadParentId)
          : Promise.resolve(null),
      ]);
      if (cancelled || !result.ok) {
        return;
      }
      setMessagesState((current) =>
        mergeRoomMessages(current, result.value.messages),
      );
      setThreadParentMessage((current) =>
        current
          ? (result.value.messages.find(
              (message) => message.id === current.id,
            ) ?? current)
          : current,
      );
      if (threadResult?.ok) {
        setThreadMessages((current) =>
          mergeRoomMessages(current, threadResult.value.messages),
        );
      }
      setAttentionRefreshToken((token) => token + 1);
    };

    const intervalId = window.setInterval(refreshLatest, ROOM_LIVE_POLL_MS);
    window.addEventListener("focus", refreshLatest);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshLatest();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshLatest);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedRoom?.id, isCoworkerStreaming]);

  useEffect(() => {
    if (
      !selectedRoom ||
      !threadParentMessage ||
      !hasPendingThreadCoworkerMention
    ) {
      return;
    }

    const roomId = selectedRoom.id;
    const parentMessageId = threadParentMessage.id;
    let cancelled = false;
    let timeoutId: number | undefined;

    let threadAttempts = 0;

    const pollThreadMessages = async () => {
      // Same gating as the room poll above.
      if (document.visibilityState !== "visible") {
        timeoutId = window.setTimeout(
          pollThreadMessages,
          COWORKER_RESPONSE_POLL_MS,
        );
        return;
      }
      if (threadAttempts >= COWORKER_RESPONSE_POLL_MAX_ATTEMPTS) {
        return;
      }
      threadAttempts += 1;
      const [threadResult, roomResult] = await Promise.all([
        listThreadMessagesAction(roomId, parentMessageId),
        listRoomMessagesAction(roomId),
      ]);
      if (cancelled) {
        return;
      }
      if (threadResult.ok) {
        setThreadMessages((current) =>
          mergeRoomMessages(current, threadResult.value.messages),
        );
      }
      if (roomResult.ok) {
        setMessagesState((current) =>
          mergeRoomMessages(current, roomResult.value.messages),
        );
        setThreadParentMessage((current) =>
          current
            ? (roomResult.value.messages.find(
                (message) => message.id === current.id,
              ) ?? current)
            : current,
        );
      }
      timeoutId = window.setTimeout(
        pollThreadMessages,
        COWORKER_RESPONSE_POLL_MS,
      );
    };

    timeoutId = window.setTimeout(
      pollThreadMessages,
      COWORKER_RESPONSE_POLL_MS,
    );

    const restartThreadWhenVisible = () => {
      if (document.visibilityState === "visible") {
        threadAttempts = 0;
      }
    };
    document.addEventListener("visibilitychange", restartThreadWhenVisible);

    return () => {
      cancelled = true;
      document.removeEventListener(
        "visibilitychange",
        restartThreadWhenVisible,
      );
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    selectedRoom?.id,
    threadParentMessage?.id,
    hasPendingThreadCoworkerMention,
  ]);

  function mergeUpdatedMessage(updatedMessage: ChatRoomMessage) {
    setMessagesState((current) => {
      // Thread replies never belong in the room list (edit/delete/reaction).
      if (!isTopLevelChatRoomMessage(updatedMessage)) {
        return current.filter((message) => message.id !== updatedMessage.id);
      }
      return filterTopLevelChatRoomMessages(
        current.map((message) =>
          message.id === updatedMessage.id ? updatedMessage : message,
        ),
      );
    });
    // Parent lives in threadParentMessage only — never in the replies list.
    // Purge any prior leak (e.g. pre-fix Ably merge of the root).
    if (isTopLevelChatRoomMessage(updatedMessage)) {
      setThreadMessages((current) =>
        current.filter((message) => message.id !== updatedMessage.id),
      );
    } else {
      setThreadMessages((current) =>
        current.map((message) =>
          message.id === updatedMessage.id ? updatedMessage : message,
        ),
      );
    }
    setThreadParentMessage((current) =>
      current?.id === updatedMessage.id ? updatedMessage : current,
    );
  }

  function updateParentThreadPreview(
    parentMessageId: string,
    reply: ChatRoomMessage,
  ) {
    const updateParent = (message: ChatRoomMessage): ChatRoomMessage =>
      message.id === parentMessageId
        ? {
            ...message,
            threadReplyCount: message.threadReplyCount + 1,
            threadLastReplyAt: reply.createdAt,
          }
        : message;

    setMessagesState((current) => current.map(updateParent));
    setThreadParentMessage((current) =>
      current ? updateParent(current) : null,
    );
  }

  async function syncRoomAttentionAfterThreadLook(roomId: string) {
    const roomResult = await markOrganizationChatRoomReadAction(roomId);
    if (!roomResult.ok) {
      return;
    }
    applyRoomReadResultToOverlay(roomResult.value);
    window.dispatchEvent(
      new CustomEvent("organization-chat-room-read", {
        detail: { room: roomResult.value, roomId },
      }),
    );
  }
  syncRoomAttentionAfterThreadLookRef.current =
    syncRoomAttentionAfterThreadLook;

  async function loadThreadMessages(
    parentMessage: ChatRoomMessage,
  ): Promise<boolean> {
    if (!selectedRoom) {
      return false;
    }
    const roomId = selectedRoom.id;
    setThreadParentMessage(parentMessage);
    setThreadMessages([]);
    setThreadOlderNextCursor(null);
    // Look state first, then room mark-read so dual-baseline unreadCount
    // already excludes this thread when the sidebar event lands.
    const markResult = await markThreadReadAction(roomId, parentMessage.id);
    if (markResult.ok) {
      setAttentionRefreshToken((token) => token + 1);
      await syncRoomAttentionAfterThreadLook(roomId);
    }
    startThreadLoadingTransition(async () => {
      const result = await listThreadMessagesAction(roomId, parentMessage.id);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      setThreadMessages(result.value.messages);
      setThreadOlderNextCursor(result.value.nextCursor);
    });
    return markResult.ok;
  }

  function handleLoadOlderMessages() {
    if (!selectedRoom || !olderNextCursor || isLoadingOlder) {
      return;
    }

    const roomId = selectedRoom.id;
    const cursor = olderNextCursor;
    startLoadingOlderTransition(async () => {
      const result = await listRoomMessagesAction(roomId, { cursor });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      setMessagesState((current) =>
        mergeRoomMessages(current, result.value.messages),
      );
      setOlderNextCursor(result.value.nextCursor);
    });
  }

  function handleLoadOlderThreadMessages() {
    if (
      !selectedRoom ||
      !threadParentMessage ||
      !threadOlderNextCursor ||
      isLoadingOlderThread
    ) {
      return;
    }

    const roomId = selectedRoom.id;
    const parentMessageId = threadParentMessage.id;
    const cursor = threadOlderNextCursor;
    startLoadingOlderThreadTransition(async () => {
      const result = await listThreadMessagesAction(roomId, parentMessageId, {
        cursor,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      setThreadMessages((current) =>
        mergeRoomMessages(current, result.value.messages),
      );
      setThreadOlderNextCursor(result.value.nextCursor);
    });
  }

  function handleToggleReaction(message: ChatRoomMessage, emoji: string) {
    if (!selectedRoom) return;
    // Guard the in-flight toggle: on a slow connection nothing changed
    // visibly, so users tapped again and the second call flipped the reaction
    // straight back off.
    const roomId = selectedRoom.id;
    const pendingKey = `${message.id}:${emoji}`;
    if (pendingReactionsRef.current.has(pendingKey)) return;
    pendingReactionsRef.current.add(pendingKey);
    startReactionTransition(async () => {
      const result = await toggleMessageReactionAction(
        roomId,
        message.id,
        emoji,
      );
      pendingReactionsRef.current.delete(pendingKey);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      mergeUpdatedMessage(result.value);
    });
  }

  function handleStartEdit(message: ChatRoomMessage) {
    setEditSession({ messageId: message.id, draft: message.content });
  }

  function handleCancelEdit() {
    if (isSavingEdit) return;
    setEditSession(null);
  }

  function handleEditDraftChange(draft: string) {
    setEditSession((current) => (current ? { ...current, draft } : current));
  }

  function handleSaveEdit(contentOverride?: string) {
    if (!selectedRoom || !editSession || isSavingEdit) return;
    const roomId = selectedRoom.id;
    const { messageId, draft } = editSession;
    // Prefer live editor text (Enter can fire before React flushes onChange).
    const raw = contentOverride ?? draft;
    const content = raw.trim();
    if (!content) return;

    // Keep controlled draft in sync with what we submit so a failed save still
    // shows the text the user actually confirmed (not a stale parent draft).
    if (contentOverride !== undefined && contentOverride !== draft) {
      setEditSession((current) =>
        current?.messageId === messageId
          ? { ...current, draft: contentOverride }
          : current,
      );
    }

    startSavingEditTransition(async () => {
      const result = await editRoomMessageAction(roomId, messageId, content);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      mergeUpdatedMessage(result.value);
      setEditSession((current) =>
        current?.messageId === messageId ? null : current,
      );
    });
  }

  function handleDeleteMessage(message: ChatRoomMessage) {
    if (!selectedRoom) return;
    const roomId = selectedRoom.id;
    // Snapshot parent count before the request so a racing Ably parent
    // update (server re-publish after reply soft-delete) is not double-applied.
    const parentMessageId = message.parentMessageId;
    const wasLiveReply = parentMessageId != null && message.deletedAt == null;
    const parentCountBefore = wasLiveReply
      ? threadParentMessage?.id === parentMessageId
        ? threadParentMessage.threadReplyCount
        : (messagesState.find((row) => row.id === parentMessageId)
            ?.threadReplyCount ?? null)
      : null;

    startDeleteTransition(async () => {
      const result = await deleteRoomMessageAction(roomId, message.id);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      mergeUpdatedMessage(result.value);

      if (
        wasLiveReply &&
        parentMessageId != null &&
        parentCountBefore != null &&
        result.value.deletedAt != null
      ) {
        const applyParent = (row: ChatRoomMessage) =>
          applyReplySoftDeleteToParentIfUnchanged(
            row,
            parentMessageId,
            parentCountBefore,
          );
        setMessagesState((current) => current.map(applyParent));
        setThreadParentMessage((current) =>
          current ? applyParent(current) : null,
        );
      }
    });
  }

  function handleQuoteMessage(message: ChatRoomMessage) {
    setPendingQuote(pendingQuoteFromMessage(message));
    requestAnimationFrame(() => {
      roomComposerRef.current?.focus();
    });
  }

  function handleQuoteThreadMessage(message: ChatRoomMessage) {
    setPendingThreadQuote(pendingQuoteFromMessage(message));
  }

  const handleChannelBeforeSend = useCallback(
    (clientMessageId: string) => {
      // Progressive shell remounts when history resolves — do not send into a
      // fallback instance whose optimistic state will be discarded.
      if (messagesPending) return false;
      if (!selectedRoom) return false;
      if (shouldUseCoworkerRoomStream(selectedRoom)) return true;
      if (classicSendInFlightRef.current) return false;
      classicSendInFlightRef.current = clientMessageId;
      return true;
    },
    [messagesPending, selectedRoom],
  );

  const handleChannelSend = useCallback(
    async (request: RoomSessionSendRequest): Promise<RoomSessionSendResult> => {
      if (messagesPending) return { ok: false };
      if (!selectedRoom) return { ok: false };
      const roomId = selectedRoom.id;

      // Coworker stream rooms keep SSE even with a pending quote (Core persists
      // the quote snapshot on the user message). Classic POST stays for non-stream.
      if (shouldUseCoworkerRoomStream(selectedRoom)) {
        const started = sendStreamMessage(request.content, {
          quote: request.quote,
        });
        if (started) {
          pinToBottomAfterOwnSend();
        }
        return { ok: started };
      }

      const { mentionedCoworkerIds, mentionedUserIds } = partitionMentionIds(
        request.mentionedIds,
      );

      return new Promise((resolve) => {
        startSendingTransition(async () => {
          try {
            const result = await sendRoomMessageAction(
              roomId,
              request.content,
              mentionedCoworkerIds,
              {
                mentionedUserIds,
                quote: request.quote,
                clientMessageId: request.clientMessageId,
              },
            );
            if (!result.ok) {
              toast.error(result.error.message);
              // Room switch unmounts the session composer; skip restore.
              resolve(
                isStillSelectedRoom(roomId)
                  ? {
                      ok: false,
                      message: result.error.message ?? undefined,
                    }
                  : { ok: true },
              );
              return;
            }
            if (isStillSelectedRoom(roomId)) {
              setMessagesState((current) =>
                appendMessage(current, result.value),
              );
              pinToBottomAfterOwnSend();
            }
            resolve({ ok: true });
          } finally {
            if (classicSendInFlightRef.current === request.clientMessageId) {
              classicSendInFlightRef.current = null;
            }
          }
        });
      });
    },
    [
      messagesPending,
      partitionMentionIds,
      pinToBottomAfterOwnSend,
      selectedRoom,
      sendStreamMessage,
    ],
  );

  const handleThreadBeforeSend = useCallback(
    (clientMessageId: string) => {
      if (!selectedRoom || !threadParentMessage) return false;
      if (shouldUseCoworkerRoomStream(selectedRoom)) return true;
      if (classicThreadSendInFlightRef.current) return false;
      classicThreadSendInFlightRef.current = clientMessageId;
      return true;
    },
    [selectedRoom, threadParentMessage],
  );

  const handleThreadSend = useCallback(
    async (request: RoomSessionSendRequest): Promise<RoomSessionSendResult> => {
      if (!selectedRoom || !threadParentMessage) return { ok: false };
      const roomId = selectedRoom.id;
      const parentMessageId = threadParentMessage.id;

      if (shouldUseCoworkerRoomStream(selectedRoom)) {
        const started = sendStreamMessage(request.content, {
          parentMessageId,
          quote: request.quote,
        });
        return { ok: started };
      }

      const { mentionedCoworkerIds, mentionedUserIds } = partitionMentionIds(
        request.mentionedIds,
      );

      return new Promise((resolve) => {
        startSendingThreadReplyTransition(async () => {
          try {
            const result = await sendRoomMessageAction(
              roomId,
              request.content,
              mentionedCoworkerIds,
              {
                mentionedUserIds,
                parentMessageId,
                quote: request.quote,
                clientMessageId: request.clientMessageId,
              },
            );
            if (!result.ok) {
              toast.error(result.error.message);
              resolve(
                isStillSelectedRoom(roomId)
                  ? {
                      ok: false,
                      message: result.error.message ?? undefined,
                    }
                  : { ok: true },
              );
              return;
            }
            if (isStillSelectedRoom(roomId)) {
              setThreadMessages((current) =>
                appendMessage(current, result.value),
              );
              updateParentThreadPreview(parentMessageId, result.value);
            }
            resolve({ ok: true });
          } finally {
            if (
              classicThreadSendInFlightRef.current === request.clientMessageId
            ) {
              classicThreadSendInFlightRef.current = null;
            }
          }
        });
      });
    },
    [partitionMentionIds, selectedRoom, sendStreamMessage, threadParentMessage],
  );

  const roomHeaderChrome =
    selectedRoom != null ? (
      <RoomHeaderChrome
        room={selectedRoom}
        displayName={selectedRoomDisplayName}
        isDirectRoom={isDirectRoom}
        currentUserId={currentUserId}
        canOpenHumanDirect={canOpenHumanDirect}
        onOpenDirect={handleOpenDirectMessage}
        openingDirectKey={openingDirectKey}
        topLevelRoomMessages={topLevelRoomMessages}
        onOpenThread={loadThreadMessages}
        attentionRefreshToken={attentionRefreshToken}
        onAllThreadsLooked={() => {
          void syncRoomAttentionAfterThreadLook(selectedRoom.id);
        }}
        organizationMembers={organizationMembers}
        coworkers={coworkers}
        canEditMembers={canEditSelectedRoomMembers}
        canManageSettings={canManageSelectedRoomSettings}
        canArchive={canArchiveSelectedRoom}
        canLeave={canLeaveSelectedRoom}
        canInviteGuests={canInviteGuestsToSelectedRoom}
        membersLoadFailed={membersLoadFailed}
      />
    ) : null;

  return (
    <div
      className={cn(
        "-m-4 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        chatMobileHeightShellClass(pathname, isApple, searchParams),
      )}
    >
      {selectedRoom &&
      isMobile === true &&
      headerRoomSlotHost &&
      roomHeaderChrome
        ? createPortal(roomHeaderChrome, headerRoomSlotHost)
        : null}
      {currentUserId && !messagesPending ? (
        <LazyAblyProvider>
          <RoomMessageRealtimeBridge
            roomIds={rooms.map((room) => room.id)}
            currentUserId={currentUserId}
            selectedRoomId={selectedRoomId}
            onMessage={handleChatRoomRealtimeMessage}
          />
        </LazyAblyProvider>
      ) : null}
      {/* `relative` anchors the thread panel's mobile full-screen takeover. */}
      <main className="relative flex min-h-0 min-w-0 flex-1 overflow-x-clip">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {isCreateChannelRequested ? (
            <>
              <div className="flex flex-1 items-center justify-center p-6">
                <div className="border-border/70 bg-muted/20 max-w-md rounded-md border border-dashed px-6 py-10 text-center">
                  <Hash className="text-muted-foreground mx-auto size-8" />
                  <h2 className="mt-4 text-lg font-semibold">
                    {t("Empty.noChannelTitle")}
                  </h2>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {t("Empty.noChannelDescription")}
                  </p>
                </div>
              </div>
              <CreateChannelDialog
                key="create-channel"
                open={isCreateChannelRequested}
                members={organizationMembers}
                coworkers={coworkers}
                organizationName={activeOrganization?.name ?? ""}
                membersLoadFailed={membersLoadFailed}
                canCreateExternal={isOrgOwnerOrAdmin}
              />
            </>
          ) : isNewDirectMessage ? (
            <DraftDirectMessage
              members={organizationMembers}
              coworkers={coworkers}
              currentUserId={currentUserId}
              canCreateRoomDirect={activeOrganization != null}
              membersLoadFailed={membersLoadFailed}
            />
          ) : selectedRoom ? (
            <RoomFileDropZone
              enabled={!isCoworkerStreamRoom}
              onFiles={(files) => {
                roomComposerRef.current?.attachFiles(files);
              }}
              label={t("Toolbar.dropToAttach")}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              {isMobile === false && roomHeaderChrome ? (
                <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-6">
                  {roomHeaderChrome}
                </header>
              ) : null}

              <div
                ref={scrollerRef}
                className={CHAT_MESSAGE_LIST_SCROLLER_CLASS}
              >
                <div
                  ref={contentRef}
                  className="flex min-w-0 w-full flex-col justify-end px-5 pt-6 pb-0"
                  style={
                    contentMinHeight != null
                      ? { minHeight: contentMinHeight }
                      : undefined
                  }
                >
                  {messagesPending ? (
                    <RoomMessageListSkeleton />
                  ) : messageLoadFailed ? (
                    <div className="border-border/70 bg-muted/20 rounded-md border border-dashed px-5 py-10 text-center">
                      <p className="font-medium">
                        {t("Empty.messagesLoadFailedTitle")}
                      </p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t("Empty.messagesLoadFailedDescription")}
                      </p>
                    </div>
                  ) : displayMessages.length === 0 ? (
                    <div className="border-border/70 bg-muted/20 rounded-md border border-dashed px-5 py-10 text-center">
                      <p className="font-medium">
                        {t("Empty.noMessagesTitle")}
                      </p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t("Empty.noMessagesDescription")}
                      </p>
                    </div>
                  ) : null}
                  {messagesPending || !olderNextCursor ? null : (
                    <div className="mb-4 flex justify-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isLoadingOlder}
                        onClick={handleLoadOlderMessages}
                      >
                        {isLoadingOlder ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            {t("loadingOlder")}
                          </>
                        ) : (
                          t("loadOlder")
                        )}
                      </Button>
                    </div>
                  )}
                  {messagesPending
                    ? null
                    : displayMessages.map((message, index) => {
                        const previousMessage = displayMessages[index - 1];
                        // Local calendar day keys differ UTC (SSR) vs browser TZ —
                        // only insert separators / regroup after mount.
                        const showDaySeparator =
                          localCalendarReady &&
                          (!previousMessage ||
                            messageDayKey(previousMessage.createdAt) !==
                              messageDayKey(message.createdAt));
                        const isStreamOverlay =
                          message.id.startsWith("stream:");
                        return (
                          <div key={message.id} className="min-w-0">
                            {showDaySeparator ? (
                              <DaySeparator
                                date={new Date(message.createdAt)}
                                formatDaySeparator={formatDaySeparator}
                              />
                            ) : null}
                            {message.membership != null ? (
                              <MembershipStatusRow message={message} />
                            ) : (
                              <ChatMessageRow
                                message={message}
                                coworkersById={coworkersById}
                                coworkersBySlug={coworkersBySlug}
                                usersById={usersById}
                                usersBySlug={usersBySlug}
                                currentUserId={currentUserId}
                                canOpenHumanDirect={canOpenHumanDirect}
                                onOpenDirectMessage={handleOpenDirectMessage}
                                openingDirectParticipantKey={openingDirectKey}
                                onToggleReaction={handleToggleReaction}
                                onOpenThread={
                                  shouldShowChatRoomThreadButton({
                                    room: selectedRoom,
                                    isStreamOverlay,
                                  })
                                    ? loadThreadMessages
                                    : undefined
                                }
                                onQuote={handleQuoteMessage}
                                onStartEdit={handleStartEdit}
                                onDelete={handleDeleteMessage}
                                isEditing={
                                  editSession?.messageId === message.id
                                }
                                editDraft={
                                  editSession?.messageId === message.id
                                    ? editSession.draft
                                    : ""
                                }
                                onEditDraftChange={handleEditDraftChange}
                                onCancelEdit={handleCancelEdit}
                                onSaveEdit={handleSaveEdit}
                                isSavingEdit={
                                  isSavingEdit &&
                                  editSession?.messageId === message.id
                                }
                                // Stream overlays never show thread chrome.
                                showThreadButton={shouldShowChatRoomThreadButton(
                                  {
                                    room: selectedRoom,
                                    isStreamOverlay,
                                  },
                                )}
                                isFirstOfDay={showDaySeparator}
                                isContinuation={
                                  localCalendarReady &&
                                  !showDaySeparator &&
                                  isMessageContinuation(
                                    previousMessage,
                                    message,
                                  )
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                </div>
              </div>

              <RoomSessionComposer
                key={selectedRoom.id}
                ref={roomComposerRef}
                roomId={selectedRoom.id}
                draftKey={composeDraftKey.room(selectedRoom.id)}
                mentions={mentionRecords}
                placeholder={
                  isDirectRoom
                    ? t("directComposerPlaceholder", {
                        member: selectedRoomDisplayName,
                      })
                    : t("composerPlaceholderWithChannel", {
                        channel: selectedRoomDisplayName,
                      })
                }
                // Treat history-pending as in-flight so send is disabled without
                // posting into a Suspense fallback that remounts on resolve.
                isSending={isSending || isCoworkerStreaming || messagesPending}
                showMentionShortcut={shouldShowRoomMentionShortcut(
                  selectedRoom,
                )}
                allowAttachments={!isCoworkerStreamRoom && !messagesPending}
                pendingQuote={pendingQuote}
                onClearPendingQuote={() => setPendingQuote(null)}
                onRestorePendingQuote={setPendingQuote}
                onChromeResize={scrollToBottomIfPinned}
                onBeforeSend={handleChannelBeforeSend}
                onSend={handleChannelSend}
              />
            </RoomFileDropZone>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="border-border/70 bg-muted/20 max-w-md rounded-md border border-dashed px-6 py-10 text-center">
                <Hash className="text-muted-foreground mx-auto size-8" />
                <h2 className="mt-4 text-lg font-semibold">
                  {t("Empty.noChannelTitle")}
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {t("Empty.noChannelDescription")}
                </p>
                <div className="mt-5">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => router.push("/chat?create=channel")}
                  >
                    {t("createChannel")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
        {selectedRoom && threadParentMessage ? (
          <ThreadPanel
            parentMessage={threadParentMessage}
            replies={displayThreadMessages}
            isLoading={isThreadLoading}
            olderNextCursor={threadOlderNextCursor}
            isLoadingOlder={isLoadingOlderThread}
            onLoadOlder={handleLoadOlderThreadMessages}
            coworkersById={coworkersById}
            coworkersBySlug={coworkersBySlug}
            usersById={usersById}
            usersBySlug={usersBySlug}
            mentionRecords={mentionRecords}
            draftKey={composeDraftKey.thread(
              selectedRoom.id,
              threadParentMessage.id,
            )}
            onBeforeSendReply={handleThreadBeforeSend}
            onSendReply={handleThreadSend}
            isSendingReply={
              isSendingThreadReply ||
              (isCoworkerStreaming && threadStreamOverlayMessages.length > 0)
            }
            onClose={() => {
              setThreadParentMessage(null);
              setThreadMessages([]);
              setThreadOlderNextCursor(null);
              setPendingThreadQuote(null);
            }}
            onToggleReaction={handleToggleReaction}
            onQuote={handleQuoteThreadMessage}
            currentUserId={currentUserId}
            canOpenHumanDirect={canOpenHumanDirect}
            onOpenDirectMessage={handleOpenDirectMessage}
            openingDirectParticipantKey={openingDirectKey}
            onStartEdit={handleStartEdit}
            onDelete={handleDeleteMessage}
            editSession={editSession}
            onEditDraftChange={handleEditDraftChange}
            onCancelEdit={handleCancelEdit}
            onSaveEdit={handleSaveEdit}
            isSavingEdit={isSavingEdit}
            pendingQuote={pendingThreadQuote}
            onClearPendingQuote={() => setPendingThreadQuote(null)}
            onRestorePendingQuote={setPendingThreadQuote}
            showMentionShortcut={shouldShowRoomMentionShortcut(selectedRoom)}
            allowAttachments={!isCoworkerStreamRoom}
            roomId={selectedRoom.id}
          />
        ) : null}
      </main>
    </div>
  );
}
