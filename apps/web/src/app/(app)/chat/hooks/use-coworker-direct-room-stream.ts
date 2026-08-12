"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CHAT_API_PATH } from "@/app/chat/utils/chat-route-base";
import { reasoningStepsForMetadata } from "@/app/chat/utils/coworker-thought";
import { extractMessageContent } from "@/app/chat/utils/message-utils";
import { clearPendingRoomMessage } from "@/app/chat/utils/pending-room-message";
import type {
  ChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { fireGTMEvent } from "@/lib/gtm-events";

const CHAT_NO_RESUMABLE_STREAM_PATH = "/api/chat/no-resumable-stream";

/** Survives React Strict Mode remount so draft auto-stream fires once per room. */
const autoStreamStartedRoomIds = new Set<string>();

/** Empty coworker shell shown while resume SSE is active but messages empty. */
export const RESUME_PENDING_STREAM_MESSAGE_ID = "stream:resume-pending";

/**
 * First-seen wall clock for a stream overlay message id. Reuses the stored
 * value so elapsed timers do not reset when the overlay useMemo reruns on
 * each stream chunk.
 */
export function assignStableOverlayCreatedAtMs(
  map: Map<string, number>,
  key: string,
  indexHint: number,
  nowMs: number = Date.now(),
): number {
  const existing = map.get(key);
  if (existing != null) {
    return existing;
  }
  let ms = nowMs + indexHint;
  for (const value of map.values()) {
    if (value >= ms) {
      ms = value + 1;
    }
  }
  map.set(key, ms);
  return ms;
}

function streamParentStorageKey(roomId: string): string {
  return `sokosumi:room-stream-parent:${roomId}`;
}

export function readStoredStreamParentMessageId(roomId: string): string | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  try {
    const value = sessionStorage.getItem(streamParentStorageKey(roomId));
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function writeStoredStreamParentMessageId(
  roomId: string,
  parentMessageId: string | null,
): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    const key = streamParentStorageKey(roomId);
    if (parentMessageId) {
      sessionStorage.setItem(key, parentMessageId);
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Private mode / quota — overlay parent may be wrong on resume only.
  }
}

/**
 * Show resume-pending shell only for `streaming` (active SSE), not `submitted`.
 * Idle room enter gets 204 while status is briefly `submitted` — shell would flash.
 */
export function shouldShowResumePendingCoworkerShell({
  messagesEmpty,
  status,
  hasCoworker,
}: {
  messagesEmpty: boolean;
  status: string;
  hasCoworker: boolean;
}): boolean {
  return messagesEmpty && status === "streaming" && hasCoworker;
}

export function createResumePendingCoworkerShell({
  roomId,
  coworker,
  createdAt = new Date(),
  parentMessageId = null,
}: {
  roomId: string;
  coworker: ChatRoomCoworkerParticipant;
  createdAt?: Date;
  parentMessageId?: string | null;
}): ChatRoomMessage {
  return {
    id: RESUME_PENDING_STREAM_MESSAGE_ID,
    roomId,
    parentMessageId,
    content: "",
    createdAt,
    editedAt: null,
    sender: { type: "coworker", coworker },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: { streaming: true },
    quote: null,
    membership: null,
    unfurls: null,
    deletedAt: null,
  };
}

function uiMessageToTransientRoomMessage({
  message,
  roomId,
  currentUser,
  coworker,
  createdAt,
  parentMessageId,
}: {
  message: UIMessage;
  roomId: string;
  currentUser: ChatRoomUserParticipant | null;
  coworker: ChatRoomCoworkerParticipant | null;
  /** Monotonic clock — must preserve useChat array order across equal ms. */
  createdAt: Date;
  parentMessageId: string | null;
}): ChatRoomMessage {
  const content = extractMessageContent(message);
  const reasoningSteps =
    message.role === "assistant"
      ? reasoningStepsForMetadata(message.parts)
      : undefined;
  const assistantMetadata: Record<string, unknown> = {
    streaming: true,
    ...(reasoningSteps ? { reasoning: reasoningSteps } : {}),
  };

  if (message.role === "user") {
    return {
      id: `stream:${message.id}`,
      roomId,
      parentMessageId,
      content,
      createdAt,
      editedAt: null,
      sender: currentUser
        ? { type: "user", user: currentUser }
        : { type: "unknown" },
      mentions: [],
      reactions: [],
      threadReplyCount: 0,
      threadLastReplyAt: null,
      metadata: { streaming: true },
      quote: null,
      membership: null,
      unfurls: null,
      deletedAt: null,
    };
  }

  return {
    id: `stream:${message.id}`,
    roomId,
    parentMessageId,
    content,
    createdAt,
    editedAt: null,
    sender: coworker ? { type: "coworker", coworker } : { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: assistantMetadata,
    quote: null,
    membership: null,
    unfurls: null,
    deletedAt: null,
  };
}

export interface UseCoworkerDirectRoomStreamParams {
  room: ChatRoom | null;
  enabled: boolean;
  currentUserId: string;
  organizationSlug: string | null;
  /** Return true when persisted messages are merged; overlay clears only then. */
  onStreamSettled: (roomId: string) => boolean | Promise<boolean>;
}

export interface CoworkerStreamSendOptions {
  parentMessageId?: string;
  /** Same-room quote target; does not set parentMessageId. */
  quote?: { messageId: string };
}

/**
 * Build AI SDK `sendMessage` options so optional `parentMessageId` and `quote`
 * share one request body (Core room stream OpenAPI).
 */
export function buildCoworkerStreamSendMessageOptions(
  options?: CoworkerStreamSendOptions,
):
  | { body: { parentMessageId?: string; quote?: { messageId: string } } }
  | undefined {
  const parentMessageId = options?.parentMessageId?.trim() || undefined;
  const quoteMessageId = options?.quote?.messageId?.trim() || undefined;
  if (!parentMessageId && !quoteMessageId) {
    return undefined;
  }
  return {
    body: {
      ...(parentMessageId ? { parentMessageId } : {}),
      ...(quoteMessageId ? { quote: { messageId: quoteMessageId } } : {}),
    },
  };
}

export interface UseCoworkerDirectRoomStreamResult {
  streamOverlayMessages: ChatRoomMessage[];
  isStreaming: boolean;
  /**
   * Parent id for an in-flight / resumed thread stream (null = top-level).
   * Rooms client opens the thread panel when this is set so overlays stay visible.
   */
  activeStreamParentMessageId: string | null;
  /**
   * Stream a top-level turn, or a thread reply when `parentMessageId` is set.
   * Optional `quote` snapshots another same-room message on the user persist.
   * Returns true when the turn actually started (enabled + room + non-empty text).
   */
  sendStreamMessage: (
    text: string,
    options?: CoworkerStreamSendOptions,
  ) => boolean;
  /** Consume a one-shot draft pending message for this room (Strict Mode safe). */
  consumePendingStreamMessage: (text: string) => void;
}

export function useCoworkerDirectRoomStream({
  room,
  enabled,
  currentUserId,
  organizationSlug,
  onStreamSettled,
}: UseCoworkerDirectRoomStreamParams): UseCoworkerDirectRoomStreamResult {
  const roomId = enabled && room ? room.id : null;
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  // Which room we have already fired a `message_start` for this mount.
  // Every room already counted this mount. A single ref held only the last
  // room, so switching A -> B -> A fired message_start for A twice.
  const messageStartFiredRoomsRef = useRef<Set<string>>(new Set());
  const organizationSlugRef = useRef(organizationSlug);
  organizationSlugRef.current = organizationSlug;
  const onStreamSettledRef = useRef(onStreamSettled);
  onStreamSettledRef.current = onStreamSettled;
  const [streamParentMessageId, setStreamParentMessageId] = useState<
    string | null
  >(null);
  /**
   * First-seen wall clock per useChat message id so overlay `createdAt` (and
   * thus live elapsed timers) do not reset on every stream chunk recompute.
   */
  const overlayCreatedAtByMessageIdRef = useRef(new Map<string, number>());

  // Restore thread parent for mid-stream resume (sessionStorage survives remount).
  useEffect(() => {
    if (!roomId) {
      setStreamParentMessageId(null);
      overlayCreatedAtByMessageIdRef.current.clear();
      return;
    }
    setStreamParentMessageId(readStoredStreamParentMessageId(roomId));
  }, [roomId]);

  useEffect(() => {
    if (!enabled) {
      overlayCreatedAtByMessageIdRef.current.clear();
    }
  }, [enabled]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: CHAT_API_PATH,
        credentials: "include",
        headers: () => {
          const slug = organizationSlugRef.current;
          return slug
            ? { "x-organization-slug": slug }
            : ({} as Record<string, string>);
        },
        prepareSendMessagesRequest({ messages, body }) {
          const id = roomIdRef.current;
          return {
            body: {
              ...(body ?? {}),
              roomId: id,
              id: id ?? undefined,
              messages,
            },
          };
        },
        prepareReconnectToStreamRequest({ id }) {
          const slug = organizationSlugRef.current;
          const headers = slug
            ? ({ "x-organization-slug": slug } as Record<string, string>)
            : undefined;
          const rid = (roomIdRef.current ?? id)?.trim() ?? "";
          if (!rid) {
            return {
              api: CHAT_NO_RESUMABLE_STREAM_PATH,
              credentials: "include" as RequestCredentials,
              headers,
            };
          }
          return {
            api: `/api/chat/${rid}/stream`,
            credentials: "include" as RequestCredentials,
            headers,
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, setMessages, resumeStream } = useChat({
    id: roomId ?? "coworker-direct-idle",
    // Drive resume ourselves keyed on roomId — AI SDK's `resume` effect only
    // re-fires when the boolean flips, so room A→B would skip reconnect.
    resume: false,
    transport,
    onError(error) {
      const failedRoomId = roomIdRef.current;
      if (failedRoomId) {
        autoStreamStartedRoomIds.delete(failedRoomId);
        writeStoredStreamParentMessageId(failedRoomId, null);
      }
      setStreamParentMessageId(null);
      toast.error(error.message || "Failed to stream coworker reply.");
    },
    async onFinish() {
      const settledRoomId = roomIdRef.current;
      if (!settledRoomId) {
        return;
      }
      autoStreamStartedRoomIds.delete(settledRoomId);
      // Keep stream overlay until persisted messages merge — clearing first
      // blanks the transcript for the await gap (or forever if refetch fails).
      const settled = await onStreamSettledRef.current(settledRoomId);
      if (settled && roomIdRef.current === settledRoomId) {
        clearPendingRoomMessage(settledRoomId);
        writeStoredStreamParentMessageId(settledRoomId, null);
        setMessages([]);
        setStreamParentMessageId(null);
      }
    },
  });

  const isStreaming = status === "submitted" || status === "streaming";

  // Leave: drop overlay. Enter: reconnect to Core active stream (Thinking…).
  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      return;
    }
    void resumeStream();
  }, [roomId, resumeStream, setMessages]);

  const currentUser = useMemo(() => {
    if (!room) {
      return null;
    }
    return (
      room.userMembers.find((member) => member.id === currentUserId) ??
      room.userMembers[0] ??
      null
    );
  }, [room, currentUserId]);

  const coworker = room?.coworkerMembers[0] ?? null;

  const streamOverlayMessages = useMemo(() => {
    if (!enabled || !roomId) {
      return [];
    }
    const createdAtById = overlayCreatedAtByMessageIdRef.current;
    function stableCreatedAt(key: string, indexHint: number): Date {
      return new Date(
        assignStableOverlayCreatedAtMs(createdAtById, key, indexHint),
      );
    }

    // Resume gap: only `streaming` (active SSE) before first chunk — not
    // `submitted` (idle enter / 204 would flash Thinking…).
    if (messages.length === 0) {
      if (
        coworker &&
        shouldShowResumePendingCoworkerShell({
          messagesEmpty: true,
          status,
          hasCoworker: true,
        })
      ) {
        return [
          createResumePendingCoworkerShell({
            roomId,
            coworker,
            createdAt: stableCreatedAt(RESUME_PENDING_STREAM_MESSAGE_ID, 0),
            parentMessageId: streamParentMessageId,
          }),
        ];
      }
      return [];
    }

    // Drop keys for messages no longer in the live stream (turn finished / replaced).
    const liveIds = new Set(
      messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => m.id),
    );
    for (const key of [...createdAtById.keys()]) {
      if (key === RESUME_PENDING_STREAM_MESSAGE_ID) {
        if (liveIds.size > 0) {
          createdAtById.delete(key);
        }
        continue;
      }
      if (!liveIds.has(key)) {
        createdAtById.delete(key);
      }
    }

    // Stable createdAt keeps elapsed timers from resetting on each chunk.
    // Keep empty assistant shells so the coworker avatar/name show while tokens
    // arrive (merge appends overlay in array order — user stays first).
    return messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map((message, index) =>
        uiMessageToTransientRoomMessage({
          message,
          roomId,
          currentUser,
          coworker,
          createdAt: stableCreatedAt(message.id, index),
          parentMessageId: streamParentMessageId,
        }),
      );
  }, [
    enabled,
    roomId,
    messages,
    currentUser,
    coworker,
    status,
    streamParentMessageId,
  ]);

  const sendStreamMessage = useCallback(
    (text: string, options?: CoworkerStreamSendOptions): boolean => {
      const trimmed = text.trim();
      if (!enabled || !roomId || !trimmed) {
        return false;
      }
      const parentMessageId = options?.parentMessageId?.trim() || null;
      // Analytics: a coworker DM was started. Fire once per room per mount so
      // "starting a conversation" is one event, not one per keystroke-send.
      if (!messageStartFiredRoomsRef.current.has(roomId)) {
        messageStartFiredRoomsRef.current.add(roomId);
        fireGTMEvent.messageStart(roomId);
      }
      // Shared useChat instance — clear leftover turns so a failed settle cannot
      // retag prior top-level UI messages with a new thread parentMessageId.
      setMessages([]);
      setStreamParentMessageId(parentMessageId);
      writeStoredStreamParentMessageId(roomId, parentMessageId);
      void sendMessage(
        { text: trimmed },
        buildCoworkerStreamSendMessageOptions(options),
      );
      return true;
    },
    [enabled, roomId, sendMessage, setMessages],
  );

  const consumePendingStreamMessage = useCallback(
    (text: string) => {
      if (!roomId) {
        return;
      }
      if (autoStreamStartedRoomIds.has(roomId)) {
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      // Mark before send so Strict Mode double-invoke cannot double-start.
      // Roll back if the stream hook declined the turn.
      autoStreamStartedRoomIds.add(roomId);
      if (!sendStreamMessage(trimmed)) {
        autoStreamStartedRoomIds.delete(roomId);
      }
    },
    [roomId, sendStreamMessage],
  );

  return {
    streamOverlayMessages,
    isStreaming,
    activeStreamParentMessageId: streamParentMessageId,
    sendStreamMessage,
    consumePendingStreamMessage,
  };
}
