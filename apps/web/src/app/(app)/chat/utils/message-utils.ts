import type { UIMessage } from "ai";

/**
 * Extract text content from a message in various formats (AI SDK v6, parts array, etc.)
 */
export function extractMessageContent(message: unknown): string {
  const messageAny = message as Record<string, unknown>;
  let content = "";

  // Try content property first
  if (
    "content" in messageAny &&
    messageAny.content !== undefined &&
    messageAny.content !== null
  ) {
    const msgContent = messageAny.content;
    if (typeof msgContent === "string") {
      content = msgContent;
    } else if (Array.isArray(msgContent)) {
      content = msgContent
        .map((part: unknown) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const partObj = part as Record<string, unknown>;
            if (
              "text" in partObj &&
              partObj.text !== null &&
              partObj.text !== undefined
            ) {
              return String(partObj.text);
            }
            if (
              "content" in partObj &&
              partObj.content !== null &&
              partObj.content !== undefined
            ) {
              return String(partObj.content);
            }
          }
          return "";
        })
        .filter(Boolean)
        .join("");
    } else {
      content = String(msgContent);
    }
  }

  // Try "parts" property (AI SDK v6 format)
  if (!content && "parts" in messageAny && Array.isArray(messageAny.parts)) {
    content = (messageAny.parts as unknown[])
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const partObj = part as Record<string, unknown>;
          if (
            "text" in partObj &&
            partObj.text !== null &&
            partObj.text !== undefined
          ) {
            return String(partObj.text);
          }
          if (
            "content" in partObj &&
            partObj.content !== null &&
            partObj.content !== undefined
          ) {
            return String(partObj.content);
          }
          // Try direct stringification if it's a simple object
          if (
            "type" in partObj &&
            partObj.type === "text" &&
            "text" in partObj
          ) {
            return String(partObj.text);
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  // Fallback: try "text" property directly
  if (
    !content &&
    "text" in messageAny &&
    messageAny.text !== undefined &&
    messageAny.text !== null
  ) {
    content = String(messageAny.text);
  }

  return content.trim();
}

/**
 * Deduplicate messages by id (first occurrence wins). Prevents duplicate display
 * when recovery or API returns the same item more than once.
 */
export function deduplicateMessagesById<T extends { id?: string }>(
  messages: T[],
): T[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    const id = m.id?.trim() ?? "";
    if (!id) {
      return true;
    }
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

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

/**
 * Convert Core conversation messages to UIMessage format
 */
function partsFromApiItemContent(
  content: Array<{ type: string; text?: string }> | string,
): UIMessage["parts"] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  const parts: UIMessage["parts"] = [];
  for (const c of content) {
    if (c.type === "reasoning") {
      parts.push({ type: "reasoning", text: c.text ?? "" });
      continue;
    }
    parts.push({ type: "text", text: c.text ?? "" });
  }
  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}

function visibleTextFromParts(parts: UIMessage["parts"]): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && "text" in p,
    )
    .map((p) => p.text)
    .join("");
}

export function convertItemsToMessages(
  conversationMessages: Array<{
    id: string;
    role: string;
    content: Array<{ type: string; text?: string }> | string;
    createdAt: number;
    thoughtTiming?: {
      startedAtMs: number | null;
      endedAtMs: number | null;
    };
  }>,
): UIMessage[] {
  return conversationMessages.map((message) => {
    const parts = partsFromApiItemContent(message.content);
    const visibleText = visibleTextFromParts(parts);

    const validRole: "assistant" | "user" | "system" =
      message.role === "assistant" ||
      message.role === "user" ||
      message.role === "system"
        ? (message.role as "assistant" | "user" | "system")
        : "user";

    const timing = message.thoughtTiming;
    const hasCompleteThoughtTiming =
      timing != null && timing.startedAtMs != null && timing.endedAtMs != null;

    return {
      id: message.id,
      role: validRole,
      parts,
      content: visibleText,
      createdAt: new Date(message.createdAt * 1000),
      ...(hasCompleteThoughtTiming
        ? {
            metadata: {
              thoughtStartedAtMs: timing.startedAtMs,
              thoughtEndedAtMs: timing.endedAtMs,
            },
          }
        : {}),
    };
  });
}
