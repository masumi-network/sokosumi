import type { UIMessage } from "ai";

/** Maps persisted conversation items to AI SDK `UIMessage` (text parts only). */
export function conversationItemsToUiMessages(
  items: Array<{
    id: string;
    role: string;
    contentText: string | null | undefined;
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

    return {
      id: item.id,
      role: validRole,
      parts: [{ type: "text", text }],
    };
  });
}
