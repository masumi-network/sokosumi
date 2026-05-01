import { convertItemsToMessages } from "@/lib/chat/conversation-api-to-ui-messages";

export {
  deduplicateMessagesById,
  extractMessageContent,
  getMessageFileParts,
  hasMessageTextOrFileParts,
  type MessageFilePart,
} from "@/app/chat-ui/utils/message-utils";
export { convertItemsToMessages };

function readEpochMsFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Persisted thought phase timestamps (ms since epoch) from assistant message metadata. */
export function getThoughtTimingMsFromMessage(message: unknown): {
  startedAtMs: number | null;
  endedAtMs: number | null;
} {
  const messageAny = message as Record<string, unknown>;
  const metadata = messageAny.metadata;
  if (!metadata || typeof metadata !== "object") {
    return { startedAtMs: null, endedAtMs: null };
  }
  const m = metadata as Record<string, unknown>;
  const nested = m.thought_timing_ms;
  let nestedStart: number | null = null;
  let nestedEnd: number | null = null;
  if (nested && typeof nested === "object") {
    const t = nested as Record<string, unknown>;
    nestedStart = readEpochMsFromUnknown(t.start);
    nestedEnd = readEpochMsFromUnknown(t.end);
  }
  const started = readEpochMsFromUnknown(m.thoughtStartedAtMs) ?? nestedStart;
  const ended = readEpochMsFromUnknown(m.thoughtEndedAtMs) ?? nestedEnd;
  return { startedAtMs: started, endedAtMs: ended };
}
