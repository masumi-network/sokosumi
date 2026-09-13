import { isChatUiProviderReasoningPartType } from "@sokosumi/utils";
import type { UIMessage } from "ai";

import { type PersistedConversationContentPart } from "@/helpers/message-content";

/**
 * Coerce assistant body parts to AI SDK `UIMessage` parts:
 * - `output_text` → `text`
 * - allowlisted reasoning only → `ReasoningUIPart` (`type: "reasoning"`)
 * - other text-bearing segments (e.g. exotic primary `contentType`) → `text`
 *
 * Does not invent Thought for non-allowlisted types.
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
    if (
      isChatUiProviderReasoningPartType(part.type) &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      return { type: "reasoning" as const, text: part.text };
    }
    if ("text" in part && typeof part.text === "string") {
      return { type: "text" as const, text: part.text };
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
