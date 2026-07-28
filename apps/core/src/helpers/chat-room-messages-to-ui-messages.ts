import type { UIMessage } from "ai";

import {
  imageGenerationFromMessageMetadata,
  thoughtTimingFromMessageMetadata,
} from "@/helpers/conversation-message-api-content";
import {
  assistantContentPartsToAiSdkUiParts,
  nonAssistantContentPartsToAiSdkUiParts,
} from "@/helpers/conversation-messages-to-ui-messages";
import { buildConversationContentParts } from "@/helpers/message-content";

export type ChatRoomMessageRow = {
  id: string;
  content: string;
  senderUserId: string | null;
  senderCoworkerId: string | null;
  metadata: unknown;
  createdAt: Date;
};

function resolveChatRoomMessageRole(
  row: ChatRoomMessageRow,
): "user" | "assistant" {
  if (row.senderCoworkerId) {
    return "assistant";
  }
  return "user";
}

/** Maps persisted chat room messages to AI SDK `UIMessage` rows. */
export function chatRoomMessagesToUiMessages(
  rows: ChatRoomMessageRow[],
): UIMessage[] {
  return rows.map((row) => {
    const validRole = resolveChatRoomMessageRole(row);

    const rawParts = buildConversationContentParts({
      contentText: row.content,
      metadata: row.metadata,
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

    const timing = thoughtTimingFromMessageMetadata(row.metadata);
    const isImageGeneration =
      validRole === "user" && imageGenerationFromMessageMetadata(row.metadata);
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
      id: row.id,
      role: validRole,
      parts,
      ...(metadata != null ? { metadata } : {}),
    };
  });
}
