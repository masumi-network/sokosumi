import type {
  ChatRoomMessage,
  ChatRoomMessageMention,
  ChatRoomMessageQuote,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import { ChatRoomMentionStatus } from "@/lib/clients/generated/core";

/** Local-only row id: `pending:{clientTurnId}`. Never a server message id. */
export const OUTBOUND_LOCAL_ID_PREFIX = "pending:" as const;

/**
 * How long the post-confirm check stays in the timestamp slot before
 * swapping to wall-clock time (includes fade). Only used on the slow path
 * (spinner already shown).
 */
export const OUTBOUND_SENT_TICK_MS = 1600;

/**
 * How long a pending shell keeps wall-clock chrome before showing the spinner.
 * Fast sends confirm before this and never show spinner/check (99% path).
 */
export const OUTBOUND_PENDING_SPINNER_DELAY_MS = 500;

/** Age of a pending shell in ms (clamped ≥ 0). */
export function outboundPendingAgeMs(
  createdAt: Date | string,
  nowMs: number = Date.now(),
): number {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) {
    return 0;
  }
  return Math.max(0, nowMs - created);
}

/**
 * True when pending has lasted long enough to show the spinner (bad-network
 * path). Before this, the timestamp slot keeps wall-clock time.
 */
export function shouldShowOutboundPendingSpinner(
  createdAt: Date | string,
  nowMs: number = Date.now(),
  delayMs: number = OUTBOUND_PENDING_SPINNER_DELAY_MS,
): boolean {
  return outboundPendingAgeMs(createdAt, nowMs) >= delayMs;
}

/**
 * True when confirm should flash the check — only if the spinner delay had
 * already elapsed (slow path). Fast confirms skip spinner and check.
 */
export function shouldFlashOutboundSentCheck(
  pendingCreatedAt: Date | string,
  nowMs: number = Date.now(),
  delayMs: number = OUTBOUND_PENDING_SPINNER_DELAY_MS,
): boolean {
  return shouldShowOutboundPendingSpinner(pendingCreatedAt, nowMs, delayMs);
}

/** Core + local metadata key for the client turn id. */
export const CLIENT_MESSAGE_ID_METADATA_KEY = "client_message_id" as const;

/** Sender-local outbound delivery status on a pending shell. */
export const OUTBOUND_DELIVERY_STATUS_METADATA_KEY =
  "outbound_delivery_status" as const;

/** Sender-local reason when an outbound shell failed to persist. */
export const OUTBOUND_ERROR_METADATA_KEY = "outbound_error" as const;

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

export function readOutboundErrorMessage(
  message: ChatRoomMessage,
): string | null {
  if (!isOutboundLocalMessage(message)) {
    return null;
  }
  const raw = message.metadata?.[OUTBOUND_ERROR_METADATA_KEY];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface CreatePendingRoomMessageParams {
  clientTurnId: string;
  roomId: string;
  content: string;
  senderUser: ChatRoomUserParticipant;
  parentMessageId?: string | null;
  quote?: ChatRoomMessageQuote;
  createdAt?: Date;
  /** Coworker ids mentioned on this send — shown as pending chips until confirm. */
  mentionedCoworkerIds?: readonly string[];
  /** Personal-assistant ids mentioned on this send. */
  mentionedSokoBotIds?: readonly string[];
}

/** Build provisional mention rows for a pending shell (no blink on confirm). */
export function buildPendingCoworkerMentions(
  clientTurnId: string,
  mentionedCoworkerIds: readonly string[],
  mentionedSokoBotIds: readonly string[] = [],
): ChatRoomMessageMention[] {
  return [
    ...mentionedCoworkerIds.map((coworkerId) => ({
      id: `pending-mention:${clientTurnId}:${coworkerId}`,
      coworkerId,
      sokoBotId: null,
      status: ChatRoomMentionStatus.PENDING,
      responseMessageId: null,
    })),
    ...mentionedSokoBotIds.map((sokoBotId) => ({
      id: `pending-mention:${clientTurnId}:sokoBot:${sokoBotId}`,
      coworkerId: null,
      sokoBotId,
      status: ChatRoomMentionStatus.PENDING,
      responseMessageId: null,
    })),
  ];
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
    mentions: buildPendingCoworkerMentions(
      clientTurnId,
      params.mentionedCoworkerIds ?? [],
      params.mentionedSokoBotIds ?? [],
    ),
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

/**
 * Replace a pending shell with the confirmed server message at the same index.
 * Prefer `knownClientTurnId` from the local job — do not rely only on response
 * metadata (DTO may omit client_message_id).
 */
export function confirmOutboundMessage(
  messages: readonly ChatRoomMessage[],
  confirmed: ChatRoomMessage,
  knownClientTurnId?: string,
): ChatRoomMessage[] {
  const turnId =
    (typeof knownClientTurnId === "string" && knownClientTurnId.trim()
      ? knownClientTurnId.trim()
      : null) ?? readClientTurnId(confirmed);
  const pendingId = turnId ? outboundLocalMessageId(turnId) : null;
  // Stamp turn id when Core/metadata omitted it so later Ably merge still dedupes.
  const confirmedRow: ChatRoomMessage =
    turnId != null && readClientTurnId(confirmed) == null
      ? {
          ...confirmed,
          metadata: {
            ...(confirmed.metadata ?? {}),
            [CLIENT_MESSAGE_ID_METADATA_KEY]: turnId,
          },
        }
      : confirmed;

  let replaced = false;
  const next: ChatRoomMessage[] = [];
  for (const message of messages) {
    if (pendingId != null && message.id === pendingId) {
      if (!replaced) {
        next.push(confirmedRow);
        replaced = true;
      }
      continue;
    }
    if (message.id === confirmedRow.id) {
      if (!replaced) {
        next.push(confirmedRow);
        replaced = true;
      }
      continue;
    }
    next.push(message);
  }

  if (!replaced) {
    next.push(confirmedRow);
  }
  return next;
}

function setOutboundDeliveryStatus(
  messages: readonly ChatRoomMessage[],
  clientTurnId: string,
  status: OutboundDeliveryStatus,
  errorMessage?: string,
): ChatRoomMessage[] {
  const pendingId = outboundLocalMessageId(clientTurnId);
  const trimmedError = errorMessage?.trim();
  return messages.map((message) => {
    if (message.id !== pendingId) {
      return message;
    }
    const nextMetadata: Record<string, unknown> = {
      ...(message.metadata ?? {}),
      [CLIENT_MESSAGE_ID_METADATA_KEY]: clientTurnId,
      [OUTBOUND_DELIVERY_STATUS_METADATA_KEY]: status,
    };
    if (status === "failed" && trimmedError) {
      nextMetadata[OUTBOUND_ERROR_METADATA_KEY] = trimmedError;
    } else {
      delete nextMetadata[OUTBOUND_ERROR_METADATA_KEY];
    }
    return {
      ...message,
      metadata: nextMetadata,
    };
  });
}

export function failOutboundMessage(
  messages: readonly ChatRoomMessage[],
  clientTurnId: string,
  errorMessage?: string,
): ChatRoomMessage[] {
  return setOutboundDeliveryStatus(
    messages,
    clientTurnId,
    "failed",
    errorMessage,
  );
}

export function markOutboundMessagePending(
  messages: readonly ChatRoomMessage[],
  clientTurnId: string,
): ChatRoomMessage[] {
  return setOutboundDeliveryStatus(messages, clientTurnId, "pending");
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

/**
 * Server message ids that just replaced a **pending** outbound shell
 * (previous → next). Used to flash the sent check in the same turn as the
 * shell swap so Ably-first confirm does not paint wall-clock before the tick
 * (spinner → check → time, never spinner → time → check).
 */
export function listJustConfirmedOutboundMessageIds(
  previous: readonly ChatRoomMessage[],
  next: readonly ChatRoomMessage[],
): string[] {
  const pendingTurnIds = new Set<string>();
  for (const message of previous) {
    if (!isOutboundLocalMessage(message)) {
      continue;
    }
    if (readOutboundDeliveryStatus(message) !== "pending") {
      continue;
    }
    const turnId = readClientTurnId(message);
    if (turnId != null) {
      pendingTurnIds.add(turnId);
    }
  }
  if (pendingTurnIds.size === 0) {
    return [];
  }

  const confirmedIds: string[] = [];
  const seen = new Set<string>();
  for (const message of next) {
    if (isOutboundLocalMessage(message)) {
      continue;
    }
    const turnId = readClientTurnId(message);
    if (turnId == null || !pendingTurnIds.has(turnId) || seen.has(message.id)) {
      continue;
    }
    seen.add(message.id);
    confirmedIds.push(message.id);
  }
  return confirmedIds;
}
