import type { z } from "@hono/zod-openapi";
import type { UIMessage } from "ai";

import { chatRequestMessageSchema } from "@/schemas/chat-request.schema.js";

type ChatRequestMessage = z.infer<typeof chatRequestMessageSchema>;

export function mapChatRequestToUiMessages(
  messages: ChatRequestMessage[],
): UIMessage[] {
  return messages.map((m, index) => ({
    id: m.id?.trim() && m.id.trim().length > 0 ? m.id : `msg-${index}`,
    role: m.role,
    parts: messageToTextParts(m),
  }));
}

function messageToTextParts(
  m: ChatRequestMessage,
): Array<{ type: "text"; text: string }> {
  if (m.parts && m.parts.length > 0) {
    const texts = m.parts
      .filter((p) => p.type === "text" && p.text && p.text.length > 0)
      .map((p) => ({ type: "text" as const, text: p.text! }));
    if (texts.length > 0) {
      return texts;
    }
  }
  if (typeof m.content === "string") {
    return [{ type: "text", text: m.content }];
  }
  if (Array.isArray(m.content)) {
    const joined = m.content
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("");
    return [{ type: "text", text: joined }];
  }
  return [{ type: "text", text: "" }];
}
