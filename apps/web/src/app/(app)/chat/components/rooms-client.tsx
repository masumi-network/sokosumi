"use client";

import { Hash, Loader2, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  listRoomMessagesAction,
  listThreadMessagesAction,
  sendRoomMessageAction,
  toggleMessageReactionAction,
} from "@/app/chat/actions";
import DaySeparator from "@/app/chat/components/day-separator";
import {
  readStoredStreamParentMessageId,
  useCoworkerDirectRoomStream,
} from "@/app/chat/hooks/use-coworker-direct-room-stream";
import { formatDaySeparator } from "@/app/chat/utils/date-utils";
import {
  mergeMessagesWithStreamOverlay,
  mergeRoomMessages,
} from "@/app/chat/utils/merge-room-messages";
import { peekPendingRoomMessage } from "@/app/chat/utils/pending-room-message";
import { markOrganizationChatRoomReadAction } from "@/components/chat/organization-chat-list.actions";
import { PresenceDot } from "@/components/chat/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";
import type {
  ChatRoom,
  ChatRoomMessage,
  Coworker,
  Member,
  Organization,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { slugifyMentionValue } from "@/lib/utils/mention-parser";
import { formatTaskAttachmentMarkdown } from "@/lib/utils/task-attachments";
import { getInitials } from "@/lib/utils/text";
import { DraftChannel } from "./draft-channel";
import { DraftDirectMessage } from "./draft-direct-message";
import { EditChannelDialog } from "./edit-channel-dialog";
import {
  RoomComposer,
  type RoomComposerAttachment,
  type RoomComposerHandle,
} from "./room-composer";
import { RoomFileDropZone } from "./room-file-drop-zone";
import {
  appendMessage,
  buildRoomComposerMessageContent,
  getRoomDisplayName,
  getRoomParticipantPreviews,
  hasPendingCoworkerMention,
  isMessageContinuation,
  isRoomComposerEmpty,
  messageDayKey,
  type PendingRoomQuote,
  pendingQuoteFromMessage,
  presenceLabel,
  type RoomMentionParticipant,
  shouldShowChatRoomThreadButton,
  shouldShowRoomMentionShortcut,
  shouldUseCoworkerRoomStream,
} from "./room-helpers";
import { ChatMessageRow } from "./room-message-row";
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
}

const COWORKER_RESPONSE_POLL_MS = 2500;
/** ~2.5 minutes of polling before we stop waiting for a coworker reply. */
const COWORKER_RESPONSE_POLL_MAX_ATTEMPTS = 60;
/** Match sidebar channel-list cadence for peer traffic while a room is open. */
const ROOM_LIVE_POLL_MS = 15_000;

function RoomParticipantStack({ room }: { room: ChatRoom }) {
  const t = useTranslations("App.Channels");
  const participants = getRoomParticipantPreviews(room);
  const visibleParticipants = participants.slice(0, 4);
  const remainingCount = participants.length - visibleParticipants.length;

  if (participants.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        className="flex -space-x-2"
        aria-label={participants
          .map((participant) => participant.name)
          .join(", ")}
      >
        {visibleParticipants.map((participant, index) => (
          <span
            key={`${participant.kind}-${participant.id}`}
            className="relative block size-7 shrink-0"
            style={{ zIndex: visibleParticipants.length - index }}
            title={participant.name}
          >
            <Avatar className="border-background ring-border/60 size-7 border-2 shadow-xs ring-1">
              <AvatarImage src={participant.image ?? undefined} alt="" />
              <AvatarFallback
                className={cn(
                  "text-[10px]",
                  participant.kind === "coworker"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {getInitials(participant.name)}
              </AvatarFallback>
            </Avatar>
            <PresenceDot
              presence={participant.presence}
              label={presenceLabel(t, participant.presence)}
              className="absolute -right-0.5 -bottom-0.5"
            />
          </span>
        ))}
      </div>
      {remainingCount > 0 ? (
        <span className="text-muted-foreground whitespace-nowrap text-xs font-medium">
          {t("participantOverflow", { count: remainingCount })}
        </span>
      ) : null}
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
}: RoomsClientProps) {
  const t = useTranslations("App.Channels");
  const tBreadcrumb = useTranslations("Components.Breadcrumb");
  const router = useRouter();
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    RoomComposerAttachment[]
  >([]);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
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
  const [threadComposerValue, setThreadComposerValue] = useState("");
  const [threadComposerAttachments, setThreadComposerAttachments] = useState<
    RoomComposerAttachment[]
  >([]);
  const [threadMentionedIds, setThreadMentionedIds] = useState<string[]>([]);
  const [pendingThreadQuote, setPendingThreadQuote] =
    useState<PendingRoomQuote | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const roomComposerRef = useRef<RoomComposerHandle | null>(null);
  const readMarkerRef = useRef<string | null>(null);
  const syncedRoomIdRef = useRef<string | null>(null);
  // RoomsClient stays mounted across /chat/rooms/[id] navigations. Async
  // handlers must not merge into messagesState after the selection moved.
  const selectedRoomIdRef = useRef(selectedRoomId);
  selectedRoomIdRef.current = selectedRoomId;
  const [isSending, startSendingTransition] = useTransition();
  const [isThreadLoading, startThreadLoadingTransition] = useTransition();
  const [isSendingThreadReply, startSendingThreadReplyTransition] =
    useTransition();
  const [_isReacting, startReactionTransition] = useTransition();
  const [isLoadingOlder, startLoadingOlderTransition] = useTransition();
  const [isLoadingOlderThread, startLoadingOlderThreadTransition] =
    useTransition();
  const pendingReactionsRef = useRef<Set<string>>(new Set());
  const selectedRoom = isNewDirectMessage
    ? null
    : (rooms.find((room) => room.id === selectedRoomId) ?? null);

  function isStillSelectedRoom(roomId: string): boolean {
    return selectedRoomIdRef.current === roomId;
  }
  const selectedRoomDisplayName = selectedRoom
    ? getRoomDisplayName(selectedRoom, currentUserId)
    : "";

  const isDirectRoom = selectedRoom?.kind === "direct";
  const currentMemberRole = organizationMembers.find(
    (member) => member.user.id === currentUserId,
  )?.role;
  // Archiving hides the room for everyone: creator or org owner/admin only.
  const canArchiveSelectedRoom = Boolean(
    selectedRoom &&
      !isDirectRoom &&
      (selectedRoom.createdByUserId === currentUserId ||
        currentMemberRole === "owner" ||
        currentMemberRole === "admin"),
  );
  // Any member can leave, but not the last one — an empty roster could not be
  // archived (archive requires membership of creator/owner/admin).
  const canLeaveSelectedRoom = Boolean(
    selectedRoom && !isDirectRoom && selectedRoom.userMembers.length > 1,
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
        toast.error(roomResult.message);
        return false;
      }
      if (!isStillSelectedRoom(roomId)) {
        return false;
      }
      setMessagesState((current) =>
        mergeRoomMessages(current, roomResult.data.messages),
      );
      if (threadResult?.ok && threadParentId) {
        setThreadMessages((current) =>
          mergeRoomMessages(current, threadResult.data.messages),
        );
        setThreadParentMessage((current) => {
          const fromRoom =
            roomResult.data.messages.find(
              (message) => message.id === threadParentId,
            ) ?? null;
          if (current) {
            return (
              roomResult.data.messages.find(
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

  const topLevelStreamOverlayMessages = useMemo(
    () =>
      streamOverlayMessages.filter(
        (message) => message.parentMessageId == null,
      ),
    [streamOverlayMessages],
  );

  const displayMessages = useMemo(() => {
    return mergeMessagesWithStreamOverlay(
      messagesState,
      topLevelStreamOverlayMessages,
    );
  }, [messagesState, topLevelStreamOverlayMessages]);

  const threadStreamOverlayMessages = useMemo(() => {
    if (!threadParentMessage) {
      return [];
    }
    return streamOverlayMessages.filter(
      (message) => message.parentMessageId === threadParentMessage.id,
    );
  }, [streamOverlayMessages, threadParentMessage]);

  const displayThreadMessages = useMemo(() => {
    return mergeMessagesWithStreamOverlay(
      threadMessages,
      threadStreamOverlayMessages,
    );
  }, [threadMessages, threadStreamOverlayMessages]);

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
      messagesState.find(
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
    messagesState,
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
                  label: t("Dialog.createTitle"),
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
    return Object.fromEntries([...humanEntries, ...coworkerEntries]);
  }, [currentUserId, selectedRoom]);

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

  useEffect(() => {
    setComposerValue("");
    setComposerAttachments([]);
    setMentionedIds([]);
    setPendingQuote(null);
    setThreadParentMessage(null);
    setThreadMessages([]);
    setThreadComposerValue("");
    setThreadComposerAttachments([]);
    setThreadMentionedIds([]);
    setPendingThreadQuote(null);
  }, [selectedRoomId, isNewDirectMessage, isCreateChannelRequested]);

  // Scroll on room switch or when the newest message changes — not when
  // an older page is prepended (length grows, last id stays the same).
  const latestMessageId = displayMessages.at(-1)?.id ?? null;
  const latestStreamContent =
    topLevelStreamOverlayMessages.at(-1)?.content ?? "";
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [latestMessageId, latestStreamContent, selectedRoomId]);

  const latestVisibleMessageId = displayMessages.at(-1)?.id ?? "empty";
  const selectedRoomReadId = selectedRoom?.id ?? null;

  useEffect(() => {
    if (!selectedRoomReadId) {
      return;
    }

    const marker = `${selectedRoomReadId}:${latestVisibleMessageId}`;
    if (readMarkerRef.current === marker) {
      return;
    }
    readMarkerRef.current = marker;

    let cancelled = false;
    markOrganizationChatRoomReadAction(selectedRoomReadId).then((result) => {
      if (cancelled || !result.ok) {
        return;
      }
      window.dispatchEvent(
        new CustomEvent("organization-chat-room-read", {
          detail: { room: result.data, roomId: selectedRoomReadId },
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [latestVisibleMessageId, selectedRoomReadId]);

  const hasPendingRoomCoworkerMention = useMemo(
    () => hasPendingCoworkerMention(messagesState),
    [messagesState],
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
          mergeRoomMessages(current, result.data.messages),
        );
        setThreadParentMessage((current) =>
          current
            ? (result.data.messages.find(
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

  // Peer traffic while the room stays open: light poll + focus/visibility
  // refetch. Merges into local state so previously loaded older pages survive.
  // Skip ticks while a coworker DM stream is in flight (avoids duplicate overlay).
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
      const result = await listRoomMessagesAction(roomId);
      if (cancelled || !result.ok) {
        return;
      }
      setMessagesState((current) =>
        mergeRoomMessages(current, result.data.messages),
      );
      setThreadParentMessage((current) =>
        current
          ? (result.data.messages.find(
              (message) => message.id === current.id,
            ) ?? current)
          : current,
      );
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
          mergeRoomMessages(current, threadResult.data.messages),
        );
      }
      if (roomResult.ok) {
        setMessagesState((current) =>
          mergeRoomMessages(current, roomResult.data.messages),
        );
        setThreadParentMessage((current) =>
          current
            ? (roomResult.data.messages.find(
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
    setMessagesState((current) =>
      current.map((message) =>
        message.id === updatedMessage.id ? updatedMessage : message,
      ),
    );
    setThreadMessages((current) =>
      current.map((message) =>
        message.id === updatedMessage.id ? updatedMessage : message,
      ),
    );
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

  function loadThreadMessages(parentMessage: ChatRoomMessage) {
    if (!selectedRoom) return;
    const roomId = selectedRoom.id;
    setThreadParentMessage(parentMessage);
    setThreadMessages([]);
    setThreadOlderNextCursor(null);
    startThreadLoadingTransition(async () => {
      const result = await listThreadMessagesAction(roomId, parentMessage.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      setThreadMessages(result.data.messages);
      setThreadOlderNextCursor(result.data.nextCursor);
    });
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
        toast.error(result.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      setMessagesState((current) =>
        mergeRoomMessages(current, result.data.messages),
      );
      setOlderNextCursor(result.data.nextCursor);
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
        toast.error(result.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      setThreadMessages((current) =>
        mergeRoomMessages(current, result.data.messages),
      );
      setThreadOlderNextCursor(result.data.nextCursor);
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
        toast.error(result.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      mergeUpdatedMessage(result.data);
    });
  }

  function handleQuoteMessage(message: ChatRoomMessage) {
    setPendingQuote(pendingQuoteFromMessage(message));
  }

  function handleQuoteThreadMessage(message: ChatRoomMessage) {
    setPendingThreadQuote(pendingQuoteFromMessage(message));
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRoom) return;
    const roomId = selectedRoom.id;
    const content = buildRoomComposerMessageContent(
      composerValue,
      composerAttachments,
      formatTaskAttachmentMarkdown,
    );
    if (!content) return;

    const quotePayload = pendingQuote
      ? { messageId: pendingQuote.messageId }
      : undefined;

    // Stream OpenAPI has no quote field — classic POST when quoting so the
    // snapshot persists (coworker AI auto-reply may not run for that turn).
    if (shouldUseCoworkerRoomStream(selectedRoom) && !quotePayload) {
      setComposerValue("");
      setComposerAttachments([]);
      setMentionedIds([]);
      setPendingQuote(null);
      sendStreamMessage(content);
      return;
    }

    const { mentionedCoworkerIds, mentionedUserIds } =
      partitionMentionIds(mentionedIds);
    startSendingTransition(async () => {
      const result = await sendRoomMessageAction(
        roomId,
        content,
        mentionedCoworkerIds,
        {
          mentionedUserIds,
          quote: quotePayload,
        },
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }
      setMessagesState((current) => appendMessage(current, result.data));
      setComposerValue("");
      setComposerAttachments([]);
      setMentionedIds([]);
      setPendingQuote(null);
    });
  }

  function handleSendThreadReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRoom || !threadParentMessage) return;
    const roomId = selectedRoom.id;
    const parentMessageId = threadParentMessage.id;
    const content = buildRoomComposerMessageContent(
      threadComposerValue,
      threadComposerAttachments,
      formatTaskAttachmentMarkdown,
    );
    if (!content) return;

    const quotePayload = pendingThreadQuote
      ? { messageId: pendingThreadQuote.messageId }
      : undefined;

    if (shouldUseCoworkerRoomStream(selectedRoom) && !quotePayload) {
      setThreadComposerValue("");
      setThreadComposerAttachments([]);
      setThreadMentionedIds([]);
      setPendingThreadQuote(null);
      sendStreamMessage(content, { parentMessageId });
      return;
    }

    const { mentionedCoworkerIds, mentionedUserIds } =
      partitionMentionIds(threadMentionedIds);
    startSendingThreadReplyTransition(async () => {
      const result = await sendRoomMessageAction(
        roomId,
        content,
        mentionedCoworkerIds,
        {
          mentionedUserIds,
          parentMessageId,
          quote: quotePayload,
        },
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (!isStillSelectedRoom(roomId)) {
        return;
      }

      setThreadMessages((current) => [...current, result.data]);
      updateParentThreadPreview(parentMessageId, result.data);
      setThreadComposerValue("");
      setThreadComposerAttachments([]);
      setThreadMentionedIds([]);
      setPendingThreadQuote(null);
    });
  }

  return (
    <div className="-m-4 flex h-[calc(100svh-64px)] min-h-0 flex-col overflow-hidden bg-background">
      {/* `relative` anchors the thread panel's mobile full-screen takeover. */}
      <main className="relative flex min-h-0 flex-1">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {isCreateChannelRequested ? (
            <DraftChannel
              members={organizationMembers}
              coworkers={coworkers}
              currentUserId={currentUserId}
              membersLoadFailed={membersLoadFailed}
            />
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
              className="flex min-h-0 flex-1 flex-col"
            >
              <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-6">
                <div className="flex min-w-0 items-center gap-2">
                  {isDirectRoom ? (
                    <MessageCircle className="text-muted-foreground size-4 shrink-0" />
                  ) : (
                    <Hash className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <p className="text-muted-foreground truncate text-sm">
                    {selectedRoomDisplayName}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <RoomParticipantStack room={selectedRoom} />
                  {isDirectRoom ? null : (
                    <EditChannelDialog
                      channel={selectedRoom}
                      members={organizationMembers}
                      coworkers={coworkers}
                      canArchive={canArchiveSelectedRoom}
                      canLeave={canLeaveSelectedRoom}
                      membersLoadFailed={membersLoadFailed}
                    />
                  )}
                </div>
              </header>

              <ScrollArea className="min-h-0 flex-1">
                <div className="flex w-full flex-col px-5 pt-6 pb-8">
                  {messageLoadFailed ? (
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
                  {olderNextCursor ? (
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
                  ) : null}
                  {displayMessages.map((message, index) => {
                    const previousMessage = displayMessages[index - 1];
                    const showDaySeparator =
                      !previousMessage ||
                      messageDayKey(previousMessage.createdAt) !==
                        messageDayKey(message.createdAt);
                    const isStreamOverlay = message.id.startsWith("stream:");
                    return (
                      <div key={message.id}>
                        {showDaySeparator ? (
                          <DaySeparator
                            date={new Date(message.createdAt)}
                            formatDaySeparator={formatDaySeparator}
                          />
                        ) : null}
                        <ChatMessageRow
                          message={message}
                          coworkersById={coworkersById}
                          coworkersBySlug={coworkersBySlug}
                          usersById={usersById}
                          usersBySlug={usersBySlug}
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
                          // Stream overlays never show thread chrome.
                          showThreadButton={shouldShowChatRoomThreadButton({
                            room: selectedRoom,
                            isStreamOverlay,
                          })}
                          isContinuation={
                            !showDaySeparator &&
                            isMessageContinuation(previousMessage, message)
                          }
                        />
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>

              <RoomComposer
                ref={roomComposerRef}
                roomId={selectedRoom.id}
                value={composerValue}
                onValueChange={setComposerValue}
                mentions={mentionRecords}
                onSelectedKeysChange={setMentionedIds}
                placeholder={
                  isDirectRoom
                    ? t("directComposerPlaceholder", {
                        member: selectedRoomDisplayName,
                      })
                    : t("composerPlaceholderWithChannel", {
                        channel: selectedRoomDisplayName,
                      })
                }
                attachments={composerAttachments}
                onAttachmentsChange={setComposerAttachments}
                onSubmit={handleSend}
                isSending={isSending || isCoworkerStreaming}
                sendDisabled={isRoomComposerEmpty(
                  composerValue,
                  composerAttachments,
                )}
                showMentionShortcut={shouldShowRoomMentionShortcut(
                  selectedRoom,
                )}
                allowAttachments={!isCoworkerStreamRoom}
                pendingQuote={pendingQuote}
                onClearPendingQuote={() => setPendingQuote(null)}
                onChromeResize={() => {
                  bottomRef.current?.scrollIntoView({ block: "end" });
                }}
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
            replyValue={threadComposerValue}
            onReplyValueChange={setThreadComposerValue}
            replyMentionedIdsChange={setThreadMentionedIds}
            replyAttachments={threadComposerAttachments}
            onReplyAttachmentsChange={setThreadComposerAttachments}
            onSubmitReply={handleSendThreadReply}
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
            pendingQuote={pendingThreadQuote}
            onClearPendingQuote={() => setPendingThreadQuote(null)}
            showMentionShortcut={shouldShowRoomMentionShortcut(selectedRoom)}
            allowAttachments={!isCoworkerStreamRoom}
            roomId={selectedRoom.id}
          />
        ) : null}
      </main>
    </div>
  );
}
