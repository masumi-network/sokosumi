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
  listChannelMessagesAction,
  listThreadMessagesAction,
  sendChannelMessageAction,
  toggleMessageReactionAction,
} from "@/app/chat/actions";
import DaySeparator from "@/app/chat/components/day-separator";
import { useCoworkerDirectRoomStream } from "@/app/chat/hooks/use-coworker-direct-room-stream";
import { formatDaySeparator } from "@/app/chat/utils/date-utils";
import {
  mergeChannelMessages,
  mergeMessagesWithStreamOverlay,
} from "@/app/chat/utils/merge-channel-messages";
import {
  clearPendingRoomMessage,
  peekPendingRoomMessage,
} from "@/app/chat/utils/pending-room-message";
import { markOrganizationChatChannelReadAction } from "@/components/chat/organization-chat-list.actions";
import { PresenceDot } from "@/components/chat/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { MentionRecordEntry } from "@/components/ui/mention-textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRegisterBreadcrumbOverride } from "@/contexts/breadcrumb-override-context";
import type {
  ChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  Coworker,
  Member,
  Organization,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import {
  ChannelComposer,
  type ChannelComposerAttachment,
} from "./channel-composer";
import {
  appendMessage,
  getChannelDisplayName,
  getChannelParticipantPreviews,
  getDirectChannelSubtitle,
  hasPendingCoworkerMention,
  isCoworkerOnlyDirectRoom,
  messageDayKey,
  presenceLabel,
  shouldShowRoomMentionShortcut,
} from "./channel-helpers";
import { ChatMessageRow } from "./channel-message-row";
import { DraftChannel } from "./draft-channel";
import { DraftDirectMessage } from "./draft-direct-message";
import { EditChannelDialog } from "./edit-channel-dialog";
import { ThreadPanel } from "./thread-panel";

interface ChannelsClientProps {
  /** Null in personal workspace when mounting Start New DM only. */
  activeOrganization: Organization | null;
  channels: ChatRoom[];
  organizationMembers: Member[];
  currentUserId: string;
  coworkers: Coworker[];
  selectedChannelId: string | null;
  isCreateChannelRequested: boolean;
  isNewDirectMessage: boolean;
  messageLoadFailed: boolean;
  messages: ChatRoomMessage[];
  /** Cursor for the next older page; null when the initial page is complete. */
  messagesNextCursor: string | null;
}

const COWORKER_RESPONSE_POLL_MS = 2500;
/** ~2.5 minutes of polling before we stop waiting for a coworker reply. */
const COWORKER_RESPONSE_POLL_MAX_ATTEMPTS = 60;
/** Match sidebar channel-list cadence for peer traffic while a channel is open. */
const CHANNEL_LIVE_POLL_MS = 15_000;

function ChannelParticipantStack({ channel }: { channel: ChatRoom }) {
  const t = useTranslations("App.Channels");
  const participants = getChannelParticipantPreviews(channel);
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

export function ChannelsClient({
  activeOrganization,
  channels,
  organizationMembers,
  currentUserId,
  coworkers,
  selectedChannelId,
  isCreateChannelRequested,
  isNewDirectMessage,
  messageLoadFailed,
  messages,
  messagesNextCursor,
}: ChannelsClientProps) {
  const t = useTranslations("App.Channels");
  const tBreadcrumb = useTranslations("Components.Breadcrumb");
  const router = useRouter();
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<
    ChannelComposerAttachment[]
  >([]);
  const [mentionedCoworkerIds, setMentionedCoworkerIds] = useState<string[]>(
    [],
  );
  const [messagesState, setMessagesState] =
    useState<ChatRoomMessage[]>(messages);
  const [olderNextCursor, setOlderNextCursor] = useState<string | null>(
    messagesNextCursor,
  );
  const [threadParentMessage, setThreadParentMessage] =
    useState<ChatRoomMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChatRoomMessage[]>([]);
  const [threadOlderNextCursor, setThreadOlderNextCursor] = useState<
    string | null
  >(null);
  const [threadComposerValue, setThreadComposerValue] = useState("");
  const [threadComposerAttachments, setThreadComposerAttachments] = useState<
    ChannelComposerAttachment[]
  >([]);
  const [threadMentionedCoworkerIds, setThreadMentionedCoworkerIds] = useState<
    string[]
  >([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const readMarkerRef = useRef<string | null>(null);
  const syncedChannelIdRef = useRef<string | null>(null);
  const [isSending, startSendingTransition] = useTransition();
  const [isThreadLoading, startThreadLoadingTransition] = useTransition();
  const [isSendingThreadReply, startSendingThreadReplyTransition] =
    useTransition();
  const [_isReacting, startReactionTransition] = useTransition();
  const [isLoadingOlder, startLoadingOlderTransition] = useTransition();
  const [isLoadingOlderThread, startLoadingOlderThreadTransition] =
    useTransition();
  const pendingReactionsRef = useRef<Set<string>>(new Set());
  const selectedChannel = isNewDirectMessage
    ? null
    : (channels.find((channel) => channel.id === selectedChannelId) ?? null);
  const selectedChannelDisplayName = selectedChannel
    ? getChannelDisplayName(selectedChannel, currentUserId)
    : "";
  const isDirectChannel = selectedChannel?.kind === "direct";
  const isCoworkerStreamRoom = selectedChannel
    ? isCoworkerOnlyDirectRoom(selectedChannel)
    : false;

  const refreshRoomMessagesAfterStream = useCallback(
    async (roomId: string): Promise<boolean> => {
      const result = await listChannelMessagesAction(roomId);
      if (!result.ok) {
        toast.error(result.message);
        return false;
      }
      setMessagesState((current) =>
        mergeChannelMessages(current, result.data.messages),
      );
      return true;
    },
    [],
  );

  const {
    streamOverlayMessages,
    isStreaming: isCoworkerStreaming,
    sendStreamMessage,
    consumePendingStreamMessage,
  } = useCoworkerDirectRoomStream({
    room: selectedChannel,
    enabled: isCoworkerStreamRoom,
    currentUserId,
    organizationSlug: activeOrganization?.slug ?? null,
    onStreamSettled: refreshRoomMessagesAfterStream,
  });

  const displayMessages = useMemo(() => {
    return mergeMessagesWithStreamOverlay(messagesState, streamOverlayMessages);
  }, [messagesState, streamOverlayMessages]);

  // Draft coworker DM stashes text then navigates — auto-stream once room opens.
  // Keep sessionStorage until stream actually starts so Strict Mode remount
  // cannot lose the draft before send begins.
  useEffect(() => {
    if (!isCoworkerStreamRoom || !selectedChannelId) {
      return;
    }
    const pending = peekPendingRoomMessage(selectedChannelId);
    if (!pending) {
      return;
    }
    consumePendingStreamMessage(pending);
  }, [isCoworkerStreamRoom, selectedChannelId, consumePendingStreamMessage]);

  useEffect(() => {
    if (!selectedChannelId || !isCoworkerStreaming) {
      return;
    }
    clearPendingRoomMessage(selectedChannelId);
  }, [selectedChannelId, isCoworkerStreaming]);

  const breadcrumbOverride = useMemo(
    () => ({
      pathname: selectedChannel ? `/chat/rooms/${selectedChannel.id}` : "/chat",
      segments: [
        {
          label: tBreadcrumb("chat"),
          href: "/chat",
        },
        ...(selectedChannel
          ? [
              {
                label: selectedChannelDisplayName,
                href: `/chat/rooms/${selectedChannel.id}`,
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
      selectedChannel,
      selectedChannelDisplayName,
      isCreateChannelRequested,
      isNewDirectMessage,
      t,
      tBreadcrumb,
    ],
  );
  useRegisterBreadcrumbOverride(breadcrumbOverride);
  const coworkersById = useMemo(() => {
    return new Map(
      (selectedChannel?.coworkerMembers ?? []).map((coworker) => [
        coworker.id,
        coworker,
      ]),
    );
  }, [selectedChannel]);
  const coworkersBySlug = useMemo(() => {
    return new Map(
      (selectedChannel?.coworkerMembers ?? []).map((coworker) => [
        coworker.slug,
        coworker,
      ]),
    );
  }, [selectedChannel]);
  const mentionRecords = useMemo<
    Record<string, MentionRecordEntry<ChatRoomCoworkerParticipant>>
  >(() => {
    return Object.fromEntries(
      (selectedChannel?.coworkerMembers ?? []).map((coworker) => [
        coworker.id,
        {
          value: coworker.name,
          slug: coworker.slug,
          data: coworker,
        },
      ]),
    );
  }, [selectedChannel]);

  useEffect(() => {
    const isChannelSwitch = syncedChannelIdRef.current !== selectedChannelId;
    syncedChannelIdRef.current = selectedChannelId;

    // Channel switch: replace. Same channel RSC refresh (e.g. revalidatePath):
    // merge so client-loaded older pages are not wiped by the latest page.
    if (isChannelSwitch) {
      setMessagesState(messages);
      setOlderNextCursor(messagesNextCursor);
    } else {
      setMessagesState((current) => mergeChannelMessages(current, messages));
    }
    setThreadParentMessage((current) =>
      current
        ? (messages.find((message) => message.id === current.id) ?? current)
        : current,
    );
  }, [messages, messagesNextCursor, selectedChannelId]);

  useEffect(() => {
    setComposerValue("");
    setComposerAttachments([]);
    setMentionedCoworkerIds([]);
    setThreadParentMessage(null);
    setThreadMessages([]);
    setThreadComposerValue("");
    setThreadComposerAttachments([]);
    setThreadMentionedCoworkerIds([]);
  }, [selectedChannelId, isNewDirectMessage, isCreateChannelRequested]);

  // Scroll on channel switch or when the newest message changes — not when
  // an older page is prepended (length grows, last id stays the same).
  const latestMessageId = displayMessages.at(-1)?.id ?? null;
  const latestStreamContent = streamOverlayMessages.at(-1)?.content ?? "";
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [latestMessageId, latestStreamContent, selectedChannelId]);

  const latestVisibleMessageId = displayMessages.at(-1)?.id ?? "empty";
  const selectedChannelReadId = selectedChannel?.id ?? null;

  useEffect(() => {
    if (!selectedChannelReadId) {
      return;
    }

    const marker = `${selectedChannelReadId}:${latestVisibleMessageId}`;
    if (readMarkerRef.current === marker) {
      return;
    }
    readMarkerRef.current = marker;

    let cancelled = false;
    markOrganizationChatChannelReadAction(selectedChannelReadId).then(
      (result) => {
        if (cancelled || !result.ok) {
          return;
        }
        window.dispatchEvent(
          new CustomEvent("organization-chat-channel-read", {
            detail: { channel: result.data, channelId: selectedChannelReadId },
          }),
        );
      },
    );

    return () => {
      cancelled = true;
    };
  }, [latestVisibleMessageId, selectedChannelReadId]);

  const hasPendingChannelCoworkerMention = useMemo(
    () => hasPendingCoworkerMention(messagesState),
    [messagesState],
  );
  const hasPendingThreadCoworkerMention = useMemo(
    () => hasPendingCoworkerMention(threadMessages),
    [threadMessages],
  );

  useEffect(() => {
    if (!selectedChannel || !hasPendingChannelCoworkerMention) {
      return;
    }

    const channelId = selectedChannel.id;
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
      const result = await listChannelMessagesAction(channelId);
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setMessagesState((current) =>
          mergeChannelMessages(current, result.data.messages),
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
  }, [selectedChannel?.id, hasPendingChannelCoworkerMention]);

  // Peer traffic while the channel stays open: light poll + focus/visibility
  // refetch. Merges into local state so previously loaded older pages survive.
  // Skip ticks while a coworker DM stream is in flight (avoids duplicate overlay).
  useEffect(() => {
    if (!selectedChannel) {
      return;
    }

    const channelId = selectedChannel.id;
    const skipWhileStreaming = isCoworkerOnlyDirectRoom(selectedChannel);
    let cancelled = false;

    const refreshLatest = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (skipWhileStreaming && isCoworkerStreaming) {
        return;
      }
      const result = await listChannelMessagesAction(channelId);
      if (cancelled || !result.ok) {
        return;
      }
      setMessagesState((current) =>
        mergeChannelMessages(current, result.data.messages),
      );
      setThreadParentMessage((current) =>
        current
          ? (result.data.messages.find(
              (message) => message.id === current.id,
            ) ?? current)
          : current,
      );
    };

    const intervalId = window.setInterval(refreshLatest, CHANNEL_LIVE_POLL_MS);
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
  }, [selectedChannel?.id, isCoworkerStreaming]);

  useEffect(() => {
    if (
      !selectedChannel ||
      !threadParentMessage ||
      !hasPendingThreadCoworkerMention
    ) {
      return;
    }

    const channelId = selectedChannel.id;
    const parentMessageId = threadParentMessage.id;
    let cancelled = false;
    let timeoutId: number | undefined;

    let threadAttempts = 0;

    const pollThreadMessages = async () => {
      // Same gating as the channel poll above.
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
      const [threadResult, channelResult] = await Promise.all([
        listThreadMessagesAction(channelId, parentMessageId),
        listChannelMessagesAction(channelId),
      ]);
      if (cancelled) {
        return;
      }
      if (threadResult.ok) {
        setThreadMessages((current) =>
          mergeChannelMessages(current, threadResult.data.messages),
        );
      }
      if (channelResult.ok) {
        setMessagesState((current) =>
          mergeChannelMessages(current, channelResult.data.messages),
        );
        setThreadParentMessage((current) =>
          current
            ? (channelResult.data.messages.find(
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
    selectedChannel?.id,
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
    if (!selectedChannel) return;
    setThreadParentMessage(parentMessage);
    setThreadMessages([]);
    setThreadOlderNextCursor(null);
    startThreadLoadingTransition(async () => {
      const result = await listThreadMessagesAction(
        selectedChannel.id,
        parentMessage.id,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setThreadMessages(result.data.messages);
      setThreadOlderNextCursor(result.data.nextCursor);
    });
  }

  function handleLoadOlderMessages() {
    if (!selectedChannel || !olderNextCursor || isLoadingOlder) {
      return;
    }

    const channelId = selectedChannel.id;
    const cursor = olderNextCursor;
    startLoadingOlderTransition(async () => {
      const result = await listChannelMessagesAction(channelId, { cursor });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setMessagesState((current) =>
        mergeChannelMessages(current, result.data.messages),
      );
      setOlderNextCursor(result.data.nextCursor);
    });
  }

  function handleLoadOlderThreadMessages() {
    if (
      !selectedChannel ||
      !threadParentMessage ||
      !threadOlderNextCursor ||
      isLoadingOlderThread
    ) {
      return;
    }

    const channelId = selectedChannel.id;
    const parentMessageId = threadParentMessage.id;
    const cursor = threadOlderNextCursor;
    startLoadingOlderThreadTransition(async () => {
      const result = await listThreadMessagesAction(
        channelId,
        parentMessageId,
        {
          cursor,
        },
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setThreadMessages((current) =>
        mergeChannelMessages(current, result.data.messages),
      );
      setThreadOlderNextCursor(result.data.nextCursor);
    });
  }

  function handleToggleReaction(message: ChatRoomMessage, emoji: string) {
    if (!selectedChannel) return;
    // Guard the in-flight toggle: on a slow connection nothing changed
    // visibly, so users tapped again and the second call flipped the reaction
    // straight back off.
    const pendingKey = `${message.id}:${emoji}`;
    if (pendingReactionsRef.current.has(pendingKey)) return;
    pendingReactionsRef.current.add(pendingKey);
    startReactionTransition(async () => {
      const result = await toggleMessageReactionAction(
        selectedChannel.id,
        message.id,
        emoji,
      );
      pendingReactionsRef.current.delete(pendingKey);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      mergeUpdatedMessage(result.data);
    });
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChannel) return;
    const content = composerValue.trim();
    if (!content) return;

    if (isCoworkerOnlyDirectRoom(selectedChannel)) {
      setComposerValue("");
      setComposerAttachments([]);
      setMentionedCoworkerIds([]);
      sendStreamMessage(content);
      return;
    }

    startSendingTransition(async () => {
      const result = await sendChannelMessageAction(
        selectedChannel.id,
        content,
        mentionedCoworkerIds,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setMessagesState((current) => appendMessage(current, result.data));
      setComposerValue("");
      setComposerAttachments([]);
      setMentionedCoworkerIds([]);
    });
  }

  function handleSendThreadReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChannel || !threadParentMessage) return;
    const content = threadComposerValue.trim();
    if (!content) return;

    startSendingThreadReplyTransition(async () => {
      const result = await sendChannelMessageAction(
        selectedChannel.id,
        content,
        threadMentionedCoworkerIds,
        threadParentMessage.id,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      setThreadMessages((current) => [...current, result.data]);
      updateParentThreadPreview(threadParentMessage.id, result.data);
      setThreadComposerValue("");
      setThreadComposerAttachments([]);
      setThreadMentionedCoworkerIds([]);
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
            />
          ) : isNewDirectMessage ? (
            <DraftDirectMessage
              members={organizationMembers}
              coworkers={coworkers}
              currentUserId={currentUserId}
              canCreateRoomDirect={activeOrganization != null}
            />
          ) : selectedChannel ? (
            <>
              <header className="flex h-16 shrink-0  items-center justify-between gap-4 border-b px-6">
                <div className="flex min-w-0 items-center gap-2">
                  {isDirectChannel ? (
                    <MessageCircle className="text-muted-foreground size-4 shrink-0" />
                  ) : (
                    <Hash className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <p className="text-muted-foreground truncate text-sm">
                    {isDirectChannel
                      ? getDirectChannelSubtitle(
                          selectedChannel,
                          currentUserId,
                          {
                            fallback: activeOrganization?.name ?? "",
                            participantCountLabel: (count) =>
                              t("directParticipantCount", { count }),
                          },
                        )
                      : selectedChannelDisplayName}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ChannelParticipantStack channel={selectedChannel} />
                  {isDirectChannel ? null : (
                    <EditChannelDialog
                      channel={selectedChannel}
                      members={organizationMembers}
                      coworkers={coworkers}
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
                          onToggleReaction={handleToggleReaction}
                          onOpenThread={
                            isStreamOverlay ? undefined : loadThreadMessages
                          }
                          showThreadButton={!isStreamOverlay}
                        />
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>

              <ChannelComposer
                value={composerValue}
                onValueChange={setComposerValue}
                mentions={mentionRecords}
                onSelectedKeysChange={setMentionedCoworkerIds}
                placeholder={
                  isDirectChannel
                    ? t("directComposerPlaceholder", {
                        member: selectedChannelDisplayName,
                      })
                    : t("composerPlaceholderWithChannel", {
                        channel: selectedChannelDisplayName,
                      })
                }
                attachments={composerAttachments}
                onAttachmentsChange={setComposerAttachments}
                onSubmit={handleSend}
                isSending={isSending || isCoworkerStreaming}
                sendDisabled={composerValue.trim().length === 0}
                showMentionShortcut={shouldShowRoomMentionShortcut(
                  selectedChannel,
                )}
              />
            </>
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
        {selectedChannel && threadParentMessage ? (
          <ThreadPanel
            parentMessage={threadParentMessage}
            replies={threadMessages}
            isLoading={isThreadLoading}
            olderNextCursor={threadOlderNextCursor}
            isLoadingOlder={isLoadingOlderThread}
            onLoadOlder={handleLoadOlderThreadMessages}
            coworkersById={coworkersById}
            coworkersBySlug={coworkersBySlug}
            mentionRecords={mentionRecords}
            replyValue={threadComposerValue}
            onReplyValueChange={setThreadComposerValue}
            replyMentionedCoworkerIdsChange={setThreadMentionedCoworkerIds}
            replyAttachments={threadComposerAttachments}
            onReplyAttachmentsChange={setThreadComposerAttachments}
            onSubmitReply={handleSendThreadReply}
            isSendingReply={isSendingThreadReply}
            onClose={() => {
              setThreadParentMessage(null);
              setThreadMessages([]);
              setThreadOlderNextCursor(null);
            }}
            onToggleReaction={handleToggleReaction}
            showMentionShortcut={shouldShowRoomMentionShortcut(selectedChannel)}
          />
        ) : null}
      </main>
    </div>
  );
}
