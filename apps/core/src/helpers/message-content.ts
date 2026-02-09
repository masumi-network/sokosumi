/**
 * Extracts text content from various message formats
 * Supports multiple message formats from AI SDK and other sources
 */
export function extractMessageText(message: Record<string, unknown>): string {
  // Check if content exists and is a string
  if ("content" in message && typeof message.content === "string") {
    return message.content;
  }

  // Check if content exists and is an array
  if ("content" in message && Array.isArray(message.content)) {
    return message.content
      .map((c: unknown): string => {
        if (typeof c === "string") return c;
        const part = c as { type?: string; text?: string };
        return part.text || "";
      })
      .filter(Boolean)
      .join("");
  }

  // Check if parts exists (AI SDK v6 format)
  if ("parts" in message && Array.isArray(message.parts)) {
    return message.parts
      .map((part: unknown): string => {
        if (typeof part === "string") return part;
        const partObj = part as { type?: string; text?: string };
        return partObj.text || "";
      })
      .filter(Boolean)
      .join("");
  }

  // Fallback: return empty string
  return "";
}

/**
 * Formats message content for Core API conversation items
 * Returns format: [{"type": "input_text", "text": "..."}]
 */
export function formatMessageContentForConversation(
  text: string,
): Array<{ type: string; text: string }> {
  return text ? [{ type: "input_text", text }] : [];
}
