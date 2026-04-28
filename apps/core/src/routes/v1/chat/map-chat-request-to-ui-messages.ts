import type { z } from "@hono/zod-openapi";
import type { UIMessage } from "ai";

import {
  assistantContentPartsToAiSdkUiParts,
  nonAssistantContentPartsToAiSdkUiParts,
} from "@/helpers/conversation-messages-to-ui-messages";
import { extractUiMessageParts } from "@/helpers/message-content";
import { chatRequestMessageSchema } from "@/schemas/chat-request.schema.js";

type ChatRequestMessage = z.infer<typeof chatRequestMessageSchema>;

export function mapChatRequestToUiMessages(
  messages: ChatRequestMessage[],
): UIMessage[] {
  return messages.map((m, index) => {
    const extracted = extractUiMessageParts(m as Record<string, unknown>);
    const partsForRole =
      m.role === "assistant"
        ? assistantContentPartsToAiSdkUiParts(extracted)
        : nonAssistantContentPartsToAiSdkUiParts(extracted);
    const parts =
      partsForRole.length > 0
        ? partsForRole
        : ([{ type: "text" as const, text: "" }] satisfies UIMessage["parts"]);

    return {
      id: m.id?.trim() && m.id.trim().length > 0 ? m.id : `msg-${index}`,
      role: m.role,
      parts: parts as UIMessage["parts"],
    };
  });
}
