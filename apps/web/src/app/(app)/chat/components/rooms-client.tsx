"use client";

import { Hash, Loader2, MessageCircle } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { chatMobileHeightShellClass } from "@/app/chat/components/chat-mobile-tab-registry";
import DaySeparator from "@/app/chat/components/day-separator";
import { RoomSearchPanel } from "@/app/chat/components/room-search-panel";
import { ThreadListPanel } from "@/app/chat/components/thread-list-panel";
import { UnreadThreadsPanel } from "@/app/chat/components/unread-threads-panel";
import { useClientLocalCalendarReady } from "@/app/chat/hooks/use-client-local-calendar-ready";
import {
  readStoredStreamParentMessageId,
  useCoworkerDirectRoomStream,
} from "@/app/chat/hooks/use-coworker-direct-room-stream";
import { useStickToBottom } from "@/app/chat/hooks/use-stick-to-bottom";
import type { RoomShellRosterPage } from "@/app/chat/load-room-shell-roster";
import {
  filterTopLevelChatRoomMessages,
  isReplyUnderThreadParent,
  isTopLevelChatRoomMessage,
  routeRealtimeChatRoomMessage,
} from "@/app/chat/utils/chat-room-message-scope";
import {
  type ClassicOutboundJob,
  type ClassicOutboundQueueRefs,
  type ClassicOutboundSendResult,
  clearClassicOutboundQueue,
  drainClassicOutboundQueue,
  enqueueClassicOutboundJob,
} from "@/app/chat/utils/classic-outbound-queue";
import { composeDraftKey } from "@/app/chat/utils/compose-draft-storage";
import {
  isFailedMentionThoughtShell,
  isPersistedMentionThoughtShell,
} from "@/app/chat/utils/coworker-thought";
import { formatDaySeparator } from "@/app/chat/utils/date-utils";
import {
  applyFullChatRoomMessageEvent,
  mergeMessagesWithStreamOverlay,
  mergeRoomMessages,
} from "@/app/chat/utils/merge-room-messages";
import {
  confirmOutboundMessage,
  createPendingRoomMessage,
  failOutboundMessage,
  isOutboundLocalMessage,
  listJustConfirmedOutboundMessageIds,
  markOutboundMessagePending,
  OUTBOUND_SENT_TICK_MS,
  outboundLocalMessageId,
  readClientTurnId,
  removeOutboundMessage,
  shouldFlashOutboundSentCheck,
} from "@/app/chat/utils/outbound-room-message";
import { markOutboundSentTick } from "@/app/chat/utils/outbound-sent-tick";
import { applyReplySoftDeleteToParentIfUnchanged } from "@/app/chat/utils/parent-thread-preview";
import { peekPendingRoomMessage } from "@/app/chat/utils/pending-room-message";
import { roomReadAttentionMarker } from "@/app/chat/utils/room-read-attention-marker";
import { shouldShowRoomRosterControl } from "@/app/chat/utils/should-show-room-roster-control";
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
  chatRoomMessageIdEnvelopeAction,
  isChatRoomMessageIdEnvelope,
  isChatRoomMessagePatchEvent,
  tombstoneChatRoomMessage,
} from "@/lib/ably";
import { applyChatRoomMessagePatch } from "@/lib/ably/apply-chat-room-message-patch";
import { hydrateChatRoomMessageFromRealtime } from "@/lib/ably/hydrate-chat-room-message";
import { useChatRoomRealtime } from "@/lib/ably/use-chat-room-realtime";
import type {
  ChatRoom,
  ChatRoomMessage,
  ChatRoomUserParticipant,
  Coworker,
  Member,
  Organization,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { slugifyMentionValue } from "@/lib/utils/mention-parser";
import { getInitials } from "@/lib/utils/text";
import { CreateChannelDialog } from "./create-channel-dialog";
import { DraftDirectMessage } from "./draft-direct-message";
import { EditChannelDialog } from "./edit-channel-dialog";
import { MembershipStatusRow } from "./membership-status-row";
import {
  canOpenHumanDirectFromSelectedRoom,
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
import { RoomMessageListSkeleton } from "./room-message-list-skeleton";
import { ChatMessageRow } from "./room-message-row";
import {
  type RoomMessagePage,
  RoomMessagesHydrator,
} from "./room-messages-hydrator";
import { ROOM_ROSTER_PANEL_ID, RoomRosterPanel } from "./room-roster-panel";
import {
  RoomSessionComposer,
  type RoomSessionSendRequest,
  type RoomSessionSendResult,
} from "./room-session-composer";
import {
  ROOM_SHELL_COLUMN_CLASSNAME,
  ROOM_SHELL_ROOT_CLASSNAME,
  RoomShellLayout,
} from "./room-shell-layout";
import { RoomShellRosterHydrator } from "./room-shell-roster-hydrator";
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
   * Deferred initial history (Server → Client promise). Hydrates into this
   * instance so real header + composer stay mounted while the list skeletons.
   */
  messagesPromise?: Promise<RoomMessagePage>;
  /**
   * Deferred org members + coworkers. Room chrome paints from `rooms` alone;
   * roster streams in for pickers / mentions / admin gates.
   */
  rosterPromise?: Promise<RoomShellRosterPage>;
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
      ))}
      {remainingCount > 0 ? (
        <span
          className="border-background bg-muted text-muted-foreground ring-border/60 relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[0.625rem] font-medium shadow-xs ring-1 md:size-7"
          style={{ zIndex: 0 }}
          aria-hidden
        >
          +{remainingCount}
        </span>
      ) : null}
    </button>
  );
}

interface RoomHeaderChromeProps {
  room: ChatRoom;
  displayName: string;
  isDirectRoom: boolean;
  topLevelRoomMessages: ChatRoomMessage[];
  onOpenThread: (message: ChatRoomMessage) => boolean | Promise<boolean>;
  threadListOpen: boolean;
  onToggleThreadList: () => void;
  rosterOpen: boolean;
  onToggleRoster: () => void;
  organizationMembers: Member[];
  coworkers: Coworker[];
  canEditMembers: boolean;
  canManageSettings: boolean;
  canArchive: boolean;
  canLeave: boolean;
  canInviteGuests: boolean;
  membersLoadFailed: boolean;
  /** When false, skip avatar stack so title can paint without it. */
  showParticipants: boolean;
}

function RoomHeaderChrome({
  room,
  displayName,
  isDirectRoom,
  topLevelRoomMessages,
  onOpenThread,
  threadListOpen,
  onToggleThreadList,
  rosterOpen,
  onToggleRoster,
  organizationMembers,
  coworkers,
  canEditMembers,
  canManageSettings,
  canArchive,
  canLeave,
  canInviteGuests,
  membersLoadFailed,
  showParticipants,
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
        <p
          className="text-foreground min-w-0 truncate text-sm"
          data-testid="room-open-title"
        >
          {displayName}
        </p>
        <div className="shrink-0">
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
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        <UnreadThreadsPanel
          key={`unread-threads-${room.id}`}
          isOpen={threadListOpen}
          onToggle={onToggleThreadList}
          labels={{
            open: t("UnreadThreads.open"),
          }}
        />
        {showParticipants && shouldShowRoomRosterControl(room) ? (
          <RoomParticipantStack
            room={room}
            rosterOpen={rosterOpen}
            onToggleRoster={onToggleRoster}
          />
        ) : null}
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
  organizationMembers: organizationMembersProp,
  currentUserId,
  coworkers: coworkersProp,
  selectedRoomId,
  isCreateChannelRequested,
  isNewDirectMessage,
  messageLoadFailed,
  membersLoadFailed: membersLoadFailedProp,
  messages,
  messagesNextCursor,
  messagesPromise,
  rosterPromise,
}: RoomsClientProps) {
  const t = useTranslations("App.Channels");
  const tBreadcrumb = useTranslations("Components.Breadcrumb");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isApple = useIsApplePlatform();
  const isMobile = useIsMobileMedia();
  const headerRoomSlotHost = useHeaderRoomSlotHost();
  // Defer portal until after first paint so getRoom title lands in-column with
  // the composer (useLayoutEffect host + isMobile would portal before paint and
  // leave the app header blank on the first real chrome frame).
  const [mobileHeaderPortaled, setMobileHeaderPortaled] = useState(false);
  useEffect(() => {
    setMobileHeaderPortaled(isMobile === true && headerRoomSlotHost != null);
  }, [isMobile, headerRoomSlotHost]);
  // Defer participant avatars one frame so the title string is not gated on
  // the avatar stack committing in the same first paint.
  // Approved LCP exception: mount-only Effect keeps title-with-composer paint
  // order; do not replace with render-time/portal-only avatar mounting.
  const [showHeaderParticipants, setShowHeaderParticipants] = useState(false);
  useEffect(() => {
    setShowHeaderParticipants(true);
  }, []);
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
  const [deferredHistoryPending, setDeferredHistoryPending] = useState(
    () => messagesPromise != null,
  );
  const [messageLoadFailedState, setMessageLoadFailedState] =
    useState(messageLoadFailed);
  const [syncedMessagesPromise, setSyncedMessagesPromise] =
    useState(messagesPromise);
  const [deferredRoster, setDeferredRoster] =
    useState<RoomShellRosterPage | null>(null);
  const [syncedRosterPromise, setSyncedRosterPromise] = useState(rosterPromise);
  const [syncedHistoryRoomId, setSyncedHistoryRoomId] =
    useState(selectedRoomId);
  // RoomsClient stays mounted across /chat/rooms/[id] navigations. Progressive
  // room switch must drop the prior timeline so skeleton shows and hydrate
  // cannot merge room A into room B (or show A under B's header).
  if (selectedRoomId !== syncedHistoryRoomId) {
    setSyncedHistoryRoomId(selectedRoomId);
    if (messagesPromise != null) {
      setMessagesState([]);
      setOlderNextCursor(null);
      setMessageLoadFailedState(false);
      setDeferredHistoryPending(true);
    }
    if (rosterPromise != null) {
      setDeferredRoster(null);
    }
  }
  if (messagesPromise !== syncedMessagesPromise) {
    setSyncedMessagesPromise(messagesPromise);
    // Same-room promise identity swap (RSC refresh) must not re-enter pending
    // or focusOnMount false→true steals caret mid-type. Room change above
    // already sets pending; initial mount seeds deferredHistoryPending.
    if (messagesPromise == null) {
      setDeferredHistoryPending(false);
      setMessageLoadFailedState(messageLoadFailed);
    }
  }
  if (rosterPromise !== syncedRosterPromise) {
    setSyncedRosterPromise(rosterPromise);
    if (rosterPromise == null) {
      setDeferredRoster(null);
    }
  }
  const organizationMembers =
    rosterPromise != null
      ? (deferredRoster?.organizationMembers ?? organizationMembersProp)
      : organizationMembersProp;
  const coworkers =
    rosterPromise != null
      ? (deferredRoster?.coworkers ?? coworkersProp)
      : coworkersProp;
  const membersLoadFailed =
    rosterPromise != null
      ? (deferredRoster?.membersLoadFailed ?? membersLoadFailedProp)
      : membersLoadFailedProp;
  const messagesPending = deferredHistoryPending;
  const effectiveMessageLoadFailed = messagesPending
    ? false
    : messageLoadFailedState;

  const handleDeferredHistoryResolved = useCallback((page: RoomMessagePage) => {
    setMessagesState((current) => mergeRoomMessages(current, page.messages));
    setOlderNextCursor(page.nextCursor);
    setMessageLoadFailedState(page.failed);
    setDeferredHistoryPending(false);
  }, []);

  const handleDeferredRosterResolved = useCallback(
    (page: RoomShellRosterPage) => {
      setDeferredRoster(page);
    },
    [],
  );

  const [threadListOpen, setThreadListOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [threadOpenedFromList, setThreadOpenedFromList] = useState(false);
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
  // Explicit flag (not useTransition): open must paint loading before any
  // await. mark-read used to run first with replies=[] + isLoading false →
  // "No replies yet" blink. Generation invalidates in-flight opens/closes.
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const threadLoadGenerationRef = useRef(0);
  const composeSurfaceEpoch = `${selectedRoomId}:${isNewDirectMessage}:${isCreateChannelRequested}`;
  const [syncedComposeSurfaceEpoch, setSyncedComposeSurfaceEpoch] =
    useState(composeSurfaceEpoch);
  if (composeSurfaceEpoch !== syncedComposeSurfaceEpoch) {
    setSyncedComposeSurfaceEpoch(composeSurfaceEpoch);
    setPendingQuote(null);
    setThreadParentMessage(null);
    setThreadMessages([]);
    setPendingThreadQuote(null);
    setThreadListOpen(false);
    setRosterOpen(false);
    setThreadOpenedFromList(false);
    setEditSession(null);
    threadLoadGenerationRef.current += 1;
    setIsThreadLoading(false);
  }

  const roomComposerRef = useRef<RoomComposerHandle | null>(null);
  const {
    scrollerRef,
    contentRef,
    contentMinHeight,
    scrollToBottom,
    pinToBottomAfterOwnSend,
    scrollToBottomIfPinned,
  } = useStickToBottom({
    resetKey: selectedRoomId,
  });
  // When history lands, pin live edge in layout (same frame as skeleton →
  // messages) so the list does not paint mid-jump then scroll.
  const wasHistoryPendingRef = useRef(messagesPending);
  useLayoutEffect(() => {
    const wasPending = wasHistoryPendingRef.current;
    wasHistoryPendingRef.current = messagesPending;
    if (!wasPending || messagesPending) {
      return;
    }
    scrollToBottom();
  }, [messagesPending, scrollToBottom]);
  const readMarkerRef = useRef<string | null>(null);
  const syncedRoomIdRef = useRef<string | null>(null);
  // RoomsClient stays mounted across /chat/rooms/[id] navigations. Async
  // handlers must not merge into messagesState after the selection moved.
  const selectedRoomIdRef = useRef(selectedRoomId);
  selectedRoomIdRef.current = selectedRoomId;
  const syncRoomAttentionAfterThreadLookRef = useRef<
    (roomId: string) => Promise<void>
  >(async () => {});

  // Classic outbound uses pending shells + a queue; composer stays unlocked.
  // Stream rooms still pass isCoworkerStreaming into isSending* props below.
  const [_isReacting, startReactionTransition] = useTransition();
  const [_isDeleting, startDeleteTransition] = useTransition();
  const [isLoadingOlder, startLoadingOlderTransition] = useTransition();
  const [isLoadingOlderThread, startLoadingOlderThreadTransition] =
    useTransition();
  const pendingReactionsRef = useRef<Set<string>>(new Set());
  // Classic POST: single-flight queue per composer (channel vs thread).
  const classicChannelRefs = useRef<ClassicOutboundQueueRefs>({
    queueRef: { current: [] },
    jobsRef: { current: new Map() },
    runningRef: { current: false },
  }).current;
  const classicThreadRefs = useRef<ClassicOutboundQueueRefs>({
    queueRef: { current: [] },
    jobsRef: { current: new Map() },
    runningRef: { current: false },
  }).current;
  // Stable ref handles for enqueue from callbacks (same object every render).
  const classicChannelQueueRef = classicChannelRefs.queueRef;
  const classicChannelJobsRef = classicChannelRefs.jobsRef;
  const classicThreadQueueRef = classicThreadRefs.queueRef;
  const classicThreadJobsRef = classicThreadRefs.jobsRef;
  /** Server message ids briefly showing a check in the timestamp slot. */
  const [outboundSentTickIds, setOutboundSentTickIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const outboundSentTickTimeoutsRef = useRef(new Map<string, number>());

  // Drop classic outbound jobs when leaving a room — shells are wiped and
  // Retry UI is gone (ADR-0004: no outbox across navigation).
  useEffect(() => {
    clearClassicOutboundQueue(classicChannelRefs);
    clearClassicOutboundQueue(classicThreadRefs);
  }, [selectedRoomId, classicChannelRefs, classicThreadRefs]);

  useEffect(() => {
    const timeouts = outboundSentTickTimeoutsRef.current;
    return () => {
      for (const timeoutId of timeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      timeouts.clear();
    };
  }, []);

  function flashOutboundSentTick(
    messageId: string,
    clientTurnId?: string | null,
  ) {
    // Sync registry first — first settled paint must see the check even if
    // the React tick setState commits a frame later (or not at all yet).
    markOutboundSentTick([messageId, clientTurnId]);
    const existing = outboundSentTickTimeoutsRef.current.get(messageId);
    if (existing != null) {
      window.clearTimeout(existing);
    }
    setOutboundSentTickIds((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
    const timeoutId = window.setTimeout(() => {
      outboundSentTickTimeoutsRef.current.delete(messageId);
      setOutboundSentTickIds((prev) => {
        if (!prev.has(messageId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }, OUTBOUND_SENT_TICK_MS);
    outboundSentTickTimeoutsRef.current.set(messageId, timeoutId);
  }

  /**
   * Apply a message list update and arm sent ticks only for **slow-path**
   * pending→server swaps (spinner delay already elapsed). Fast confirms
   * skip spinner and check. Marks the sync registry inside the messages
   * updater so the first paint after a slow confirm cannot skip the check.
   */
  function applyMessagesFlashingOutboundConfirms(
    setMessages: Dispatch<SetStateAction<ChatRoomMessage[]>>,
    computeNext: (current: ChatRoomMessage[]) => ChatRoomMessage[],
  ) {
    let slowPathConfirmed: { messageId: string; turnId: string | null }[] = [];
    setMessages((current) => {
      const next = computeNext(current);
      const confirmedIds = listJustConfirmedOutboundMessageIds(current, next);
      slowPathConfirmed = [];
      for (const messageId of confirmedIds) {
        const row = next.find((message) => message.id === messageId);
        const turnId = row != null ? readClientTurnId(row) : null;
        const pendingShell =
          turnId != null
            ? current.find(
                (message) => message.id === outboundLocalMessageId(turnId),
              )
            : null;
        if (
          pendingShell == null ||
          !shouldFlashOutboundSentCheck(pendingShell.createdAt)
        ) {
          continue;
        }
        markOutboundSentTick([messageId, turnId]);
        slowPathConfirmed.push({ messageId, turnId });
      }
      return next;
    });
    for (const { messageId, turnId } of slowPathConfirmed) {
      flashOutboundSentTick(messageId, turnId);
    }
  }

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
  const showRoomRosterControl =
    selectedRoom != null && shouldShowRoomRosterControl(selectedRoom);
  if (rosterOpen && !showRoomRosterControl) {
    setRosterOpen(false);
  }
  const isGuestInSelectedRoom = selectedRoom?.myAccess === "guest";
  const canOpenHumanDirect = canOpenHumanDirectFromSelectedRoom({
    kind: selectedRoom?.kind,
    discoverability: selectedRoom?.discoverability,
    myAccess: selectedRoom?.myAccess,
    hasActiveOrganization: Boolean(activeOrganization),
  });
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
  const refreshLatestRef = useRef<() => Promise<void>>(async () => {});

  const handleChatRoomRealtimeMessage = useCallback(
    (event: ChatRoomMessageEventData) => {
      if (
        skipRealtimeWhileStreamingRef.current &&
        isCoworkerStreamingRef.current
      ) {
        return;
      }

      if (isChatRoomMessageIdEnvelope(event)) {
        const action = chatRoomMessageIdEnvelopeAction(
          event,
          selectedRoomIdRef.current,
        );
        if (action.kind === "ignore") {
          return;
        }
        if (action.kind === "refresh") {
          void refreshLatestRef.current();
          return;
        }

        const route = routeRealtimeChatRoomMessage(
          {
            id: action.messageId,
            parentMessageId: action.parentMessageId,
          },
          threadParentMessageIdRef.current,
          "delete",
        );

        if (route.mergeIntoRoomTimeline) {
          setMessagesState((current) => {
            const existing = current.find(
              (message) => message.id === action.messageId,
            );
            if (!existing) {
              return current;
            }
            return filterTopLevelChatRoomMessages(
              mergeRoomMessages(current, [tombstoneChatRoomMessage(existing)]),
            );
          });
        }

        setThreadParentMessage((current) => {
          if (current?.id !== action.messageId) {
            return current;
          }
          return tombstoneChatRoomMessage(current);
        });

        if (route.mergeIntoOpenThread) {
          setThreadMessages((current) => {
            const existing = current.find(
              (message) => message.id === action.messageId,
            );
            if (!existing) {
              return current;
            }
            return mergeRoomMessages(current, [
              tombstoneChatRoomMessage(existing),
            ]);
          });
        }
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
      const isHardDelete =
        event.eventType === "delete" && message.deletedAt == null;

      if (route.mergeIntoRoomTimeline) {
        applyMessagesFlashingOutboundConfirms(setMessagesState, (current) =>
          filterTopLevelChatRoomMessages(
            applyFullChatRoomMessageEvent(current, {
              eventType: event.eventType,
              message,
            }),
          ),
        );
      }
      setThreadParentMessage((current) => {
        if (current?.id !== message.id) {
          return current;
        }
        return isHardDelete ? null : message;
      });

      if (route.mergeIntoOpenThread) {
        applyMessagesFlashingOutboundConfirms(setThreadMessages, (current) =>
          applyFullChatRoomMessageEvent(current, {
            eventType: event.eventType,
            message,
          }),
        );
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
      pathname: selectedRoom ? `/chat/rooms/${selectedRoom.id}` : "/",
      segments: [
        {
          label: tBreadcrumb("chat"),
          href: "/",
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
                  href: "/?create=channel",
                },
              ]
            : isNewDirectMessage
              ? [
                  {
                    label: t("Draft.breadcrumb"),
                    href: "/?dm=new",
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
    // Deferred promise owns the first page until hydrate completes.
    if (deferredHistoryPending) {
      syncedRoomIdRef.current = selectedRoomId;
      return;
    }

    // Progressive open keeps messagesPromise after hydrate; props stay empty.
    // Do not re-apply prop messages / messageLoadFailed or we wipe hydrate
    // and clobber failed:true from the hydrator.
    if (messagesPromise != null) {
      syncedRoomIdRef.current = selectedRoomId;
      return;
    }

    const isChannelSwitch = syncedRoomIdRef.current !== selectedRoomId;
    syncedRoomIdRef.current = selectedRoomId;

    // Room switch: replace. Same room RSC refresh (e.g. revalidatePath):
    // merge so client-loaded older pages are not wiped by the latest page.
    if (isChannelSwitch) {
      setMessagesState(messages);
      setOlderNextCursor(messagesNextCursor);
      setMessageLoadFailedState(messageLoadFailed);
    } else {
      setMessagesState((current) => mergeRoomMessages(current, messages));
      setMessageLoadFailedState(messageLoadFailed);
    }
    setThreadParentMessage((current) =>
      current
        ? (messages.find((message) => message.id === current.id) ?? current)
        : current,
    );
  }, [
    deferredHistoryPending,
    messageLoadFailed,
    messages,
    messagesNextCursor,
    messagesPromise,
    selectedRoomId,
  ]);

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

  const refreshFocusedRoomMessages = useCallback(async () => {
    const roomId = selectedRoomIdRef.current;
    if (!roomId) {
      return;
    }
    if (
      skipRealtimeWhileStreamingRef.current &&
      isCoworkerStreamingRef.current
    ) {
      return;
    }
    const threadParentId = threadParentMessageIdRef.current;
    const [result, threadResult] = await Promise.all([
      listRoomMessagesAction(roomId),
      threadParentId
        ? listThreadMessagesAction(roomId, threadParentId)
        : Promise.resolve(null),
    ]);
    if (selectedRoomIdRef.current !== roomId || !result.ok) {
      return;
    }
    setMessagesState((current) =>
      mergeRoomMessages(current, result.value.messages),
    );
    setThreadParentMessage((current) =>
      current
        ? (result.value.messages.find((message) => message.id === current.id) ??
          current)
        : current,
    );
    if (
      threadResult?.ok &&
      threadParentId != null &&
      threadParentMessageIdRef.current === threadParentId
    ) {
      setThreadMessages((current) =>
        mergeRoomMessages(current, threadResult.value.messages),
      );
    }
  }, []);
  refreshLatestRef.current = refreshFocusedRoomMessages;

  // Ably Pub/Sub is primary (RoomMessageRealtimeBridge). Keep a short poll +
  // focus/visibility refresh so human peer rows still land when Ably drops or
  // lags while the room stays open.
  useEffect(() => {
    if (!selectedRoom) {
      return;
    }

    let cancelled = false;

    const refreshLatest = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (cancelled) {
        return;
      }
      await refreshFocusedRoomMessages();
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
  }, [selectedRoom?.id, refreshFocusedRoomMessages]);

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

  async function handleOpenThreadFromMessage(
    parentMessage: ChatRoomMessage,
  ): Promise<boolean> {
    setThreadOpenedFromList(false);
    setThreadListOpen(false);
    setRosterOpen(false);
    return loadThreadMessages(parentMessage);
  }

  async function handleOpenThreadFromList(
    parentMessage: ChatRoomMessage,
  ): Promise<boolean> {
    setThreadOpenedFromList(true);
    return loadThreadMessages(parentMessage);
  }

  function closeThreadSidePanel() {
    threadLoadGenerationRef.current += 1;
    setIsThreadLoading(false);
    setThreadParentMessage(null);
    setThreadMessages([]);
    setThreadOlderNextCursor(null);
    setPendingThreadQuote(null);
    setThreadOpenedFromList(false);
    clearClassicOutboundQueue(classicThreadRefs);
  }

  function backToThreadList() {
    closeThreadSidePanel();
    setThreadListOpen(true);
  }

  function handleToggleRoster() {
    if (rosterOpen) {
      setRosterOpen(false);
      return;
    }
    if (threadParentMessage) {
      closeThreadSidePanel();
    }
    setThreadListOpen(false);
    setRosterOpen(true);
  }

  async function loadThreadMessages(
    parentMessage: ChatRoomMessage,
  ): Promise<boolean> {
    if (!selectedRoom) {
      return false;
    }
    const roomId = selectedRoom.id;
    const generation = ++threadLoadGenerationRef.current;
    // Reply list is wiped below — drop thread outbound jobs so a switch or
    // reopen cannot keep orphan retries after the shells are gone (ADR: no outbox).
    clearClassicOutboundQueue(classicThreadRefs);
    setThreadParentMessage(parentMessage);
    setThreadMessages([]);
    setThreadOlderNextCursor(null);
    // Loading true in the same tick as clear — before any await — so the
    // panel never paints Thread.empty while mark-read / list are in flight.
    setIsThreadLoading(true);
    try {
      // Look state first, then room mark-read so dual-baseline unreadCount
      // already excludes this thread when the sidebar event lands.
      const markResult = await markThreadReadAction(roomId, parentMessage.id);
      if (markResult.ok) {
        await syncRoomAttentionAfterThreadLook(roomId);
      }
      if (generation !== threadLoadGenerationRef.current) {
        return markResult.ok;
      }
      const result = await listThreadMessagesAction(roomId, parentMessage.id);
      if (!result.ok) {
        toast.error(result.error.message);
        return markResult.ok;
      }
      if (
        !isStillSelectedRoom(roomId) ||
        generation !== threadLoadGenerationRef.current
      ) {
        return markResult.ok;
      }
      setThreadMessages(result.value.messages);
      setThreadOlderNextCursor(result.value.nextCursor);
      return markResult.ok;
    } finally {
      if (generation === threadLoadGenerationRef.current) {
        setIsThreadLoading(false);
      }
    }
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

  function resolveCurrentUserParticipant(): ChatRoomUserParticipant | null {
    const fromRoom = selectedRoom?.userMembers.find(
      (user) => user.id === currentUserId,
    );
    if (fromRoom) {
      return fromRoom;
    }
    const fromOrg = organizationMembers.find(
      (member) => member.user.id === currentUserId,
    )?.user;
    if (fromOrg) {
      return {
        id: fromOrg.id,
        name: fromOrg.name,
        email: fromOrg.email,
        image: fromOrg.image,
        presence: "online",
      };
    }
    return null;
  }

  function enqueueClassicChannelJob(job: ClassicOutboundJob) {
    enqueueClassicOutboundJob(classicChannelRefs, job, () => {
      void drainClassicChannelQueue();
    });
  }

  function enqueueClassicThreadJob(job: ClassicOutboundJob) {
    enqueueClassicOutboundJob(classicThreadRefs, job, () => {
      void drainClassicThreadQueue();
    });
  }

  function handleChannelOutboundFailure(
    job: ClassicOutboundJob,
    errorMessage: string,
  ) {
    if (isStillSelectedRoom(job.roomId)) {
      setMessagesState((current) =>
        failOutboundMessage(current, job.clientMessageId),
      );
      return;
    }
    toast.error(errorMessage);
    classicChannelJobsRef.current.delete(job.clientMessageId);
  }

  function handleThreadOutboundFailure(
    job: ClassicOutboundJob,
    errorMessage: string,
  ) {
    const shellVisible =
      isStillSelectedRoom(job.roomId) &&
      job.parentMessageId != null &&
      threadParentMessageIdRef.current === job.parentMessageId;
    if (shellVisible) {
      setThreadMessages((current) =>
        failOutboundMessage(current, job.clientMessageId),
      );
      return;
    }
    toast.error(errorMessage);
    classicThreadJobsRef.current.delete(job.clientMessageId);
  }

  async function sendClassicOutboundJob(
    job: ClassicOutboundJob,
  ): Promise<ClassicOutboundSendResult> {
    const result = await sendRoomMessageAction(
      job.roomId,
      job.content,
      job.mentionedCoworkerIds,
      {
        mentionedUserIds: job.mentionedUserIds,
        parentMessageId: job.parentMessageId,
        quote: job.quote,
        clientMessageId: job.clientMessageId,
      },
    );
    if (!result.ok) {
      return {
        ok: false,
        error: {
          message: result.error.message ?? t("Outbound.failed"),
        },
      };
    }
    return { ok: true, value: result.value };
  }

  async function drainClassicChannelQueue() {
    await drainClassicOutboundQueue({
      refs: classicChannelRefs,
      unknownFailureMessage: t("Outbound.failed"),
      send: sendClassicOutboundJob,
      onFailure: handleChannelOutboundFailure,
      onSuccess: (job, confirmed) => {
        if (isStillSelectedRoom(job.roomId)) {
          // Slow-path check only (spinner delay already elapsed); fast path
          // settles to wall-clock with no check.
          applyMessagesFlashingOutboundConfirms(setMessagesState, (current) =>
            confirmOutboundMessage(current, confirmed, job.clientMessageId),
          );
        }
      },
    });
  }

  async function drainClassicThreadQueue() {
    await drainClassicOutboundQueue({
      refs: classicThreadRefs,
      unknownFailureMessage: t("Outbound.failed"),
      send: sendClassicOutboundJob,
      onFailure: handleThreadOutboundFailure,
      onSuccess: (job, confirmed) => {
        if (
          isStillSelectedRoom(job.roomId) &&
          job.parentMessageId != null &&
          threadParentMessageIdRef.current === job.parentMessageId
        ) {
          applyMessagesFlashingOutboundConfirms(setThreadMessages, (current) =>
            confirmOutboundMessage(current, confirmed, job.clientMessageId),
          );
          updateParentThreadPreview(job.parentMessageId, confirmed);
        } else if (
          isStillSelectedRoom(job.roomId) &&
          job.parentMessageId != null
        ) {
          updateParentThreadPreview(job.parentMessageId, confirmed);
        }
      },
    });
  }

  const handleRetryOutbound = useCallback(
    (message: ChatRoomMessage) => {
      const clientTurnId = readClientTurnId(message);
      if (!clientTurnId || !selectedRoom) {
        return;
      }
      const isThread = message.parentMessageId != null;
      const jobsRef = isThread ? classicThreadJobsRef : classicChannelJobsRef;
      const job = jobsRef.current.get(clientTurnId);
      if (!job) {
        return;
      }
      if (isThread) {
        setThreadMessages((current) =>
          markOutboundMessagePending(current, clientTurnId),
        );
        enqueueClassicThreadJob(job);
        return;
      }
      setMessagesState((current) =>
        markOutboundMessagePending(current, clientTurnId),
      );
      enqueueClassicChannelJob(job);
    },
    [selectedRoom],
  );

  const handleRemoveOutbound = useCallback((message: ChatRoomMessage) => {
    const clientTurnId = readClientTurnId(message);
    if (!clientTurnId) {
      return;
    }
    const isThread = message.parentMessageId != null;
    if (isThread) {
      classicThreadJobsRef.current.delete(clientTurnId);
      classicThreadQueueRef.current = classicThreadQueueRef.current.filter(
        (id) => id !== clientTurnId,
      );
      setThreadMessages((current) =>
        removeOutboundMessage(current, clientTurnId),
      );
      return;
    }
    classicChannelJobsRef.current.delete(clientTurnId);
    classicChannelQueueRef.current = classicChannelQueueRef.current.filter(
      (id) => id !== clientTurnId,
    );
    setMessagesState((current) => removeOutboundMessage(current, clientTurnId));
  }, []);

  const handleChannelBeforeSend = useCallback(
    (_clientMessageId: string) => {
      return selectedRoom != null;
    },
    [selectedRoom],
  );

  const handleChannelSend = useCallback(
    async (request: RoomSessionSendRequest): Promise<RoomSessionSendResult> => {
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

      const senderUser = resolveCurrentUserParticipant();
      if (!senderUser) {
        toast.error(t("Outbound.failed"));
        return { ok: false };
      }

      const { mentionedCoworkerIds, mentionedUserIds } = partitionMentionIds(
        request.mentionedIds,
      );

      const pendingQuoteForShell = pendingQuote;
      const pending = createPendingRoomMessage({
        clientTurnId: request.clientMessageId,
        roomId,
        content: request.content,
        senderUser,
        mentionedCoworkerIds,
        quote: pendingQuoteForShell
          ? {
              messageId: pendingQuoteForShell.messageId,
              authorName: pendingQuoteForShell.authorName,
              snippet: pendingQuoteForShell.snippet,
              ...(pendingQuoteForShell.attachment
                ? { attachment: pendingQuoteForShell.attachment }
                : {}),
            }
          : request.quote
            ? {
                messageId: request.quote.messageId,
                authorName: "",
                snippet: "",
              }
            : null,
      });

      setMessagesState((current) => appendMessage(current, pending));
      pinToBottomAfterOwnSend();

      enqueueClassicChannelJob({
        roomId,
        content: request.content,
        mentionedCoworkerIds,
        mentionedUserIds,
        quote: request.quote,
        clientMessageId: request.clientMessageId,
      });

      // Composer must not restore draft — failure lives on the pending shell.
      return { ok: true };
    },
    [
      currentUserId,
      organizationMembers,
      partitionMentionIds,
      pendingQuote,
      pinToBottomAfterOwnSend,
      selectedRoom,
      sendStreamMessage,
    ],
  );

  const handleThreadBeforeSend = useCallback(
    (_clientMessageId: string) => {
      return selectedRoom != null && threadParentMessage != null;
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

      const senderUser = resolveCurrentUserParticipant();
      if (!senderUser) {
        toast.error(t("Outbound.failed"));
        return { ok: false };
      }

      const { mentionedCoworkerIds, mentionedUserIds } = partitionMentionIds(
        request.mentionedIds,
      );

      const pendingQuoteForShell = pendingThreadQuote;
      const pending = createPendingRoomMessage({
        clientTurnId: request.clientMessageId,
        roomId,
        content: request.content,
        senderUser,
        parentMessageId,
        mentionedCoworkerIds,
        quote: pendingQuoteForShell
          ? {
              messageId: pendingQuoteForShell.messageId,
              authorName: pendingQuoteForShell.authorName,
              snippet: pendingQuoteForShell.snippet,
              ...(pendingQuoteForShell.attachment
                ? { attachment: pendingQuoteForShell.attachment }
                : {}),
            }
          : request.quote
            ? {
                messageId: request.quote.messageId,
                authorName: "",
                snippet: "",
              }
            : null,
      });

      setThreadMessages((current) => appendMessage(current, pending));

      enqueueClassicThreadJob({
        roomId,
        content: request.content,
        mentionedCoworkerIds,
        mentionedUserIds,
        quote: request.quote,
        clientMessageId: request.clientMessageId,
        parentMessageId,
      });

      return { ok: true };
    },
    [
      currentUserId,
      organizationMembers,
      partitionMentionIds,
      pendingThreadQuote,
      selectedRoom,
      sendStreamMessage,
      threadParentMessage,
    ],
  );

  const roomHeaderChrome =
    selectedRoom != null ? (
      <RoomHeaderChrome
        room={selectedRoom}
        displayName={selectedRoomDisplayName}
        isDirectRoom={isDirectRoom}
        topLevelRoomMessages={topLevelRoomMessages}
        onOpenThread={handleOpenThreadFromMessage}
        threadListOpen={threadListOpen}
        onToggleThreadList={() => {
          setRosterOpen(false);
          if (threadParentMessage) {
            threadLoadGenerationRef.current += 1;
            setIsThreadLoading(false);
            setThreadParentMessage(null);
            setThreadMessages([]);
            setThreadOlderNextCursor(null);
            setPendingThreadQuote(null);
            clearClassicOutboundQueue(classicThreadRefs);
            setThreadOpenedFromList(false);
            setThreadListOpen(true);
            return;
          }
          setThreadListOpen((open) => !open);
        }}
        rosterOpen={rosterOpen}
        onToggleRoster={handleToggleRoster}
        organizationMembers={organizationMembers}
        coworkers={coworkers}
        canEditMembers={canEditSelectedRoomMembers}
        canManageSettings={canManageSelectedRoomSettings}
        canArchive={canArchiveSelectedRoom}
        canLeave={canLeaveSelectedRoom}
        canInviteGuests={canInviteGuestsToSelectedRoom}
        membersLoadFailed={membersLoadFailed}
        showParticipants={showHeaderParticipants}
      />
    ) : null;

  if (selectedRoom) {
    const showListSkeleton = messagesPending && displayMessages.length === 0;
    const openRoomListBody = (
      <>
        {rosterPromise ? (
          <RoomShellRosterHydrator
            promise={rosterPromise}
            onResolved={handleDeferredRosterResolved}
          />
        ) : null}
        {messagesPromise ? (
          <RoomMessagesHydrator
            promise={messagesPromise}
            onResolved={handleDeferredHistoryResolved}
          />
        ) : null}
        {showListSkeleton ? (
          <RoomMessageListSkeleton />
        ) : effectiveMessageLoadFailed ? (
          <div className="border-border/70 bg-muted/20 rounded-md border border-dashed px-5 py-10 text-center">
            <p className="font-medium">{t("Empty.messagesLoadFailedTitle")}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Empty.messagesLoadFailedDescription")}
            </p>
          </div>
        ) : displayMessages.length === 0 ? (
          <div className="border-border/70 bg-muted/20 rounded-md border border-dashed px-5 py-10 text-center">
            <p className="font-medium">{t("Empty.noMessagesTitle")}</p>
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
        {showListSkeleton
          ? null
          : displayMessages.map((message, index) => {
              const previousMessage = displayMessages[index - 1];
              const showDaySeparator =
                localCalendarReady &&
                (!previousMessage ||
                  messageDayKey(previousMessage.createdAt) !==
                    messageDayKey(message.createdAt));
              const isStreamOverlay = message.id.startsWith("stream:");
              const isThinkingShell =
                isPersistedMentionThoughtShell(message.metadata) ||
                isFailedMentionThoughtShell(message.metadata);
              const isOutboundLocal = isOutboundLocalMessage(message);
              return (
                <div
                  // Prefer client turn id so pending→confirmed keeps one row
                  // instance (delivery chrome can transition without remount).
                  key={readClientTurnId(message) ?? message.id}
                  className="min-w-0"
                >
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
                        !isOutboundLocal &&
                        shouldShowChatRoomThreadButton({
                          room: selectedRoom,
                          isStreamOverlay,
                          isThinkingShell,
                        })
                          ? handleOpenThreadFromMessage
                          : undefined
                      }
                      onQuote={isOutboundLocal ? undefined : handleQuoteMessage}
                      onStartEdit={
                        isOutboundLocal ? undefined : handleStartEdit
                      }
                      onDelete={
                        isOutboundLocal ? undefined : handleDeleteMessage
                      }
                      onRetryOutbound={handleRetryOutbound}
                      onRemoveOutbound={handleRemoveOutbound}
                      showOutboundSentTick={outboundSentTickIds.has(message.id)}
                      isEditing={editSession?.messageId === message.id}
                      editDraft={
                        editSession?.messageId === message.id
                          ? editSession.draft
                          : ""
                      }
                      onEditDraftChange={handleEditDraftChange}
                      onCancelEdit={handleCancelEdit}
                      onSaveEdit={handleSaveEdit}
                      isSavingEdit={
                        isSavingEdit && editSession?.messageId === message.id
                      }
                      showThreadButton={
                        !isOutboundLocal &&
                        shouldShowChatRoomThreadButton({
                          room: selectedRoom,
                          isStreamOverlay,
                          isThinkingShell,
                        })
                      }
                      isFirstOfDay={showDaySeparator}
                      isContinuation={
                        localCalendarReady &&
                        !showDaySeparator &&
                        isMessageContinuation(previousMessage, message)
                      }
                    />
                  )}
                </div>
              );
            })}
      </>
    );

    return (
      <>
        {mobileHeaderPortaled && headerRoomSlotHost && roomHeaderChrome
          ? createPortal(roomHeaderChrome, headerRoomSlotHost)
          : null}
        <RoomShellLayout
          // ROOM_SHELL_ROOT already includes no-tab-bar height (matches Instant).
          rootClassName={ROOM_SHELL_ROOT_CLASSNAME}
          beforeMain={
            currentUserId ? (
              <LazyAblyProvider>
                <RoomMessageRealtimeBridge
                  roomIds={rooms.map((room) => room.id)}
                  currentUserId={currentUserId}
                  selectedRoomId={selectedRoomId}
                  onMessage={handleChatRoomRealtimeMessage}
                />
              </LazyAblyProvider>
            ) : null
          }
          reserveDesktopHeader
          // Keep title in-column until after first paint (portal flips in
          // useEffect). First real chrome frame = title + composer together.
          desktopHeader={
            !mobileHeaderPortaled && roomHeaderChrome ? roomHeaderChrome : null
          }
          wrapColumn={(columnBody) => (
            <RoomFileDropZone
              enabled={!isCoworkerStreamRoom}
              onFiles={(files) => {
                roomComposerRef.current?.attachFiles(files);
              }}
              label={t("Toolbar.dropToAttach")}
              className={ROOM_SHELL_COLUMN_CLASSNAME}
            >
              {columnBody}
            </RoomFileDropZone>
          )}
          listScrollerRef={scrollerRef}
          listContentRef={contentRef}
          listContentStyle={
            contentMinHeight != null
              ? { minHeight: contentMinHeight }
              : undefined
          }
          listContent={openRoomListBody}
          composer={
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
              isSending={isCoworkerStreaming}
              showMentionShortcut={shouldShowRoomMentionShortcut(selectedRoom)}
              allowAttachments={!isCoworkerStreamRoom}
              pendingQuote={pendingQuote}
              onClearPendingQuote={() => setPendingQuote(null)}
              onRestorePendingQuote={setPendingQuote}
              onChromeResize={scrollToBottomIfPinned}
              // Autofocus only after history settles. Send stays enabled so
              // optimistic posts work during progressive open (merge into list).
              focusOnMount={!messagesPending}
              onBeforeSend={handleChannelBeforeSend}
              onSend={handleChannelSend}
            />
          }
          mainEnd={
            threadParentMessage ? (
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
                  isCoworkerStreaming && threadStreamOverlayMessages.length > 0
                }
                onRetryOutbound={handleRetryOutbound}
                onRemoveOutbound={handleRemoveOutbound}
                outboundSentTickIds={outboundSentTickIds}
                onBack={threadOpenedFromList ? backToThreadList : undefined}
                onClose={closeThreadSidePanel}
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
                showMentionShortcut={shouldShowRoomMentionShortcut(
                  selectedRoom,
                )}
                allowAttachments={!isCoworkerStreamRoom}
                roomId={selectedRoom.id}
              />
            ) : threadListOpen ? (
              <ThreadListPanel
                roomId={selectedRoom.id}
                onOpenThread={handleOpenThreadFromList}
                onClose={() => {
                  setThreadListOpen(false);
                }}
                onAllThreadsLooked={() => {
                  void syncRoomAttentionAfterThreadLook(selectedRoom.id);
                }}
                labels={{
                  title: t("UnreadThreads.title"),
                  markAllRead: t("UnreadThreads.markAllRead"),
                  empty: t("UnreadThreads.empty"),
                  loading: t("UnreadThreads.loading"),
                  error: t("UnreadThreads.error"),
                  markAllReadError: t("UnreadThreads.markAllReadError"),
                  loadOlder: t("UnreadThreads.loadOlder"),
                  startedBy: (name) => t("UnreadThreads.startedBy", { name }),
                  unreadReplies: (count) =>
                    t("UnreadThreads.unreadReplies", { count }),
                  replies: (count) => t("Thread.replyCount", { count }),
                  close: t("UnreadThreads.close"),
                }}
              />
            ) : showRoomRosterControl && rosterOpen ? (
              <RoomRosterPanel
                participants={getRoomParticipantPreviews(selectedRoom)}
                currentUserId={currentUserId}
                canOpenHumanDirect={canOpenHumanDirect}
                onOpenDirect={handleOpenDirectMessage}
                openingDirectKey={openingDirectKey}
                onClose={() => {
                  setRosterOpen(false);
                }}
                labels={{
                  title: t("RoomRoster.title"),
                  close: t("RoomRoster.close"),
                  empty: t("RoomRoster.empty"),
                  coworkerBadge: t("coworkerBadge"),
                  message: (name) => t("RoomRoster.message", { name }),
                  copy: (value) => t("RoomRoster.copy", { value }),
                  copySuccess: t("RoomRoster.copySuccess"),
                  copyError: t("RoomRoster.copyError"),
                }}
              />
            ) : null
          }
        />
      </>
    );
  }

  // Create-channel / new-DM / empty selection — unchanged non-room surfaces.
  return (
    <div
      className={cn(
        ROOM_SHELL_ROOT_CLASSNAME,
        chatMobileHeightShellClass(pathname, isApple, searchParams),
      )}
    >
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
                    onClick={() => router.push("/?create=channel")}
                  >
                    {t("createChannel")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
