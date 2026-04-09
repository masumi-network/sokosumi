import type { UIMessage } from "ai";

import { thoughtTimingFromMessageMetadata } from "@/helpers/conversation-message-api-content";

/** Maps persisted conversation items to AI SDK `UIMessage` (text + optional reasoning parts). */
export function conversationItemsToUiMessages(
  items: Array<{
    id: string;
    role: string;
    contentText: string | null | undefined;
    metadata?: unknown;
  }>,
): UIMessage[] {
  return items.map((item) => {
    const validRole: "assistant" | "user" | "system" =
      item.role === "assistant" ||
      item.role === "user" ||
      item.role === "system"
        ? item.role
        : "user";

    const text = item.contentText ?? "";
    const meta = item.metadata as {
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

    const timing = thoughtTimingFromMessageMetadata(item.metadata);

    return {
      id: item.id,
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
