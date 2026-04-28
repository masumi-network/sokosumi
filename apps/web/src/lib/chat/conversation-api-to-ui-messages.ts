import { isChatUiProviderReasoningPartType } from "@sokosumi/utils";
import type { UIMessage } from "ai";

/**
 * Serialized conversation `content` from Core (string or typed part array).
 * Shared by legacy chat and chat-ui so API → `UIMessage.parts` mapping stays
 * identical.
 */
export type ConversationApiMessageContent =
  | string
  | ReadonlyArray<
      | { type?: string; text?: string }
      | {
          type: "file";
          url: string;
          mediaType: string;
          filename?: string;
        }
    >;

export interface ConvertibleConversationApiMessage {
  id: string;
  role: string;
  content: ConversationApiMessageContent;
  createdAt: number;
  thoughtTiming?: {
    startedAtMs: number | null;
    endedAtMs: number | null;
  };
}

function readStringTextField(item: object): string {
  if (!("text" in item)) {
    return "";
  }
  const value = (item as { text?: unknown }).text;
  return typeof value === "string" ? value : "";
}

/**
 * Maps Core conversation message `content` to AI SDK `UIMessage.parts`
 * (text, file, reasoning; provider-specific reasoning types normalized).
 */
export function partsFromApiItemContent(
  content: ConversationApiMessageContent,
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
    if (
      typeof c === "object" &&
      c !== null &&
      isChatUiProviderReasoningPartType((c as { type?: unknown }).type)
    ) {
      parts.push({
        type: "reasoning",
        text: readStringTextField(c),
      });
      continue;
    }
    parts.push({
      type: "text",
      text: typeof c === "object" && c !== null ? readStringTextField(c) : "",
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

/** Converts Core / server-action conversation rows to `UIMessage` for the AI SDK. */
export function convertItemsToMessages(
  conversationMessages: ReadonlyArray<ConvertibleConversationApiMessage>,
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
