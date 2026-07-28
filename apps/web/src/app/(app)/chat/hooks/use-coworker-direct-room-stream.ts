"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { CHAT_API_PATH } from "@/app/chat-ui/utils/chat-route-base";
import { extractMessageContent } from "@/app/chat-ui/utils/message-utils";
import type {
  ChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";

const CHAT_NO_RESUMABLE_STREAM_PATH = "/api/chat/no-resumable-stream";

/** Survives React Strict Mode remount so draft auto-stream fires once per room. */
const autoStreamStartedRoomIds = new Set<string>();

function uiMessageToTransientRoomMessage({
  message,
  roomId,
  currentUser,
  coworker,
}: {
  message: UIMessage;
  roomId: string;
  currentUser: ChatRoomUserParticipant | null;
  coworker: ChatRoomCoworkerParticipant | null;
}): ChatRoomMessage {
  const content = extractMessageContent(message);
  const createdAt = new Date();

  if (message.role === "user") {
    return {
      id: `stream:${message.id}`,
      roomId,
      parentMessageId: null,
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
    parentMessageId: null,
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
  onStreamSettled: (roomId: string) => void | Promise<void>;
}

export interface UseCoworkerDirectRoomStreamResult {
  streamOverlayMessages: ChatRoomMessage[];
  isStreaming: boolean;
  sendStreamMessage: (text: string) => void;
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

  const { messages, sendMessage, status, setMessages } = useChat({
    id: roomId ?? "coworker-direct-idle",
    transport,
    onError(error) {
      const failedRoomId = roomIdRef.current;
      if (failedRoomId) {
        autoStreamStartedRoomIds.delete(failedRoomId);
      }
      toast.error(error.message || "Failed to stream coworker reply.");
    },
    async onFinish() {
      const settledRoomId = roomIdRef.current;
      setMessages([]);
      if (settledRoomId) {
        autoStreamStartedRoomIds.delete(settledRoomId);
        await onStreamSettledRef.current(settledRoomId);
      }
    },
  });

  // Drop in-flight overlay when leaving a coworker stream room.
  useEffect(() => {
    if (!enabled || !roomId) {
      setMessages([]);
    }
  }, [enabled, roomId, setMessages]);

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
    if (!enabled || !roomId || messages.length === 0) {
      return [];
    }
    return messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map((message) =>
        uiMessageToTransientRoomMessage({
          message,
          roomId,
          currentUser,
          coworker,
        }),
      );
  }, [enabled, roomId, messages, currentUser, coworker]);

  const isStreaming = status === "submitted" || status === "streaming";

  const sendStreamMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!enabled || !roomId || !trimmed) {
        return;
      }
      void sendMessage({ text: trimmed });
    },
    [enabled, roomId, sendMessage],
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
    sendStreamMessage,
    consumePendingStreamMessage,
  };
}
