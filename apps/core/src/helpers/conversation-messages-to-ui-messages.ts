import type { UIMessage } from "ai";

import { thoughtTimingFromMessageMetadata } from "@/helpers/conversation-message-api-content";
import {
  buildConversationContentParts,
  type PersistedConversationContentPart,
} from "@/helpers/message-content";

/**
 * Coerce assistant body parts to AI SDK `UIMessage` parts: non-text/file segments
 * with `text` become `{ type: "reasoning", text }` so provider-specific labels
 * (e.g. `redacted_reasoning`) pass `validateUIMessages`.
 */
export function assistantContentPartsToAiSdkUiParts(
  rawParts: PersistedConversationContentPart[],
): UIMessage["parts"] {
  return rawParts.map((part) => {
    if (part.type === "file" || part.type === "text") {
      return part;
    }
    if (part.type === "output_text") {
      return { type: "text" as const, text: part.text };
    }
    if ("text" in part && typeof part.text === "string") {
      return { type: "reasoning" as const, text: part.text };
    }
    return part;
  }) as UIMessage["parts"];
}

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

    const partsForRole =
      validRole === "assistant"
        ? assistantContentPartsToAiSdkUiParts(rawParts)
        : (rawParts
            .filter(
              (p) =>
                p.type === "text" ||
                p.type === "file" ||
                p.type === "output_text",
            )
            .map((p) =>
              p.type === "output_text"
                ? { type: "text" as const, text: p.text }
                : p,
            ) as UIMessage["parts"]);
    const parts =
      partsForRole.length > 0
        ? partsForRole
        : ([{ type: "text" as const, text: "" }] satisfies UIMessage["parts"]);

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
