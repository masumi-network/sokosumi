import { isChatUiProviderReasoningPartType } from "@sokosumi/utils";
import type { UIMessage } from "ai";

import { getReasoningStepDisplayText } from "./reasoning-generic-labels";

function appendVisibleTextFromPart(part: Record<string, unknown>): string {
  if (part.type !== "text") {
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

function partsFromApiItemContent(
  content:
    | string
    | ReadonlyArray<
        | { type: string; text?: string }
        | {
            type: "file";
            url: string;
            mediaType: string;
            filename?: string;
          }
      >,
): UIMessage["parts"] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  const parts: UIMessage["parts"] = [];
  for (const c of content) {
    if (
      typeof c === "object" &&
      c !== null &&
      "type" in c &&
      c.type === "file" &&
      "url" in c &&
      typeof (c as { url?: unknown }).url === "string" &&
      "mediaType" in c &&
      typeof (c as { mediaType?: unknown }).mediaType === "string"
    ) {
      const file = c as {
        type: "file";
        url: string;
        mediaType: string;
        filename?: string;
      };
      parts.push({
        type: "file",
        url: file.url,
        mediaType: file.mediaType,
        ...(file.filename !== undefined ? { filename: file.filename } : {}),
      });
      continue;
    }
    if (isChatUiProviderReasoningPartType((c as { type?: unknown }).type)) {
      parts.push({
        type: "reasoning",
        text:
          "text" in c && typeof (c as { text?: unknown }).text === "string"
            ? (c as { text: string }).text
            : "",
      });
      continue;
    }
    parts.push({
      type: "text",
      text:
        "text" in c && typeof (c as { text?: unknown }).text === "string"
          ? (c as { text: string }).text
          : "",
    });
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
  items: Array<{
    id: string;
    role: string;
    content:
      | string
      | ReadonlyArray<
          | { type: string; text?: string }
          | {
              type: "file";
              url: string;
              mediaType: string;
              filename?: string;
            }
        >;
    createdAt: number;
    thoughtTiming?: {
      startedAtMs: number | null;
      endedAtMs: number | null;
    };
  }>,
): UIMessage[] {
  return items.map((item) => {
    const parts = partsFromApiItemContent(item.content);
    const visibleText = visibleTextFromParts(parts);

    const validRole: "assistant" | "user" | "system" =
      item.role === "assistant" ||
      item.role === "user" ||
      item.role === "system"
        ? (item.role as "assistant" | "user" | "system")
        : "user";

    const timing = item.thoughtTiming;
    const hasCompleteThoughtTiming =
      timing != null && timing.startedAtMs != null && timing.endedAtMs != null;

    return {
      id: item.id,
      role: validRole,
      parts,
      content: visibleText,
      createdAt: new Date(item.createdAt * 1000),
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
