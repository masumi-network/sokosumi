import type { UIMessage } from "ai";

import { fetchConversationUiMessages } from "@/app/chat-ui/utils/fetch-conversation-ui-messages";
import {
  COWORKER_AGENT_ERROR_SNIPPET,
  extractMessageContent,
  shouldReplaceSlotMessagesWithDb,
} from "@/app/chat-ui/utils/message-utils";

const DEFAULT_SYNC_TIMEOUT_MS = 120_000;
const INITIAL_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 8_000;
const MIN_GOOD_ASSISTANT_TAIL_CHARS = 20;

const syncGenerationByConversation = new Map<string, number>();

export function cancelCoworkerDbSync(conversationId: string): number {
  const next = (syncGenerationByConversation.get(conversationId) ?? 0) + 1;
  syncGenerationByConversation.set(conversationId, next);
  return next;
}

function beginCoworkerDbSync(conversationId: string): number {
  return cancelCoworkerDbSync(conversationId);
}

function isCoworkerDbSyncStale(
  conversationId: string,
  generation: number,
): boolean {
  return (syncGenerationByConversation.get(conversationId) ?? 0) !== generation;
}

function readAssistantTailText(messages: UIMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return "";
  }
  return extractMessageContent(last).trim();
}

export function isSuspiciouslyShortCoworkerAssistantTail(
  messages: UIMessage[],
): boolean {
  const text = readAssistantTailText(messages);
  return (
    text.length > 0 &&
    text.length < MIN_GOOD_ASSISTANT_TAIL_CHARS &&
    !text.includes(COWORKER_AGENT_ERROR_SNIPPET)
  );
}

export function hasGoodCoworkerAssistantTail(messages: UIMessage[]): boolean {
  const text = readAssistantTailText(messages);
  return (
    text.length >= MIN_GOOD_ASSISTANT_TAIL_CHARS &&
    !text.includes(COWORKER_AGENT_ERROR_SNIPPET)
  );
}

export function isStaleCoworkerAssistantTail(messages: UIMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return false;
  }
  const text = readAssistantTailText(messages);
  if (!text) {
    return true;
  }
  return text.includes(COWORKER_AGENT_ERROR_SNIPPET);
}

function readAssistantTailLength(messages: UIMessage[]): number {
  const text = readAssistantTailText(messages);
  if (!text) {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") {
      return -1;
    }
    return 0;
  }
  return text.length;
}

export function shouldRejectCoworkerMessageRegression(
  prevMessages: UIMessage[],
  nextMessages: UIMessage[],
): boolean {
  if (prevMessages.length === 0 || nextMessages.length === 0) {
    return false;
  }

  const prevStale = isStaleCoworkerAssistantTail(prevMessages);
  const prevSuspicious = isSuspiciouslyShortCoworkerAssistantTail(prevMessages);
  const prevGood = hasGoodCoworkerAssistantTail(prevMessages);
  const nextGood = hasGoodCoworkerAssistantTail(nextMessages);
  const prevTail = readAssistantTailLength(prevMessages);
  const nextTail = readAssistantTailLength(nextMessages);

  if (
    (prevStale ||
      prevSuspicious ||
      (prevTail >= 0 && prevTail < MIN_GOOD_ASSISTANT_TAIL_CHARS)) &&
    (nextGood ||
      (nextTail > prevTail && nextTail >= MIN_GOOD_ASSISTANT_TAIL_CHARS))
  ) {
    return false;
  }

  if (nextMessages.length + 1 < prevMessages.length) {
    return true;
  }
  if (prevGood && !nextGood && nextMessages.length <= prevMessages.length) {
    return true;
  }
  if (
    prevTail > 20 &&
    nextTail >= 0 &&
    nextTail < prevTail / 2 &&
    nextMessages.length <= prevMessages.length
  ) {
    return true;
  }
  return false;
}

export function shouldKeepPollingCoworkerDbSync(
  slotMessages: UIMessage[],
  dbMessages: UIMessage[] | null,
): boolean {
  if (isStaleCoworkerAssistantTail(slotMessages)) {
    return true;
  }
  if (isSuspiciouslyShortCoworkerAssistantTail(slotMessages)) {
    return true;
  }
  if (!hasGoodCoworkerAssistantTail(slotMessages)) {
    const last = slotMessages[slotMessages.length - 1];
    if (last?.role === "assistant") {
      return true;
    }
  }
  if (!dbMessages || dbMessages.length === 0) {
    return true;
  }
  const dbLast = dbMessages[dbMessages.length - 1];
  const slotLast = slotMessages[slotMessages.length - 1];
  if (slotLast?.role === "assistant" && dbLast?.role === "user") {
    return true;
  }
  return shouldReplaceSlotMessagesWithDb(slotMessages, dbMessages);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface SyncCoworkerSlotFromDbResult {
  applied: boolean;
  attempts: number;
  cancelled?: boolean;
}

function readLiveSlotMessages(
  slotMessages: UIMessage[],
  getLiveSlotMessages?: () => UIMessage[],
): UIMessage[] {
  const live = getLiveSlotMessages?.();
  if (!live || live.length === 0) {
    return slotMessages;
  }
  const liveTail = readAssistantTailLength(live);
  const snapshotTail = readAssistantTailLength(slotMessages);
  if (
    snapshotTail > liveTail &&
    (liveTail <= 0 || isStaleCoworkerAssistantTail(live))
  ) {
    return slotMessages;
  }
  return live;
}

export async function syncCoworkerSlotFromDbWithRetry(options: {
  conversationId: string;
  slotMessages: UIMessage[];
  getLiveSlotMessages?: () => UIMessage[];
  onApply: (messages: UIMessage[]) => void;
  timeoutMs?: number;
}): Promise<SyncCoworkerSlotFromDbResult> {
  const generation = beginCoworkerDbSync(options.conversationId);
  const timeoutMs = options.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
  const startedAt = Date.now();
  let attempts = 0;
  let backoffMs = INITIAL_BACKOFF_MS;

  while (Date.now() - startedAt < timeoutMs) {
    if (isCoworkerDbSyncStale(options.conversationId, generation)) {
      return { applied: false, attempts, cancelled: true };
    }

    attempts += 1;
    const liveSlot = readLiveSlotMessages(
      options.slotMessages,
      options.getLiveSlotMessages,
    );
    const dbMessages = await fetchConversationUiMessages(
      options.conversationId,
    );

    if (isCoworkerDbSyncStale(options.conversationId, generation)) {
      return { applied: false, attempts, cancelled: true };
    }

    // #region agent log
    fetch("http://127.0.0.1:7541/ingest/8edb227b-ad2a-46cf-bc16-6d4896cf7788", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "94182f",
      },
      body: JSON.stringify({
        sessionId: "94182f",
        runId: "db-sync-retry",
        hypothesisId: "RACE",
        location: "sync-coworker-slot-from-db.ts:poll",
        message: "coworker db sync poll attempt",
        data: {
          conversationId: options.conversationId,
          generation,
          attempt: attempts,
          liveTailLength: extractMessageContent(
            liveSlot[liveSlot.length - 1] ?? {},
          ).trim().length,
          finishedTailLength: extractMessageContent(
            options.slotMessages[options.slotMessages.length - 1] ?? {},
          ).trim().length,
          dbTailLength: extractMessageContent(
            dbMessages?.[dbMessages.length - 1] ?? {},
          ).trim().length,
          liveStale: isStaleCoworkerAssistantTail(liveSlot),
          liveGood: hasGoodCoworkerAssistantTail(liveSlot),
          dbGood: dbMessages ? hasGoodCoworkerAssistantTail(dbMessages) : false,
          keepPolling: shouldKeepPollingCoworkerDbSync(liveSlot, dbMessages),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    if (dbMessages && dbMessages.length > 0) {
      const dbGood = hasGoodCoworkerAssistantTail(dbMessages);
      const shouldReplace = shouldReplaceSlotMessagesWithDb(
        liveSlot,
        dbMessages,
      );

      if (
        dbGood &&
        (shouldReplace ||
          isStaleCoworkerAssistantTail(liveSlot) ||
          !hasGoodCoworkerAssistantTail(liveSlot))
      ) {
        options.onApply(dbMessages);
        return { applied: true, attempts };
      }

      if (!shouldKeepPollingCoworkerDbSync(liveSlot, dbMessages)) {
        return { applied: false, attempts };
      }
    }

    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      break;
    }

    await sleepMs(Math.min(backoffMs, remaining));
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  return { applied: false, attempts };
}
