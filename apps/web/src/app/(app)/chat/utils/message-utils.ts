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

export function convertItemsToMessages(
  items: Array<{
    id: string;
    role: string;
    content: Array<{ type: string; text?: string }> | string;
    createdAt: number;
  }>,
): UIMessage[] {
  return items.map((item) => {
    const contentText =
      typeof item.content === "string"
        ? item.content
        : item.content.map((c) => c.text || "").join("");

    const validRole: "assistant" | "user" | "system" =
      item.role === "assistant" ||
      item.role === "user" ||
      item.role === "system"
        ? (item.role as "assistant" | "user" | "system")
        : "user";

    return {
      id: item.id,
      role: validRole,
      parts: [{ type: "text", text: contentText }],
      content: contentText,
      createdAt: new Date(item.createdAt * 1000),
    };
  });
}
