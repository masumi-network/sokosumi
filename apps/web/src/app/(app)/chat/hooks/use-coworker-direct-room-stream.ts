"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CHAT_API_PATH } from "@/app/chat/utils/chat-route-base";
import { extractMessageContent } from "@/app/chat/utils/message-utils";
import { clearPendingRoomMessage } from "@/app/chat/utils/pending-room-message";
import type {
  ChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";

const CHAT_NO_RESUMABLE_STREAM_PATH = "/api/chat/no-resumable-stream";

/** Survives React Strict Mode remount so draft auto-stream fires once per room. */
const autoStreamStartedRoomIds = new Set<string>();

/** Empty coworker shell shown while resume SSE is active but messages empty. */
export const RESUME_PENDING_STREAM_MESSAGE_ID = "stream:resume-pending";

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
    sender: { type: "coworker", coworker },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: { streaming: true },
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

  if (message.role === "user") {
    return {
      id: `stream:${message.id}`,
      roomId,
      parentMessageId,
      content,
      createdAt,
      sender: currentUser
        ? { type: "user", user: currentUser }
        : { type: "unknown" },
      mentions: [],
      reactions: [],
      threadReplyCount: 0,
      threadLastReplyAt: null,
      metadata: { streaming: true },
    };
  }

  return {
    id: `stream:${message.id}`,
    roomId,
    parentMessageId,
    content,
    createdAt,
    sender: coworker ? { type: "coworker", coworker } : { type: "unknown" },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: { streaming: true },
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
   */
  sendStreamMessage: (
    text: string,
    options?: { parentMessageId?: string },
  ) => void;
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
  const organizationSlugRef = useRef(organizationSlug);
  organizationSlugRef.current = organizationSlug;
  const onStreamSettledRef = useRef(onStreamSettled);
  onStreamSettledRef.current = onStreamSettled;
  const [streamParentMessageId, setStreamParentMessageId] = useState<
    string | null
  >(null);

  // Restore thread parent for mid-stream resume (sessionStorage survives remount).
  useEffect(() => {
    if (!roomId) {
      setStreamParentMessageId(null);
      return;
    }
    setStreamParentMessageId(readStoredStreamParentMessageId(roomId));
  }, [roomId]);

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
    const baseMs = Date.now();
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
            createdAt: new Date(baseMs),
            parentMessageId: streamParentMessageId,
          }),
        ];
      }
      return [];
    }
    // Index-offset createdAt keeps useChat order when clocks share a ms.
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
          createdAt: new Date(baseMs + index),
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
    (text: string, options?: { parentMessageId?: string }) => {
      const trimmed = text.trim();
      if (!enabled || !roomId || !trimmed) {
        return;
      }
      const parentMessageId = options?.parentMessageId?.trim() || null;
      // Shared useChat instance — clear leftover turns so a failed settle cannot
      // retag prior top-level UI messages with a new thread parentMessageId.
      setMessages([]);
      setStreamParentMessageId(parentMessageId);
      writeStoredStreamParentMessageId(roomId, parentMessageId);
      void sendMessage(
        { text: trimmed },
        parentMessageId ? { body: { parentMessageId } } : undefined,
      );
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
      autoStreamStartedRoomIds.add(roomId);
      sendStreamMessage(trimmed);
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
