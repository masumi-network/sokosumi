import type { UIMessage } from "ai";

import { convertItemsToMessages } from "@/lib/chat/conversation-api-to-ui-messages";

import { getReasoningStepDisplayText } from "./reasoning-generic-labels";

export { convertItemsToMessages };

export type MessageFilePart = Extract<
  UIMessage["parts"][number],
  { type: "file" }
>;

const VISIBLE_TEXT_PART_TYPES = new Set(["text", "input_text", "output_text"]);

function appendVisibleTextFromPart(part: Record<string, unknown>): string {
  if (!VISIBLE_TEXT_PART_TYPES.has(String(part.type))) {
    return "";
  }
  if ("text" in part && part.text !== null && part.text !== undefined) {
    return String(part.text);
  }
  if (
    "content" in part &&
    part.content !== null &&
    part.content !== undefined
  ) {
    return String(part.content);
  }
  return "";
}

function normalizeFilePart(part: unknown): MessageFilePart | null {
  if (!part || typeof part !== "object") {
    return null;
  }

  const record = part as Record<string, unknown>;
  if (
    record.type !== "file" ||
    typeof record.url !== "string" ||
    typeof record.mediaType !== "string"
  ) {
    return null;
  }

  return {
    type: "file",
    url: record.url,
    mediaType: record.mediaType,
    ...(typeof record.filename === "string" && record.filename.trim()
      ? { filename: record.filename }
      : {}),
  } satisfies MessageFilePart;
}

/**
 * When both legacy array `content` and `parts` are present, the same file
 * attachment can appear twice; keep first occurrence by URL.
 */
function dedupeFilePartsByUrlInMergedParts(parts: unknown[]): unknown[] {
  const seenFileUrls = new Set<string>();
  const out: unknown[] = [];
  for (const part of parts) {
    const file = normalizeFilePart(part);
    if (file != null) {
      if (seenFileUrls.has(file.url)) {
        continue;
      }
      seenFileUrls.add(file.url);
    }
    out.push(part);
  }
  return out;
}

function readMessagePartArrays(message: Record<string, unknown>): unknown[] {
  const contentParts = Array.isArray(message.content) ? message.content : [];
  const uiParts = Array.isArray(message.parts) ? message.parts : [];
  return dedupeFilePartsByUrlInMergedParts([...contentParts, ...uiParts]);
}

function hasMeaningfulUiPart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return false;
  }

  const record = part as Record<string, unknown>;
  if (normalizeFilePart(record)) {
    return true;
  }

  return appendVisibleTextFromPart(record).trim().length > 0;
}

/** Visible assistant text only (text parts only; excludes reasoning, tools, etc.). */
export function extractMessageContent(message: unknown): string {
  const messageAny = message as Record<string, unknown>;
  let content = "";

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
            return appendVisibleTextFromPart(part as Record<string, unknown>);
          }
          return "";
        })
        .filter(Boolean)
        .join("");
    } else {
      content = String(msgContent);
    }
  }

  if (!content && "parts" in messageAny && Array.isArray(messageAny.parts)) {
    content = (messageAny.parts as unknown[])
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return appendVisibleTextFromPart(part as Record<string, unknown>);
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

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

export function getMessageFileParts(message: unknown): MessageFilePart[] {
  const messageAny = message as Record<string, unknown>;
  return readMessagePartArrays(messageAny)
    .map((part) => normalizeFilePart(part))
    .filter((part): part is MessageFilePart => part !== null);
}

export function hasMessageTextOrFileParts(message: unknown): boolean {
  const messageAny = message as Record<string, unknown>;
  return readMessagePartArrays(messageAny).some((part) =>
    hasMeaningfulUiPart(part),
  );
}

/** Reasoning parts from a UIMessage (for ThoughtSummaryBar / loaders). */
export function extractReasoningStepMessages(
  message: unknown,
): Array<{ id: string; message: string }> {
  const messageAny = message as Record<string, unknown>;
  const parts = messageAny.parts;
  if (!Array.isArray(parts)) {
    return [];
  }
  const msgId = typeof messageAny.id === "string" ? messageAny.id : "msg";
  const out: Array<{ id: string; message: string }> = [];
  let reasoningIndex = 0;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type !== "reasoning") continue;
    const text = typeof p.text === "string" ? p.text : "";
    const display = getReasoningStepDisplayText(text);
    if (display === null) {
      if (p.state === "streaming" && text.trim() === "") {
        out.push({
          id: `${msgId}-reasoning-${reasoningIndex}`,
          message: "Thinking...",
        });
        reasoningIndex += 1;
      }
      if (text.trim() === "Processing...") {
        out.push({
          id: `${msgId}-reasoning-${reasoningIndex}`,
          message: "Processing...",
        });
        reasoningIndex += 1;
      }
      continue;
    }
    out.push({
      id: `${msgId}-reasoning-${reasoningIndex}`,
      message: display,
    });
    reasoningIndex += 1;
  }
  return out;
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

export const COWORKER_AGENT_ERROR_SNIPPET =
  "Something went wrong while processing your task";

export function shouldReplaceSlotMessagesWithDb(
  slotMessages: UIMessage[],
  dbMessages: UIMessage[],
): boolean {
  if (dbMessages.length === 0) {
    return false;
  }
  if (slotMessages.length === 0) {
    return true;
  }
  if (dbMessages.length > slotMessages.length) {
    return true;
  }

  const slotTail = slotMessages[slotMessages.length - 1];
  const dbTail = dbMessages[dbMessages.length - 1];
  if (dbTail?.role !== "assistant" || slotTail?.role !== "assistant") {
    return false;
  }

  const dbText = extractMessageContent(dbTail).trim();
  const slotText = extractMessageContent(slotTail).trim();

  if (!slotText && dbText) {
    return true;
  }
  if (
    slotText.includes(COWORKER_AGENT_ERROR_SNIPPET) &&
    dbText.length > 0 &&
    !dbText.includes(COWORKER_AGENT_ERROR_SNIPPET)
  ) {
    return true;
  }
  if (dbText.length > slotText.length + 10) {
    return true;
  }

  return false;
}

export function reconcileSlotMessagesWithDb(
  slotMessages: UIMessage[],
  dbMessages: UIMessage[],
): UIMessage[] {
  if (shouldReplaceSlotMessagesWithDb(slotMessages, dbMessages)) {
    return dbMessages;
  }
  if (dbMessages.length === 0) {
    return slotMessages;
  }
  return mergeAssistantThoughtMetadataFromDb(slotMessages, dbMessages);
}

export function mergeAssistantThoughtMetadataFromDb(
  slotMessages: UIMessage[],
  dbMessages: UIMessage[],
): UIMessage[] {
  const timingById = new Map<
    string,
    { thoughtStartedAtMs: number; thoughtEndedAtMs: number }
  >();
  for (const m of dbMessages) {
    if (m.role !== "assistant") continue;
    const id = m.id?.trim();
    if (!id) continue;
    const { startedAtMs, endedAtMs } = getThoughtTimingMsFromMessage(m);
    if (startedAtMs != null && endedAtMs != null) {
      timingById.set(id, {
        thoughtStartedAtMs: startedAtMs,
        thoughtEndedAtMs: endedAtMs,
      });
    }
  }
  if (timingById.size === 0) {
    return slotMessages;
  }

  return slotMessages.map((m) => {
    if (m.role !== "assistant") return m;
    const id = m.id?.trim();
    if (!id) return m;
    const timing = timingById.get(id);
    if (!timing) return m;
    const mAny = m as { metadata?: Record<string, unknown> };
    return {
      ...m,
      metadata: {
        ...(mAny.metadata ?? {}),
        ...timing,
      },
    };
  });
}

/** First occurrence wins when the same id appears twice. */
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
