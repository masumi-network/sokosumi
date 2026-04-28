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
}): string | Array<{ type: string; text: string }> {
  const meta = item.metadata as {
    reasoning?: Array<{ type?: string; text?: string }>;
  } | null;

  const reasoningBlocks = (meta?.reasoning ?? [])
    .filter((r) => typeof r.text === "string" && r.text.trim().length > 0)
    .map((r) => ({
      type: r.type && r.type.trim() ? r.type.trim() : "reasoning",
      text: r.text!.trim(),
    }));

  const hasStructured =
    (item.contentType && item.contentType !== "") || reasoningBlocks.length > 0;

  if (!hasStructured) {
    return item.contentText;
  }

  const parts: Array<{ type: string; text: string }> = [...reasoningBlocks];
  if (item.contentType && item.contentType !== "") {
    parts.push({ type: item.contentType, text: item.contentText });
  } else if (item.contentText) {
    parts.push({ type: "text", text: item.contentText });
  }
  return parts;
}
