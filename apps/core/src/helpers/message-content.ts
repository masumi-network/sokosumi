export function extractMessageText(message: Record<string, unknown>): string {
  if ("content" in message && typeof message.content === "string") {
    return message.content;
  }

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

  return "";
}

export function formatMessageContentForConversation(
  text: string,
): Array<{ type: string; text: string }> {
  return text ? [{ type: "input_text", text }] : [];
}
