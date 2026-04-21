import type { UIMessage } from "ai";

import { thoughtTimingFromMessageMetadata } from "@/helpers/conversation-message-api-content";

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

    const text = message.contentText ?? "";
    const meta = message.metadata as {
      reasoning?: Array<{ type?: string; text?: string }>;
    } | null;
    const reasoningBlocks = (meta?.reasoning ?? []).filter(
      (r) => typeof r.text === "string" && r.text.trim().length > 0,
    );

    const parts: UIMessage["parts"] = [
      ...reasoningBlocks.map((r) => ({
        type: "reasoning" as const,
        text: r.text!.trim(),
      })),
      { type: "text" as const, text },
    ];

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
