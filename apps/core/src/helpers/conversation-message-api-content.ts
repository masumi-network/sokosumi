import {
  buildConversationContentParts,
  readPersistedUiPartsFromMetadata,
  readReasoningPartsFromMetadata,
} from "@/helpers/message-content";

function readEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Reads persisted `metadata.thought_timing_ms` for API clients. */
export function thoughtTimingFromMessageMetadata(metadata: unknown):
  | {
      startedAtMs: number;
      endedAtMs: number;
    }
  | undefined {
  const meta = metadata as {
    thought_timing_ms?: { start?: unknown; end?: unknown };
  } | null;
  const t = meta?.thought_timing_ms;
  if (!t) {
    return undefined;
  }
  const start = readEpochMs(t.start);
  const end = readEpochMs(t.end);
  if (start != null && end != null && end >= start) {
    return { startedAtMs: start, endedAtMs: end };
  }
  return undefined;
}

/** Builds paginated message `content`; reasoning entries precede final assistant text. */
export function conversationMessageToApiContent(item: {
  contentType: string | null;
  contentText: string;
  metadata: unknown;
}):
  | string
  | Array<{
      type: string;
      text?: string;
      url?: string;
      mediaType?: string;
      filename?: string;
    }> {
  const reasoningParts = readReasoningPartsFromMetadata(item.metadata);
  const persistedUiParts = readPersistedUiPartsFromMetadata(item.metadata);

  const hasStructured =
    (item.contentType && item.contentType !== "") ||
    reasoningParts.length > 0 ||
    persistedUiParts.length > 0;

  if (!hasStructured) {
    return item.contentText;
  }

  const parts = buildConversationContentParts({
    contentText: item.contentText,
    metadata: item.metadata,
    fallbackPrimaryContentType: item.contentType,
  });

  return parts;
}
