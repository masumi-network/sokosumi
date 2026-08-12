import type {
  ChatRoomMessage,
  ChatRoomMessageQuote,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";

/** Local-only row id: `pending:{clientTurnId}`. Never a server message id. */
export const OUTBOUND_LOCAL_ID_PREFIX = "pending:" as const;

/** How long the post-confirm single tick stays before unmount (includes fade). */
export const OUTBOUND_SENT_TICK_MS = 2000;

/** Core + local metadata key for the client turn id. */
export const CLIENT_MESSAGE_ID_METADATA_KEY = "client_message_id" as const;

/** Sender-local outbound delivery status on a pending shell. */
export const OUTBOUND_DELIVERY_STATUS_METADATA_KEY =
  "outbound_delivery_status" as const;

export type OutboundDeliveryStatus = "pending" | "failed";

export function outboundLocalMessageId(clientTurnId: string): string {
  return `${OUTBOUND_LOCAL_ID_PREFIX}${clientTurnId}`;
}

export function isOutboundLocalMessage(message: ChatRoomMessage): boolean {
  return message.id.startsWith(OUTBOUND_LOCAL_ID_PREFIX);
}

export function readClientTurnId(message: ChatRoomMessage): string | null {
  if (isOutboundLocalMessage(message)) {
    const fromId = message.id.slice(OUTBOUND_LOCAL_ID_PREFIX.length).trim();
    return fromId.length > 0 ? fromId : null;
  }
  const raw = message.metadata?.[CLIENT_MESSAGE_ID_METADATA_KEY];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readOutboundDeliveryStatus(
  message: ChatRoomMessage,
): OutboundDeliveryStatus | null {
  if (!isOutboundLocalMessage(message)) {
    return null;
  }
  const raw = message.metadata?.[OUTBOUND_DELIVERY_STATUS_METADATA_KEY];
  if (raw === "pending" || raw === "failed") {
    return raw;
  }
  return "pending";
}

export interface CreatePendingRoomMessageParams {
  clientTurnId: string;
  roomId: string;
  content: string;
  senderUser: ChatRoomUserParticipant;
  parentMessageId?: string | null;
  quote?: ChatRoomMessageQuote;
  createdAt?: Date;
}

export function createPendingRoomMessage(
  params: CreatePendingRoomMessageParams,
): ChatRoomMessage {
  const clientTurnId = params.clientTurnId.trim();
  return {
    id: outboundLocalMessageId(clientTurnId),
    roomId: params.roomId,
    parentMessageId: params.parentMessageId ?? null,
    content: params.content,
    createdAt: params.createdAt ?? new Date(),
    deletedAt: null,
    editedAt: null,
    sender: {
      type: "user",
      user: params.senderUser,
    },
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: {
      [CLIENT_MESSAGE_ID_METADATA_KEY]: clientTurnId,
      [OUTBOUND_DELIVERY_STATUS_METADATA_KEY]: "pending",
    },
    quote: params.quote ?? null,
    membership: null,
    unfurls: null,
  };
}

/** Replace a pending shell with the confirmed server message at the same index. */
export function confirmOutboundMessage(
  messages: readonly ChatRoomMessage[],
  confirmed: ChatRoomMessage,
): ChatRoomMessage[] {
  const turnId = readClientTurnId(confirmed);
  const pendingId = turnId ? outboundLocalMessageId(turnId) : null;

  let replaced = false;
  const next: ChatRoomMessage[] = [];
  for (const message of messages) {
    if (pendingId != null && message.id === pendingId) {
      if (!replaced) {
        next.push(confirmed);
        replaced = true;
      }
      continue;
    }
    if (message.id === confirmed.id) {
      if (!replaced) {
        next.push(confirmed);
        replaced = true;
      }
      continue;
    }
    next.push(message);
  }

  if (!replaced) {
    next.push(confirmed);
  }
  return next;
}

export function failOutboundMessage(
  messages: readonly ChatRoomMessage[],
  clientTurnId: string,
): ChatRoomMessage[] {
  const pendingId = outboundLocalMessageId(clientTurnId);
  return messages.map((message) => {
    if (message.id !== pendingId) {
      return message;
    }
    return {
      ...message,
      metadata: {
        ...(message.metadata ?? {}),
        [CLIENT_MESSAGE_ID_METADATA_KEY]: clientTurnId,
        [OUTBOUND_DELIVERY_STATUS_METADATA_KEY]: "failed",
      },
    };
  });
}

export function markOutboundMessagePending(
  messages: readonly ChatRoomMessage[],
  clientTurnId: string,
): ChatRoomMessage[] {
  const pendingId = outboundLocalMessageId(clientTurnId);
  return messages.map((message) => {
    if (message.id !== pendingId) {
      return message;
    }
    return {
      ...message,
      metadata: {
        ...(message.metadata ?? {}),
        [CLIENT_MESSAGE_ID_METADATA_KEY]: clientTurnId,
        [OUTBOUND_DELIVERY_STATUS_METADATA_KEY]: "pending",
      },
    };
  });
}

export function removeOutboundMessage(
  messages: readonly ChatRoomMessage[],
  clientTurnId: string,
): ChatRoomMessage[] {
  const pendingId = outboundLocalMessageId(clientTurnId);
  return messages.filter((message) => message.id !== pendingId);
}

/**
 * When merging pages/realtime into a list that may hold local pending shells:
 * confirm matching client turn ids in place, merge confirmed rows, keep
 * unresolved pending shells after the confirmed block (frozen near the end).
 */
export function partitionOutboundForMerge(
  existing: readonly ChatRoomMessage[],
): {
  confirmed: ChatRoomMessage[];
  outbound: ChatRoomMessage[];
} {
  const confirmed: ChatRoomMessage[] = [];
  const outbound: ChatRoomMessage[] = [];
  for (const message of existing) {
    if (isOutboundLocalMessage(message)) {
      outbound.push(message);
    } else {
      confirmed.push(message);
    }
  }
  return { confirmed, outbound };
}

/** Drop outbound shells whose client turn id appears on an incoming confirmed row. */
export function filterResolvedOutbound(
  outbound: readonly ChatRoomMessage[],
  incoming: readonly ChatRoomMessage[],
): ChatRoomMessage[] {
  const confirmedTurnIds = new Set<string>();
  for (const message of incoming) {
    if (isOutboundLocalMessage(message)) {
      continue;
    }
    const turnId = readClientTurnId(message);
    if (turnId) {
      confirmedTurnIds.add(turnId);
    }
  }
  if (confirmedTurnIds.size === 0) {
    return [...outbound];
  }
  return outbound.filter((message) => {
    const turnId = readClientTurnId(message);
    return turnId == null || !confirmedTurnIds.has(turnId);
  });
}
