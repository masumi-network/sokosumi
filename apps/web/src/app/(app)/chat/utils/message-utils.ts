const VISIBLE_TEXT_PART_TYPES = new Set(["text", "input_text", "output_text"]);

function appendVisibleTextFromPart(part: Record<string, unknown>): string {
  if (!VISIBLE_TEXT_PART_TYPES.has(String(part.type))) {
    return "";
  }
  if ("text" in part && part.text !== null && part.text !== undefined) {
    return String(part.text);
  }
  if (
    "content" in part &&
    part.content !== null &&
    part.content !== undefined
  ) {
    return String(part.content);
  }
  return "";
}

/** Visible assistant text only (text parts only; excludes reasoning, tools, etc.). */
export function extractMessageContent(message: unknown): string {
  const messageAny = message as Record<string, unknown>;
  let content = "";

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
            return appendVisibleTextFromPart(part as Record<string, unknown>);
          }
          return "";
        })
        .filter(Boolean)
        .join("");
    } else {
      content = String(msgContent);
    }
  }

  if (!content && "parts" in messageAny && Array.isArray(messageAny.parts)) {
    content = (messageAny.parts as unknown[])
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return appendVisibleTextFromPart(part as Record<string, unknown>);
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

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
