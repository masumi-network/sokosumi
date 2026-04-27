import type { UIMessage } from "ai";

import { thoughtTimingFromMessageMetadata } from "@/helpers/conversation-message-api-content";
import { buildConversationContentParts } from "@/helpers/message-content";

/** Maps persisted conversation messages to AI SDK `UIMessage` (text + optional reasoning parts). */
export function conversationMessagesToUiMessages(
  messages: Array<{
    id: string;
    role: string;
    contentText: string | null | undefined;
    metadata?: unknown;
  }>,
): UIMessage[] {
  return messages.map((message) => {
    const validRole: "assistant" | "user" | "system" =
      message.role === "assistant" ||
      message.role === "user" ||
      message.role === "system"
        ? message.role
        : "user";

    const rawParts = buildConversationContentParts({
      contentText: message.contentText,
      metadata: message.metadata,
      includeEmptyTextFallback: true,
    });

    const parts = rawParts.map((part) => {
      if (part.type === "file" || part.type === "text") {
        return part;
      }
      if ("text" in part && typeof part.text === "string") {
        return { type: "reasoning" as const, text: part.text };
      }
      return part;
    }) as UIMessage["parts"];

    const timing = thoughtTimingFromMessageMetadata(message.metadata);

    return {
      id: message.id,
      role: validRole,
      parts,
      ...(timing != null
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
