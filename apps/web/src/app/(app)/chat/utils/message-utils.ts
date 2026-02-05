import type { UIMessage } from "ai";

/**
 * Extract text content from a message in various formats (AI SDK v6, parts array, etc.)
 */
export function extractMessageContent(message: unknown): string {
  const messageAny = message as Record<string, unknown>;
  let content = "";

  // Try content property first
  if (
    "content" in messageAny &&
    messageAny.content !== undefined &&
    messageAny.content !== null
  ) {
    const msgContent = messageAny.content;
    if (typeof msgContent === "string") {
      content = msgContent;
    } else if (Array.isArray(msgContent)) {
      content = msgContent
        .map((part: unknown) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const partObj = part as Record<string, unknown>;
            if (
              "text" in partObj &&
              partObj.text !== null &&
              partObj.text !== undefined
            ) {
              return String(partObj.text);
            }
            if (
              "content" in partObj &&
              partObj.content !== null &&
              partObj.content !== undefined
            ) {
              return String(partObj.content);
            }
          }
          return "";
        })
        .filter(Boolean)
        .join("");
    } else {
      content = String(msgContent);
    }
  }

  // Try "parts" property (AI SDK v6 format)
  if (!content && "parts" in messageAny && Array.isArray(messageAny.parts)) {
    content = (messageAny.parts as unknown[])
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const partObj = part as Record<string, unknown>;
          if (
            "text" in partObj &&
            partObj.text !== null &&
            partObj.text !== undefined
          ) {
            return String(partObj.text);
          }
          if (
            "content" in partObj &&
            partObj.content !== null &&
            partObj.content !== undefined
          ) {
            return String(partObj.content);
          }
          // Try direct stringification if it's a simple object
          if (
            "type" in partObj &&
            partObj.type === "text" &&
            "text" in partObj
          ) {
            return String(partObj.text);
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  // Fallback: try "text" property directly
  if (
    !content &&
    "text" in messageAny &&
    messageAny.text !== undefined &&
    messageAny.text !== null
  ) {
    content = String(messageAny.text);
  }

  return content.trim();
}

/**
 * Convert ConversationItem[] to UIMessage format
 */
export function convertItemsToMessages(
  items: Array<{
    id: string;
    role: string;
    content: Array<{ type: string; text?: string }> | string;
    created_at: number;
  }>,
): UIMessage[] {
  return items.map((item) => {
    const contentText =
      typeof item.content === "string"
        ? item.content
        : item.content.map((c) => c.text || "").join("");

    // Validate and cast role to UIMessage role type
    const validRole: "assistant" | "user" | "system" =
      item.role === "assistant" ||
      item.role === "user" ||
      item.role === "system"
        ? (item.role as "assistant" | "user" | "system")
        : "user"; // Default to "user" if role is invalid

    return {
      id: item.id,
      role: validRole,
      parts: [{ type: "text", text: contentText }],
      content: contentText,
      createdAt: new Date(item.created_at * 1000),
    };
  });
}
