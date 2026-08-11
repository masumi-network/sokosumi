import type { UIMessage } from "ai";

import {
  imageGenerationFromMessageMetadata,
  thoughtTimingFromMessageMetadata,
} from "@/helpers/conversation-message-api-content";
import {
  buildConversationContentParts,
  type PersistedConversationContentPart,
} from "@/helpers/message-content";

/**
 * Coerce assistant body parts to AI SDK `UIMessage` parts: `output_text` →
 * `text`; text-bearing non-body segments → `{ type: "reasoning", text }` so
 * `validateUIMessages` accepts the payload (AI SDK only knows `reasoning`).
 *
 * Ingress/persist already allowlist `type: "reasoning"` only; this is a final
 * shape normalize for AI SDK, not a second Thought classifier.
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

/**
 * For user/system messages: keep only `text`, `file`, and `output_text` parts (strip
 * reasoning and other segments), then coerce `output_text` to AI SDK `text`.
 * Must stay in sync with how inbound chat requests are mapped for non-assistant roles.
 */
export function nonAssistantContentPartsToAiSdkUiParts(
  rawParts: PersistedConversationContentPart[],
): UIMessage["parts"] {
  return rawParts
    .filter(
      (p) => p.type === "text" || p.type === "file" || p.type === "output_text",
    )
    .map((p) =>
      p.type === "output_text" ? { type: "text" as const, text: p.text } : p,
    ) as UIMessage["parts"];
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
        : nonAssistantContentPartsToAiSdkUiParts(rawParts);
    const parts =
      partsForRole.length > 0
        ? partsForRole
        : ([{ type: "text" as const, text: "" }] satisfies UIMessage["parts"]);

    const timing = thoughtTimingFromMessageMetadata(message.metadata);
    const isImageGeneration =
      validRole === "user" &&
      imageGenerationFromMessageMetadata(message.metadata);
    const metadata =
      timing != null || isImageGeneration
        ? {
            ...(timing != null
              ? {
                  thoughtStartedAtMs: timing.startedAtMs,
                  thoughtEndedAtMs: timing.endedAtMs,
                }
              : {}),
            ...(isImageGeneration ? { imageGeneration: true } : {}),
          }
        : undefined;

    return {
      id: message.id,
      role: validRole,
      parts,
      ...(metadata != null ? { metadata } : {}),
    };
  });
}
