"use client";

import { useChat } from "@ai-sdk/react";
import type {
  ChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@sokosumi/core-client";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CHAT_API_PATH } from "@/app/chat/utils/chat-route-base";
import { reasoningStepsForMetadata } from "@/app/chat/utils/coworker-thought";
import { extractMessageContent } from "@/app/chat/utils/message-utils";
import {
  CLIENT_MESSAGE_ID_METADATA_KEY,
  OUTBOUND_DELIVERY_STATUS_METADATA_KEY,
  OUTBOUND_ERROR_METADATA_KEY,
  outboundLocalMessageId,
} from "@/app/chat/utils/outbound-room-message";
import { clearPendingRoomMessage } from "@/app/chat/utils/pending-room-message";
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
    pinnedAt: null,
    sender: { type: "coworker", coworker },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: { streaming: true },
    quote: null,
    membership: null,
    groupNameChange: null,
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
      pinnedAt: null,
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
      groupNameChange: null,
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
    pinnedAt: null,
    sender: coworker ? { type: "coworker", coworker } : { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: assistantMetadata,
    quote: null,
    membership: null,
    groupNameChange: null,
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

export interface CoworkerStreamSendFile {
  url: string;
  fileName: string;
  mediaType: string | null;
}

export interface CoworkerStreamSendOptions {
  parentMessageId?: string;
  /** Same-room quote target; does not set parentMessageId. */
  quote?: { messageId: string };
  /** Composer attachments; sent as AI SDK file parts so the model sees them. */
  files?: readonly CoworkerStreamSendFile[];
}

/**
 * Attachments become `file` UI parts next to the text. The markdown link is
 * still in the text for the persisted room message; the part is what lets the
 * coworker model look at the file. Drive picks carry no media type and stay
 * link-only.
 */
export function toCoworkerStreamFileParts(
  files: readonly CoworkerStreamSendFile[] | undefined,
): FileUIPart[] {
  return (files ?? []).flatMap((file) =>
    file.mediaType
      ? [
          {
            type: "file" as const,
            url: file.url,
            mediaType: file.mediaType,
            filename: file.fileName,
          },
        ]
      : [],
  );
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

/**
 * The AI SDK puts a failed response's raw body in `error.message`, so a Core
 * refusal arrives as `{"error":"Forbidden","message":"…","meta":{…}}`. Show
 * the sentence inside it, not the JSON.
 */
export function coworkerStreamErrorMessage(error: Error): string | null {
  try {
    const body: unknown = JSON.parse(error.message);
    if (body && typeof body === "object") {
      const { message, error: title } = body as Record<string, unknown>;
      if (typeof message === "string" && message) return message;
      if (typeof title === "string" && title) return title;
    }
  } catch {
    // Not JSON: already a plain sentence (or empty).
  }
  return error.message || null;
}

/**
 * After a failed turn: cut any partial reply and show the user's message as a
 * failed outbound row (reason + Retry). Core may already have saved it, so the
 * row states the reason, not "not sent". Its UI message id is the Core
 * `client_message_id`, so Retry resends it without a second saved row, and
 * `mergeMessagesWithStreamOverlay` moves the mark onto that saved row.
 */
export function markFailedCoworkerTurn(
  rows: ChatRoomMessage[],
  reason: string,
): ChatRoomMessage[] {
  const userIndex = rows.findLastIndex((row) => row.sender.type === "user");
  const user = rows[userIndex];
  if (!user) {
    return rows;
  }
  const clientTurnId = user.id.replace(/^stream:/, "");
  return [
    ...rows.slice(0, userIndex),
    {
      ...user,
      id: outboundLocalMessageId(clientTurnId),
      metadata: {
        [CLIENT_MESSAGE_ID_METADATA_KEY]: clientTurnId,
        [OUTBOUND_DELIVERY_STATUS_METADATA_KEY]: "failed",
        [OUTBOUND_ERROR_METADATA_KEY]: reason,
      },
    },
  ];
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
  /** Resend the failed turn (same message id and attachments). */
  retryFailedStreamMessage: () => void;
}

export function useCoworkerDirectRoomStream({
  room,
  enabled,
  currentUserId,
  organizationSlug,
  onStreamSettled,
}: UseCoworkerDirectRoomStreamParams): UseCoworkerDirectRoomStreamResult {
  const t = useTranslations("App.Channels");
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
  /** Failed turn shown on its message until Retry, a new send or leaving. */
  const [failure, setFailure] = useState<{
    roomId: string;
    reason: string;
  } | null>(null);
  // Sync copy so a double-click Retry starts one request, not two.
  const failureRef = useRef(failure);
  failureRef.current = failure;
  /** Body of the last send, so Retry keeps its thread parent and quote. */
  const lastSendOptionsRef =
    useRef<ReturnType<typeof buildCoworkerStreamSendMessageOptions>>(undefined);

  // Restore thread parent for mid-stream resume (sessionStorage survives remount).
  useEffect(() => {
    setFailure(null);
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

  const {
    messages,
    sendMessage,
    regenerate,
    status,
    setMessages,
    resumeStream,
  } = useChat({
    id: roomId ?? "coworker-direct-idle",
    // Drive resume ourselves keyed on roomId — AI SDK's `resume` effect only
    // re-fires when the boolean flips, so room A→B would skip reconnect.
    resume: false,
    transport,
    onError(error) {
      const failedRoomId = roomIdRef.current;
      const reason = coworkerStreamErrorMessage(error) ?? t("Outbound.noReply");
      if (failedRoomId) {
        autoStreamStartedRoomIds.delete(failedRoomId);
        writeStoredStreamParentMessageId(failedRoomId, null);
        // Keep streamParentMessageId: the failed reply stays in its thread.
        setFailure({ roomId: failedRoomId, reason });
      }
      toast.error(reason);
    },
    async onFinish({ isError }) {
      const settledRoomId = roomIdRef.current;
      if (!settledRoomId) {
        return;
      }
      autoStreamStartedRoomIds.delete(settledRoomId);
      if (isError) {
        // Refresh only: the failed overlay row stays until Retry or the next
        // send. If Core saved the message, the merge marks that saved row
        // (matched by client_message_id) instead, keeping its quote.
        await onStreamSettledRef.current(settledRoomId);
        return;
      }
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
    const rows = messages
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
    return failure?.roomId === roomId && status === "error"
      ? markFailedCoworkerTurn(rows, failure.reason)
      : rows;
  }, [
    enabled,
    roomId,
    messages,
    currentUser,
    coworker,
    status,
    streamParentMessageId,
    failure,
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
      setFailure(null);
      setStreamParentMessageId(parentMessageId);
      writeStoredStreamParentMessageId(roomId, parentMessageId);
      const files = toCoworkerStreamFileParts(options?.files);
      lastSendOptionsRef.current =
        buildCoworkerStreamSendMessageOptions(options);
      void sendMessage(
        files.length > 0 ? { text: trimmed, files } : { text: trimmed },
        lastSendOptionsRef.current,
      );
      return true;
    },
    [enabled, roomId, sendMessage, setMessages],
  );

  const retryFailedStreamMessage = useCallback(() => {
    if (!roomId || failureRef.current?.roomId !== roomId) {
      return;
    }
    failureRef.current = null;
    setFailure(null);
    writeStoredStreamParentMessageId(roomId, streamParentMessageId);
    // Same last user message (id, text, files): Core dedupes it by
    // client_message_id and its room lock refuses a second live turn.
    void regenerate(lastSendOptionsRef.current);
  }, [regenerate, roomId, streamParentMessageId]);

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
    retryFailedStreamMessage,
  };
}
